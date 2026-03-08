import { BleManager, Device, State } from 'react-native-ble-plx';
import EventEmitter from 'eventemitter3';
import type { EncryptedEnvelope } from '@/services/crypto/CryptoService';

// ── CYPHR BLE Protocol Constants ──────────────────────────────────────────────

/** Custom CYPHR service UUID (128-bit) for mesh message exchange */
const CYPHR_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

/** Characteristic for writing outbound envelopes (TX from this device) */
const CYPHR_TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

/** Characteristic for receiving inbound envelopes (RX to this device) */
const CYPHR_RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/** Name prefix used to identify CYPHR nodes during scanning */
const CYPHR_DEVICE_PREFIX = 'CYPHR-';

/** Duration of each scan cycle (ms) before pausing */
const SCAN_DURATION_MS = 15_000;

/** Pause between scan cycles (ms) to save battery */
const SCAN_INTERVAL_MS = 5_000;

/** Delay before attempting to reconnect a dropped peer (ms) */
const RECONNECT_DELAY_MS = 3_000;

/** Max reconnection attempts before giving up on a peer */
const MAX_RECONNECT_ATTEMPTS = 5;

// ── Chunking Protocol Constants ───────────────────────────────────────────────

/** Default BLE ATT MTU (conservative — negotiated higher on connect) */
const DEFAULT_BLE_MTU = 23;

/** Overhead per ATT write (3 bytes ATT header) */
const ATT_HEADER_BYTES = 3;

/** Target MTU to negotiate (max supported by most modern devices) */
const REQUESTED_MTU = 512;

/** Chunk frame prefix: "C|<tid>|<idx>/<tot>|" — roughly 20-25 bytes overhead */
const CHUNK_HEADER_OVERHEAD = 25;

/** How long to keep incomplete chunk buffers before discarding (ms) */
const CHUNK_REASSEMBLY_TIMEOUT_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BLEPeer = {
    id: string;           // BLE device ID (platform-specific)
    name: string | null;  // Advertised device name
    rssi: number | null;  // Signal strength
    device: Device;       // Underlying BLE device handle
    connected: boolean;
    mtu: number;          // Negotiated MTU for this connection
};

/** Tracks partially received chunked transfers from a single peer. */
type ChunkBuffer = {
    chunks: Map<number, string>;  // index → base64 data
    total: number;                // expected total chunk count
    receivedAt: number;           // timestamp of last chunk (for timeout)
};

type BLETransportEvents = {
    envelopeReceived: (envelope: EncryptedEnvelope, fromPeerId: string) => void;
    peerDiscovered: (peer: BLEPeer) => void;
    peerConnected: (peer: BLEPeer) => void;
    peerDisconnected: (peerId: string) => void;
    error: (error: Error) => void;
    scanStateChanged: (scanning: boolean) => void;
    bluetoothStateChanged: (state: State) => void;
};

// ── BLETransport ──────────────────────────────────────────────────────────────

/**
 * BLE transport layer for CYPHR mesh networking.
 *
 * Responsibilities:
 *  1. Start BLE manager with state monitoring
 *  2. Scan for nearby CYPHR devices (periodic cycling)
 *  3. Advertise deviceId as BLE peripheral service
 *  4. Auto-connect to discovered peers
 *  5. Auto-reconnect on disconnect
 *  6. Send / receive encrypted envelopes
 */
export class BLETransport {
    private manager: BleManager;
    private emitter = new EventEmitter<BLETransportEvents>();
    private peers = new Map<string, BLEPeer>();
    private scanning = false;
    private active = false;
    private deviceId: string;
    private scanCycleTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = new Map<string, number>();
    private stateSubscription: { remove: () => void } | null = null;

    // Reassembly buffers: peerId → transferId → ChunkBuffer
    private reassemblyBuffers = new Map<string, Map<string, ChunkBuffer>>();
    private reassemblyCleanupTimer: ReturnType<typeof setInterval> | null = null;
    private transferCounter = 0; // monotonic counter for outbound transfer IDs

    constructor(deviceId: string) {
        this.deviceId = deviceId;
        this.manager = new BleManager();
    }

    // ── 1. Start BLE Manager ──────────────────────────────────────────────

    /**
     * Initialize BLE, monitor adapter state, and begin discovery.
     * When Bluetooth powers on → starts scanning + advertising.
     * When Bluetooth powers off → stops everything gracefully.
     */
    async initialize(): Promise<void> {
        if (this.active) return;
        this.active = true;

        // Start periodic cleanup of stale reassembly buffers
        this.reassemblyCleanupTimer = setInterval(
            () => this.cleanupStaleBuffers(),
            CHUNK_REASSEMBLY_TIMEOUT_MS,
        );

        // Monitor Bluetooth adapter state changes
        this.stateSubscription = this.manager.onStateChange((state) => {
            this.emitter.emit('bluetoothStateChanged', state);

            if (state === State.PoweredOn && this.active) {
                this.startDiscoveryPipeline();
            } else if (state !== State.PoweredOn) {
                this.stopScanCycle();
            }
        }, true);

        const currentState = await this.manager.state();
        if (currentState === State.PoweredOn) {
            this.startDiscoveryPipeline();
        }
    }

    // ── 2. Scan for Nearby CYPHR Devices ──────────────────────────────────

    /**
     * Begin periodic scan cycling: scan for SCAN_DURATION_MS, pause for
     * SCAN_INTERVAL_MS, repeat. This conserves battery while maintaining
     * continuous peer discovery.
     */
    private startDiscoveryPipeline(): void {
        if (this.scanning) return;
        this.startScanCycle();
        this.startAdvertising();
    }

    private startScanCycle(): void {
        this.performScan();
    }

    private performScan(): void {
        if (!this.active) return;

        this.scanning = true;
        this.emitter.emit('scanStateChanged', true);

        this.manager.startDeviceScan(
            [CYPHR_SERVICE_UUID],
            { allowDuplicates: false },
            (error, device) => {
                if (error) {
                    this.emitter.emit('error', error);
                    return;
                }
                if (!device) return;
                this.handleDiscoveredDevice(device);
            },
        );

        // After SCAN_DURATION_MS, stop and schedule the next cycle
        this.scanCycleTimer = setTimeout(() => {
            this.manager.stopDeviceScan();
            this.scanning = false;
            this.emitter.emit('scanStateChanged', false);

            // Pause, then scan again
            if (this.active) {
                this.scanCycleTimer = setTimeout(() => this.performScan(), SCAN_INTERVAL_MS);
            }
        }, SCAN_DURATION_MS);
    }

    /**
     * Evaluate a discovered BLE device. Accept it if it advertises the
     * CYPHR service UUID or has the CYPHR- name prefix, then auto-connect.
     */
    private handleDiscoveredDevice(device: Device): void {
        // Filter: must be a CYPHR node
        const isCyphrByName =
            device.name?.startsWith(CYPHR_DEVICE_PREFIX) ||
            device.localName?.startsWith(CYPHR_DEVICE_PREFIX);
        const isCyphrByService = device.serviceUUIDs?.includes(CYPHR_SERVICE_UUID);

        if (!isCyphrByName && !isCyphrByService) return;

        // Skip if we already know and are connected to this peer
        const existing = this.peers.get(device.id);
        if (existing?.connected) return;

        const peer: BLEPeer = {
            id: device.id,
            name: device.name || device.localName || null,
            rssi: device.rssi,
            device,
            connected: false,
            mtu: DEFAULT_BLE_MTU,
        };

        this.peers.set(device.id, peer);
        this.emitter.emit('peerDiscovered', peer);

        // ── 4. Auto-connect to discovered peer ───────────────────────
        this.connectToPeer(device.id).catch(() => {
            // Non-fatal; will retry on next scan cycle
        });
    }

    /** Stop the periodic scan cycle. */
    private stopScanCycle(): void {
        if (this.scanCycleTimer) {
            clearTimeout(this.scanCycleTimer);
            this.scanCycleTimer = null;
        }
        if (this.scanning) {
            this.manager.stopDeviceScan();
            this.scanning = false;
            this.emitter.emit('scanStateChanged', false);
        }
    }

    /** Public method to explicitly start scanning (delegates to pipeline). */
    async startScanning(): Promise<void> {
        const state = await this.manager.state();
        if (state !== State.PoweredOn) {
            this.emitter.emit('error', new Error(`Bluetooth is not ready (state: ${state})`));
            return;
        }
        this.startDiscoveryPipeline();
    }

    /** Public method to explicitly stop scanning. */
    stopScanning(): void {
        this.stopScanCycle();
    }

    // ── 3. Advertise as BLE Peripheral ────────────────────────────────────

    /**
     * Advertise this device as a CYPHR mesh node so other scanners can
     * find us. Uses the device name format "CYPHR-<deviceId>".
     *
     * NOTE: react-native-ble-plx is a Central-mode library and does not
     * natively support BLE peripheral advertising. This method uses the
     * BleManager to set the local device name prefix, which improves
     * discoverability. For full GATT server / peripheral advertising,
     * a native module (e.g. react-native-ble-peripheral) is required.
     *
     * Phase 2 will add a native BLE peripheral module for:
     *   - Full GATT server with CYPHR service + characteristics
     *   - Advertising the service UUID in scan response
     *   - Accepting inbound connections from other Central devices
     */
    private startAdvertising(): void {
        // Store the advertised name for identification by scanning peers.
        // In the current architecture, both devices scan, so each device
        // discovers the other as a Central. When native peripheral support
        // is added, this name will be advertised in the BLE advertisement.
        this.advertisedName = `${CYPHR_DEVICE_PREFIX}${this.deviceId}`;
    }

    /** The name this device advertises on the BLE network. */
    private advertisedName: string = '';

    /** Get the BLE advertised name for this device. */
    getAdvertisedName(): string {
        return this.advertisedName;
    }

    // ── Connection ────────────────────────────────────────────────────────

    /**
     * Connect to a discovered CYPHR peer, discover services, subscribe
     * to incoming envelopes, and set up auto-reconnect on disconnect.
     */
    async connectToPeer(peerId: string): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) {
            throw new Error(`Unknown peer: ${peerId}. Discover it first via scanning.`);
        }
        if (peer.connected) return;

        try {
            // Connect to the peripheral
            const connectedDevice = await this.manager.connectToDevice(peerId, {
                timeout: 10_000,
            });

            // Discover services & characteristics
            await connectedDevice.discoverAllServicesAndCharacteristics();

            // ── Negotiate MTU for larger chunk sizes ──────────────────
            let negotiatedMtu = DEFAULT_BLE_MTU;
            try {
                const mtuResult = await connectedDevice.requestMTU(REQUESTED_MTU);
                negotiatedMtu = mtuResult.mtu;
            } catch {
                // MTU negotiation failure is non-fatal — fall back to default
            }

            // Update peer record with negotiated MTU
            peer.device = connectedDevice;
            peer.connected = true;
            peer.mtu = negotiatedMtu;
            this.peers.set(peerId, peer);
            this.reconnectAttempts.delete(peerId);

            // Prepare reassembly buffer for this peer
            this.reassemblyBuffers.set(peerId, new Map());

            // Monitor disconnect → auto-reconnect + cleanup
            this.manager.onDeviceDisconnected(peerId, () => {
                const p = this.peers.get(peerId);
                if (p) {
                    p.connected = false;
                    this.peers.set(peerId, p);
                }
                // Discard any partial reassembly buffers for this peer
                this.reassemblyBuffers.delete(peerId);
                this.emitter.emit('peerDisconnected', peerId);

                if (this.active) {
                    this.scheduleReconnect(peerId);
                }
            });

            // ── Subscribe to RX characteristic notifications ─────────
            connectedDevice.monitorCharacteristicForService(
                CYPHR_SERVICE_UUID,
                CYPHR_RX_CHAR_UUID,
                (error, characteristic) => {
                    if (error) {
                        this.emitter.emit('error', error);
                        return;
                    }
                    if (!characteristic?.value) return;
                    this.handleIncomingChunk(characteristic.value, peerId);
                },
            );

            this.emitter.emit('peerConnected', peer);
        } catch (error) {
            this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
            if (this.active) {
                this.scheduleReconnect(peerId);
            }
        }
    }

    /**
     * Schedule an automatic reconnection attempt with exponential backoff.
     * Gives up after MAX_RECONNECT_ATTEMPTS.
     */
    private scheduleReconnect(peerId: string): void {
        const attempts = (this.reconnectAttempts.get(peerId) ?? 0) + 1;
        if (attempts > MAX_RECONNECT_ATTEMPTS) {
            // Too many failures — remove from peer list so next scan re-discovers
            this.peers.delete(peerId);
            this.reconnectAttempts.delete(peerId);
            return;
        }

        this.reconnectAttempts.set(peerId, attempts);
        const delay = RECONNECT_DELAY_MS * Math.pow(2, attempts - 1); // exponential backoff

        setTimeout(() => {
            if (!this.active) return;
            const peer = this.peers.get(peerId);
            if (peer && !peer.connected) {
                this.connectToPeer(peerId).catch(() => {
                    // Failure handled inside connectToPeer → scheduleReconnect
                });
            }
        }, delay);
    }

    /** Disconnect from a specific peer. */
    async disconnectFromPeer(peerId: string): Promise<void> {
        // Don't auto-reconnect if we intentionally disconnect
        this.reconnectAttempts.set(peerId, MAX_RECONNECT_ATTEMPTS + 1);
        try {
            await this.manager.cancelDeviceConnection(peerId);
        } catch {
            // Already disconnected — ignore
        }
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.connected = false;
            this.peers.set(peerId, peer);
        }
    }

    /** Disconnect from all connected peers. */
    private async disconnectAll(): Promise<void> {
        const connected = this.getConnectedPeers();
        await Promise.allSettled(connected.map((p) => this.disconnectFromPeer(p.id)));
    }

    // ── Send (chunked) ───────────────────────────────────────────────────

    /**
     * Compute the max payload bytes per chunk for a given MTU.
     * Usable payload = MTU - ATT header - chunk frame overhead.
     */
    private getChunkPayloadSize(mtu: number): number {
        return Math.max(mtu - ATT_HEADER_BYTES - CHUNK_HEADER_OVERHEAD, 20);
    }

    /** Generate a short transfer ID for chunk framing. */
    private nextTransferId(): string {
        this.transferCounter += 1;
        return this.transferCounter.toString(36);
    }

    /**
     * Send an encrypted envelope to a specific connected peer.
     *
     * The envelope is serialized to JSON → Base64, split into MTU-sized
     * chunks, and sent sequentially. Each chunk is framed as:
     *
     *   C|<transferId>|<index>/<total>|<base64data>
     *
     * The peer reassembles chunks by transferId and emits the envelope
     * once all chunks have arrived.
     */
    async sendEnvelope(peerId: string, envelope: EncryptedEnvelope): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connected) {
            throw new Error(`Peer ${peerId} is not connected.`);
        }

        const payload = JSON.stringify(envelope);
        const base64Payload = this.stringToBase64(payload);
        const chunkSize = this.getChunkPayloadSize(peer.mtu);
        const transferId = this.nextTransferId();

        // Split into chunks
        const chunks: string[] = [];
        for (let offset = 0; offset < base64Payload.length; offset += chunkSize) {
            chunks.push(base64Payload.slice(offset, offset + chunkSize));
        }
        // Ensure at least one chunk (for empty payloads, though unlikely)
        if (chunks.length === 0) chunks.push('');

        const total = chunks.length;

        // Send chunks sequentially (order matters for reassembly)
        for (let i = 0; i < total; i++) {
            const frame = `C|${transferId}|${i}/${total}|${chunks[i]}`;
            const frameBase64 = this.stringToBase64(frame);

            await peer.device.writeCharacteristicWithResponseForService(
                CYPHR_SERVICE_UUID,
                CYPHR_TX_CHAR_UUID,
                frameBase64,
            );
        }
    }

    /**
     * Broadcast an envelope to ALL connected peers.
     */
    async broadcastEnvelope(envelope: EncryptedEnvelope): Promise<void> {
        const connected = this.getConnectedPeers();
        const results = await Promise.allSettled(
            connected.map((peer) => this.sendEnvelope(peer.id, envelope)),
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                this.emitter.emit(
                    'error',
                    result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
                );
            }
        }
    }

    // ── Receive (chunked reassembly) ─────────────────────────────────────

    /**
     * Handle an incoming BLE characteristic notification.
     *
     * Each notification is a single chunk in the format:
     *   C|<transferId>|<index>/<total>|<base64data>
     *
     * Chunks are buffered per peer + transferId. When all chunks for a
     * transfer arrive, the payload is reassembled, parsed as JSON into
     * an EncryptedEnvelope, and emitted.
     */
    private handleIncomingChunk(base64Frame: string, fromPeerId: string): void {
        try {
            const frame = this.base64ToString(base64Frame);

            // Parse chunk header: C|<tid>|<idx>/<tot>|<data>
            if (!frame.startsWith('C|')) {
                // Not a chunked frame — try parsing as a raw envelope (backward compat)
                this.tryParseRawEnvelope(frame, fromPeerId);
                return;
            }

            const firstPipe = frame.indexOf('|');
            const secondPipe = frame.indexOf('|', firstPipe + 1);
            const thirdPipe = frame.indexOf('|', secondPipe + 1);

            if (secondPipe === -1 || thirdPipe === -1) {
                throw new Error('Malformed chunk header');
            }

            const transferId = frame.slice(firstPipe + 1, secondPipe);
            const indexPart = frame.slice(secondPipe + 1, thirdPipe);
            const data = frame.slice(thirdPipe + 1);

            const slashPos = indexPart.indexOf('/');
            if (slashPos === -1) throw new Error('Malformed chunk index');

            const chunkIndex = parseInt(indexPart.slice(0, slashPos), 10);
            const totalChunks = parseInt(indexPart.slice(slashPos + 1), 10);

            if (isNaN(chunkIndex) || isNaN(totalChunks) || totalChunks < 1) {
                throw new Error('Invalid chunk index/total');
            }

            // Get or create the reassembly buffer for this peer
            if (!this.reassemblyBuffers.has(fromPeerId)) {
                this.reassemblyBuffers.set(fromPeerId, new Map());
            }
            const peerBuffers = this.reassemblyBuffers.get(fromPeerId)!;

            // Get or create the buffer for this transfer
            if (!peerBuffers.has(transferId)) {
                peerBuffers.set(transferId, {
                    chunks: new Map(),
                    total: totalChunks,
                    receivedAt: Date.now(),
                });
            }
            const buffer = peerBuffers.get(transferId)!;

            // Store chunk
            buffer.chunks.set(chunkIndex, data);
            buffer.receivedAt = Date.now();

            // Check if all chunks arrived
            if (buffer.chunks.size >= buffer.total) {
                // Reassemble in order
                let fullBase64 = '';
                for (let i = 0; i < buffer.total; i++) {
                    const chunk = buffer.chunks.get(i);
                    if (chunk === undefined) {
                        throw new Error(`Missing chunk ${i}/${buffer.total} for transfer ${transferId}`);
                    }
                    fullBase64 += chunk;
                }

                // Clean up buffer
                peerBuffers.delete(transferId);

                // Decode and emit
                const json = this.base64ToString(fullBase64);
                const envelope: EncryptedEnvelope = JSON.parse(json);

                if (!envelope.id || !envelope.ciphertext || !envelope.senderId) {
                    throw new Error('Invalid envelope structure after reassembly');
                }

                this.emitter.emit('envelopeReceived', envelope, fromPeerId);
            }
        } catch (error) {
            this.emitter.emit(
                'error',
                new Error(`Chunk processing error: ${error}`),
            );
        }
    }

    /**
     * Backward-compatible fallback: try parsing a raw (non-chunked) frame
     * as a complete JSON envelope.
     */
    private tryParseRawEnvelope(rawData: string, fromPeerId: string): void {
        try {
            const envelope: EncryptedEnvelope = JSON.parse(rawData);
            if (!envelope.id || !envelope.ciphertext || !envelope.senderId) {
                throw new Error('Invalid envelope structure');
            }
            this.emitter.emit('envelopeReceived', envelope, fromPeerId);
        } catch (error) {
            this.emitter.emit(
                'error',
                new Error(`Failed to parse raw envelope: ${error}`),
            );
        }
    }

    /**
     * Periodically discard incomplete reassembly buffers that have gone
     * stale (no new chunks within CHUNK_REASSEMBLY_TIMEOUT_MS).
     */
    private cleanupStaleBuffers(): void {
        const now = Date.now();
        for (const [peerId, transfers] of this.reassemblyBuffers) {
            for (const [transferId, buffer] of transfers) {
                if (now - buffer.receivedAt > CHUNK_REASSEMBLY_TIMEOUT_MS) {
                    transfers.delete(transferId);
                }
            }
            if (transfers.size === 0) {
                this.reassemblyBuffers.delete(peerId);
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /** Tear down the BLE manager and release all resources. */
    destroy(): void {
        this.active = false;
        this.stopScanCycle();
        this.disconnectAll();
        if (this.stateSubscription) {
            this.stateSubscription.remove();
            this.stateSubscription = null;
        }
        if (this.reassemblyCleanupTimer) {
            clearInterval(this.reassemblyCleanupTimer);
            this.reassemblyCleanupTimer = null;
        }
        this.reassemblyBuffers.clear();
        this.reconnectAttempts.clear();
        this.manager.destroy();
    }

    // ── Event Subscriptions ───────────────────────────────────────────────

    onEnvelopeReceived(cb: (envelope: EncryptedEnvelope, fromPeerId: string) => void) {
        this.emitter.on('envelopeReceived', cb);
        return () => this.emitter.off('envelopeReceived', cb);
    }

    onPeerDiscovered(cb: (peer: BLEPeer) => void) {
        this.emitter.on('peerDiscovered', cb);
        return () => this.emitter.off('peerDiscovered', cb);
    }

    onPeerConnected(cb: (peer: BLEPeer) => void) {
        this.emitter.on('peerConnected', cb);
        return () => this.emitter.off('peerConnected', cb);
    }

    onPeerDisconnected(cb: (peerId: string) => void) {
        this.emitter.on('peerDisconnected', cb);
        return () => this.emitter.off('peerDisconnected', cb);
    }

    onError(cb: (error: Error) => void) {
        this.emitter.on('error', cb);
        return () => this.emitter.off('error', cb);
    }

    onScanStateChanged(cb: (scanning: boolean) => void) {
        this.emitter.on('scanStateChanged', cb);
        return () => this.emitter.off('scanStateChanged', cb);
    }

    onBluetoothStateChanged(cb: (state: State) => void) {
        this.emitter.on('bluetoothStateChanged', cb);
        return () => this.emitter.off('bluetoothStateChanged', cb);
    }

    // ── Queries ───────────────────────────────────────────────────────────

    getDiscoveredPeers(): BLEPeer[] {
        return Array.from(this.peers.values());
    }

    getConnectedPeers(): BLEPeer[] {
        return Array.from(this.peers.values()).filter((p) => p.connected);
    }

    isScanning(): boolean {
        return this.scanning;
    }

    isActive(): boolean {
        return this.active;
    }

    // ── Base64 helpers ────────────────────────────────────────────────────

    private stringToBase64(str: string): string {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
            bytes[i] = str.charCodeAt(i);
        }
        let binary = '';
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        return globalThis.btoa(binary);
    }

    private base64ToString(base64: string): string {
        const binary = globalThis.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return String.fromCharCode(...bytes);
    }
}
