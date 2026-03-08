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

/** Minimum relay delay in ms (prevents forwarding storms) */
const RELAY_DELAY_MIN_MS = 50;

/** Maximum relay delay in ms */
const RELAY_DELAY_MAX_MS = 200;

/** Probability (0–1) that this node will relay a message. 0.7 = 70% */
const RELAY_PROBABILITY = 0.7;

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
		this.bleTransport = new BLETransport(this.deviceId);
	}

	async start() {
		this.running = true;
		// Initialize device key from storage (or generate new one)
		this.deviceKey = await CryptoService.initializeDeviceKey(this.storage);

		// ── Wire BLETransport events ──────────────────────────────────

		// Inbound envelopes from BLE peers → relay pipeline
		this.bleTransport.onEnvelopeReceived((envelope, fromPeerId) => {
			this.handleInboundEnvelope(envelope, fromPeerId);
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

		// Initialize BLE (scanning, advertising, auto-connect all handled internally)
		await this.bleTransport.initialize();
		this.txLoop();
	}

	stop() {
		this.running = false;
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
	 *   3. Relay to all connected peers (except sender) if TTL allows
	 *
	 * @param envelope    The encrypted envelope to process.
	 * @param fromPeerId  BLE peer ID that sent this envelope (excluded from relay).
	 */
	handleInboundEnvelope(envelope: EncryptedEnvelope, fromPeerId?: string) {
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

		// ── Step 3-4: Relay to peers if TTL allows ─────────────────────
		if (envelope.ttl <= 0) {
			// TTL exhausted — drop the message, do not relay
			return;
		}

		// Probabilistic relay: skip forwarding some messages to
		// reduce congestion in dense mesh environments.
		if (Math.random() > RELAY_PROBABILITY) {
			return;
		}

		// Create a relay copy with updated routing metadata
		const relayed: EncryptedEnvelope = {
			...envelope,
			ttl: envelope.ttl - 1,
			relayCount: envelope.relayCount + 1,
			hops: [...envelope.hops, this.deviceId],
		};

		// Randomized delay (50–200ms) before forwarding to prevent
		// simultaneous relay storms in dense networks.
		const delay = RELAY_DELAY_MIN_MS + Math.random() * (RELAY_DELAY_MAX_MS - RELAY_DELAY_MIN_MS);
		setTimeout(() => {
			if (!this.running) return; // don't relay after shutdown
			this.forwardToAllPeers(relayed, fromPeerId);
		}, delay);
	}

	// ── Peer forwarding ───────────────────────────────────────────────

	/**
	 * Send an envelope to every connected BLE peer, excluding the
	 * sender to prevent echo loops.
	 *
	 * @param envelope      The envelope to forward.
	 * @param excludePeerId Peer to skip (the one that sent us this envelope).
	 */
	private forwardToAllPeers(envelope: EncryptedEnvelope, excludePeerId?: string) {
		const connectedPeers = this.bleTransport.getConnectedPeers()
			.filter((p) => p.id !== excludePeerId);

		if (connectedPeers.length > 0) {
			// Send individually so we can skip the sender
			for (const peer of connectedPeers) {
				this.bleTransport.sendEnvelope(peer.id, envelope).catch(() => {
					// Send failure is non-fatal; will retry via queue
				});
			}
		} else {
			// No eligible BLE peers — queue for later transmission
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


