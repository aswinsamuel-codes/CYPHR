import EventEmitter from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { CryptoService, EncryptedEnvelope } from '@/services/crypto/CryptoService';
import { BLETransport } from '@/services/network/BLETransport';
import type { ChatMessage } from '@/components/ChatScreen';
import type { Storage } from '@/services/storage/Storage';

type Status = ChatMessage['status'];

type Events = {
	message: (msg: ChatMessage) => void;
	status: (id: string, status: Status) => void;
	keyChanged: (key: string) => void;
};

type OutboundQueueItem = {
	envelope: EncryptedEnvelope;
	attempts: number;
	lastTriedAt?: number;
};

const DEDUP_CACHE_MAX_SIZE = 500;

export class MeshManager {
	private emitter = new EventEmitter<Events>();
	private deviceId = `cyphr-${uuidv4().slice(0, 8)}`;
	private deviceKey: string | null = null;
	private queue: OutboundQueueItem[] = [];
	private running = false;
	private peers: string[] = [];
	private storage: typeof Storage;
	private seenEnvelopeIds = new Set<string>();
	private bleTransport: BLETransport;

	constructor(storage: typeof Storage) {
		this.storage = storage;
		this.bleTransport = new BLETransport();
	}

	async start() {
		this.running = true;
		// Initialize device key from storage (or generate new one)
		this.deviceKey = await CryptoService.initializeDeviceKey(this.storage);

		// ── Wire BLETransport events ──────────────────────────────────

		// Inbound envelopes from BLE peers → relay pipeline
		this.bleTransport.onEnvelopeReceived((envelope) => {
			this.handleInboundEnvelope(envelope);
		});

		// Track connected BLE peers in the local peers list
		this.bleTransport.onPeerConnected((peer) => {
			if (!this.peers.includes(peer.id)) {
				this.peers.push(peer.id);
			}
		});

		this.bleTransport.onPeerDisconnected((peerId) => {
			this.peers = this.peers.filter((id) => id !== peerId);
		});

		// Auto-connect to discovered CYPHR peers
		this.bleTransport.onPeerDiscovered((peer) => {
			this.bleTransport.connectToPeer(peer.id).catch(() => {
				// Connection failure is non-fatal; peer will be retried on next scan
			});
		});

		// Start BLE scanning + outbound queue
		await this.bleTransport.startScanning();
		this.txLoop();
	}

	stop() {
		this.running = false;
		this.bleTransport.stopScanning();
		this.bleTransport.destroy();
	}

	getDeviceId() {
		return this.deviceId;
	}

	getDeviceKey() {
		return this.deviceKey;
	}

	async regenerateDeviceKey(): Promise<string> {
		const newKey = CryptoService.generateSymmetricKey();
		await this.storage.setDeviceKey(newKey);
		this.deviceKey = newKey;
		this.emitter.emit('keyChanged', newKey);
		return newKey;
	}

	onMessage(cb: (msg: ChatMessage) => void) {
		this.emitter.on('message', cb);
		return () => this.emitter.off('message', cb);
	}

	onStatusUpdate(cb: (id: string, status: Status) => void) {
		this.emitter.on('status', cb);
		return () => this.emitter.off('status', cb);
	}

	onKeyChanged(cb: (key: string) => void) {
		this.emitter.on('keyChanged', cb);
		return () => this.emitter.off('keyChanged', cb);
	}

	async sendText(text: string, recipientId: string | 'broadcast' = 'broadcast'): Promise<ChatMessage> {
		const key = this.deviceKey || undefined;
		const envelope = CryptoService.encryptMessage({ text, senderId: this.deviceId, recipientId }, key);
		// Mark our own outbound messages as seen so we don't process them if echoed back
		this.addToDedup(envelope.id);
		this.queue.push({ envelope, attempts: 0 });
		const msg: ChatMessage = {
			id: envelope.id,
			senderId: this.deviceId,
			recipientId,
			text,
			timestamp: envelope.timestamp,
			status: 'queued',
		};
		return msg;
	}

	// ── Deduplication helpers ──────────────────────────────────────────

	private addToDedup(id: string) {
		if (this.seenEnvelopeIds.size >= DEDUP_CACHE_MAX_SIZE) {
			// Evict oldest entry (Set iterates in insertion order)
			const oldest = this.seenEnvelopeIds.values().next().value;
			if (oldest !== undefined) this.seenEnvelopeIds.delete(oldest);
		}
		this.seenEnvelopeIds.add(id);
	}

	// ── Inbound relay logic ───────────────────────────────────────────

	/**
	 * Process an envelope received from a peer (or from the local txLoop
	 * prototype simulation).  Implements the full relay pipeline:
	 *   1. Dedup check
	 *   2. Deliver locally if we are the recipient (or broadcast)
	 *   3. Relay to all connected peers if TTL allows
	 */
	handleInboundEnvelope(envelope: EncryptedEnvelope) {
		// ── Step 1: Deduplication ──────────────────────────────────────
		if (this.seenEnvelopeIds.has(envelope.id)) return;
		this.addToDedup(envelope.id);

		const isForUs = envelope.recipientId === this.deviceId;
		const isBroadcast = envelope.recipientId === 'broadcast';

		// ── Step 2: Deliver locally if addressed to us (or broadcast) ─
		if (isForUs || isBroadcast) {
			const key = this.deviceKey || undefined;
			const decrypted = CryptoService.decryptMessage(envelope, key);
			if (decrypted) {
				const msg: ChatMessage = {
					id: decrypted.id,
					senderId: decrypted.senderId,
					recipientId: decrypted.recipientId,
					text: decrypted.text,
					timestamp: decrypted.timestamp,
					status: isForUs ? 'delivered' : 'relayed',
				};
				this.emitter.emit('message', msg);
			}
			// If directly addressed to us, no need to relay further
			if (isForUs) return;
		}

		// ── Step 3-6: Relay to peers if TTL allows ─────────────────────
		if (envelope.ttl <= 0) {
			// TTL exhausted — drop the message, do not relay
			return;
		}

		// Mutate a shallow copy so the original is untouched
		const relayed: EncryptedEnvelope = {
			...envelope,
			ttl: envelope.ttl - 1,
			relayCount: envelope.relayCount + 1,
			hops: [...envelope.hops, this.deviceId],
		};

		this.forwardToAllPeers(relayed);
	}

	// ── Peer forwarding ───────────────────────────────────────────────

	/**
	 * Send an envelope to every currently connected BLE peer.
	 * Falls back to local queue if no BLE peers are available.
	 */
	private forwardToAllPeers(envelope: EncryptedEnvelope) {
		const connectedPeers = this.bleTransport.getConnectedPeers();

		if (connectedPeers.length > 0) {
			// Send over BLE to all connected peers
			this.bleTransport.broadcastEnvelope(envelope).catch(() => {
				// If BLE broadcast fails, fall back to queue for retry
				this.queue.push({ envelope, attempts: 0 });
			});
		} else {
			// No BLE peers — queue for later transmission
			this.queue.push({ envelope, attempts: 0 });
		}

		this.emitter.emit('status', envelope.id, 'relayed');
	}

	private async txLoop() {
		const TICK_MS = 1500;
		while (this.running) {
			const now = Date.now();
			const connectedPeers = this.bleTransport.getConnectedPeers();

			for (const item of this.queue) {
				if (item.lastTriedAt && now - item.lastTriedAt < 2000) continue;
				item.lastTriedAt = now;
				item.attempts += 1;

				if (connectedPeers.length > 0) {
					// Transmit over BLE to all connected peers
					for (const peer of connectedPeers) {
						this.bleTransport.sendEnvelope(peer.id, item.envelope).catch(() => {
							// Send failure is non-fatal; will retry on next tick
						});
					}
					this.emitter.emit('status', item.envelope.id, 'sent');
				} else if (item.envelope.recipientId === 'broadcast') {
					// No BLE peers but broadcast — deliver locally as prototype fallback
					this.handleInboundEnvelope(item.envelope);
					this.emitter.emit('status', item.envelope.id, 'sent');
				}
			}

			// Drop items that have been fully attempted
			this.queue = this.queue.filter((q) => q.attempts < 5);
			await new Promise((r) => setTimeout(r, TICK_MS));
		}
	}
}


