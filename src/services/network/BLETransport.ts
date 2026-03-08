import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
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

/** How long to scan before auto-stopping (ms). 0 = indefinite. */
const SCAN_TIMEOUT_MS = 30_000;

/** Max envelope payload size in bytes (BLE ATT MTU is typically 512) */
const MAX_ENVELOPE_BYTES = 512;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BLEPeer = {
    id: string;           // BLE device ID (platform-specific)
    name: string | null;  // Advertised device name
    rssi: number | null;  // Signal strength
    device: Device;       // Underlying BLE device handle
    connected: boolean;
};

type BLETransportEvents = {
    envelopeReceived: (envelope: EncryptedEnvelope, fromPeerId: string) => void;
    peerDiscovered: (peer: BLEPeer) => void;
    peerConnected: (peer: BLEPeer) => void;
    peerDisconnected: (peerId: string) => void;
    error: (error: Error) => void;
    scanStateChanged: (scanning: boolean) => void;
};

// ── BLETransport ──────────────────────────────────────────────────────────────

/**
 * BLE transport layer for CYPHR mesh networking.
 *
 * Responsibilities:
 *  • Scan for nearby CYPHR nodes via BLE
 *  • Advertise this device as a BLE peripheral (CYPHR service)
 *  • Establish GATT connections with discovered peers
 *  • Send encrypted envelopes over BLE characteristics
 *  • Receive encrypted envelopes and emit events
 */
export class BLETransport {
    private manager: BleManager;
    private emitter = new EventEmitter<BLETransportEvents>();
    private peers = new Map<string, BLEPeer>();
    private scanning = false;
    private scanTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.manager = new BleManager();
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /** Tear down the BLE manager and release all resources. */
    destroy() {
        this.stopScanning();
        this.disconnectAll();
        this.manager.destroy();
    }

    // ── Scanning ──────────────────────────────────────────────────────────

    /**
     * Start scanning for nearby CYPHR BLE peripherals.
     * Discovered peers are emitted via `onPeerDiscovered`.
     */
    async startScanning(): Promise<void> {
        if (this.scanning) return;

        // Ensure Bluetooth is powered on
        const state = await this.manager.state();
        if (state !== State.PoweredOn) {
            this.emitter.emit('error', new Error(`Bluetooth is not ready (state: ${state})`));
            return;
        }

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

                // Only accept devices advertising the CYPHR service or name prefix
                const isCyphr =
                    device.name?.startsWith(CYPHR_DEVICE_PREFIX) ||
                    device.localName?.startsWith(CYPHR_DEVICE_PREFIX);

                if (!isCyphr && !device.serviceUUIDs?.includes(CYPHR_SERVICE_UUID)) return;

                // Skip if we already know this peer
                if (this.peers.has(device.id)) return;

                const peer: BLEPeer = {
                    id: device.id,
                    name: device.name || device.localName || null,
                    rssi: device.rssi,
                    device,
                    connected: false,
                };

                this.peers.set(device.id, peer);
                this.emitter.emit('peerDiscovered', peer);
            },
        );

        // Auto-stop after timeout
        if (SCAN_TIMEOUT_MS > 0) {
            this.scanTimer = setTimeout(() => this.stopScanning(), SCAN_TIMEOUT_MS);
        }
    }

    /** Stop scanning for BLE peripherals. */
    stopScanning(): void {
        if (!this.scanning) return;
        this.manager.stopDeviceScan();
        this.scanning = false;

        if (this.scanTimer) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }

        this.emitter.emit('scanStateChanged', false);
    }

    // ── Connection ────────────────────────────────────────────────────────

    /**
     * Connect to a discovered CYPHR peer and subscribe to incoming envelopes.
     * @param peerId  The BLE device ID returned from `onPeerDiscovered`.
     */
    async connectToPeer(peerId: string): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) {
            throw new Error(`Unknown peer: ${peerId}. Discover it first via startScanning().`);
        }
        if (peer.connected) return;

        try {
            // Connect to the peripheral
            const connectedDevice = await this.manager.connectToDevice(peerId, {
                timeout: 10_000,
            });

            // Discover services & characteristics
            await connectedDevice.discoverAllServicesAndCharacteristics();

            // Update peer record
            peer.device = connectedDevice;
            peer.connected = true;
            this.peers.set(peerId, peer);

            // Monitor disconnect
            this.manager.onDeviceDisconnected(peerId, () => {
                const p = this.peers.get(peerId);
                if (p) {
                    p.connected = false;
                    this.peers.set(peerId, p);
                }
                this.emitter.emit('peerDisconnected', peerId);
            });

            // Subscribe to incoming envelopes on the RX characteristic
            connectedDevice.monitorCharacteristicForService(
                CYPHR_SERVICE_UUID,
                CYPHR_RX_CHAR_UUID,
                (error, characteristic) => {
                    if (error) {
                        this.emitter.emit('error', error);
                        return;
                    }
                    if (!characteristic?.value) return;
                    this.handleIncomingData(characteristic.value, peerId);
                },
            );

            this.emitter.emit('peerConnected', peer);
        } catch (error) {
            this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    /** Disconnect from a specific peer. */
    async disconnectFromPeer(peerId: string): Promise<void> {
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

    // ── Send / Receive ────────────────────────────────────────────────────

    /**
     * Send an encrypted envelope to a specific connected peer.
     * @param peerId   BLE device ID of the target peer.
     * @param envelope The encrypted envelope to transmit.
     */
    async sendEnvelope(peerId: string, envelope: EncryptedEnvelope): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connected) {
            throw new Error(`Peer ${peerId} is not connected.`);
        }

        const payload = JSON.stringify(envelope);
        const base64Payload = this.stringToBase64(payload);

        if (base64Payload.length > MAX_ENVELOPE_BYTES) {
            throw new Error(
                `Envelope too large (${base64Payload.length} bytes). Max: ${MAX_ENVELOPE_BYTES}.`,
            );
        }

        await peer.device.writeCharacteristicWithResponseForService(
            CYPHR_SERVICE_UUID,
            CYPHR_TX_CHAR_UUID,
            base64Payload,
        );
    }

    /**
     * Broadcast an envelope to ALL connected peers.
     * @param envelope The encrypted envelope to broadcast.
     */
    async broadcastEnvelope(envelope: EncryptedEnvelope): Promise<void> {
        const connected = this.getConnectedPeers();
        const results = await Promise.allSettled(
            connected.map((peer) => this.sendEnvelope(peer.id, envelope)),
        );

        // Emit errors for any failed sends
        for (const result of results) {
            if (result.status === 'rejected') {
                this.emitter.emit(
                    'error',
                    result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
                );
            }
        }
    }

    /**
     * Parse incoming Base64 data from a BLE characteristic into an
     * EncryptedEnvelope and emit it.
     */
    private handleIncomingData(base64Data: string, fromPeerId: string): void {
        try {
            const json = this.base64ToString(base64Data);
            const envelope: EncryptedEnvelope = JSON.parse(json);

            // Basic shape validation
            if (!envelope.id || !envelope.ciphertext || !envelope.senderId) {
                throw new Error('Invalid envelope structure');
            }

            this.emitter.emit('envelopeReceived', envelope, fromPeerId);
        } catch (error) {
            this.emitter.emit(
                'error',
                new Error(`Failed to parse inbound envelope: ${error}`),
            );
        }
    }

    // ── Event subscriptions ───────────────────────────────────────────────

    /** Called when an encrypted envelope is received from any peer. */
    onEnvelopeReceived(cb: (envelope: EncryptedEnvelope, fromPeerId: string) => void) {
        this.emitter.on('envelopeReceived', cb);
        return () => this.emitter.off('envelopeReceived', cb);
    }

    /** Called when a new CYPHR peer is discovered during scanning. */
    onPeerDiscovered(cb: (peer: BLEPeer) => void) {
        this.emitter.on('peerDiscovered', cb);
        return () => this.emitter.off('peerDiscovered', cb);
    }

    /** Called when a peer connection is established. */
    onPeerConnected(cb: (peer: BLEPeer) => void) {
        this.emitter.on('peerConnected', cb);
        return () => this.emitter.off('peerConnected', cb);
    }

    /** Called when a peer disconnects. */
    onPeerDisconnected(cb: (peerId: string) => void) {
        this.emitter.on('peerDisconnected', cb);
        return () => this.emitter.off('peerDisconnected', cb);
    }

    /** Called when a transport error occurs. */
    onError(cb: (error: Error) => void) {
        this.emitter.on('error', cb);
        return () => this.emitter.off('error', cb);
    }

    /** Called when scanning starts or stops. */
    onScanStateChanged(cb: (scanning: boolean) => void) {
        this.emitter.on('scanStateChanged', cb);
        return () => this.emitter.off('scanStateChanged', cb);
    }

    // ── Queries ───────────────────────────────────────────────────────────

    /** Return all discovered peers (connected or not). */
    getDiscoveredPeers(): BLEPeer[] {
        return Array.from(this.peers.values());
    }

    /** Return only currently connected peers. */
    getConnectedPeers(): BLEPeer[] {
        return Array.from(this.peers.values()).filter((p) => p.connected);
    }

    /** Whether a scan is currently active. */
    isScanning(): boolean {
        return this.scanning;
    }

    // ── Base64 helpers (React Native compatible) ──────────────────────────

    private stringToBase64(str: string): string {
        // Use a simple encoding that works in both RN and Node.js
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
