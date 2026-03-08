# CYPHR — Offline-First Mesh Communication Network

**CYPHR** is a next-generation peer-to-peer mesh communication system enabling secure, encrypted messaging over Bluetooth 5.0 and Wi-Fi Direct without requiring towers, satellites, or active internet. Built for disaster relief, emergency response, remote operations, and secure field communications.

---

## 🎯 Vision

CYPHR is **not just a chat app** — it's a **lifeline** when all else fails. Each connected device acts as a relay node, storing and forwarding encrypted messages until they reach the intended recipient.

---

## ✅ Phase 1: Secure Local Prototype (COMPLETED)

### Features Implemented

✅ **Device Key Persistence**
- Symmetric AES-256 encryption keys generated and stored per device
- Keys persist across app restarts using AsyncStorage
- Automatic key initialization on first launch

✅ **Encrypted Messaging**
- End-to-end AES encryption using crypto-js
- Message integrity verification via SHA-256 checksums
- Support for broadcast and direct messages

✅ **Mesh Manager (Prototype)**
- Event-driven architecture with message and status updates
- Store-and-forward queue for offline message relay
- Simulated peer discovery (BLE/Wi-Fi Direct stubs ready for Phase 2)

✅ **UI & Developer Tools**
- Clean chat interface with message history
- Device info header showing device ID and masked encryption key
- "Generate New Key" button for testing key rotation
- Message status indicators (queued, sent, delivered, relayed)

---

## 🏗️ Architecture

```
CYPHR/
├── src/
│   ├── components/
│   │   ├── ChatScreen.tsx          # Main chat UI
│   │   └── DeviceInfoHeader.tsx    # Device ID and key display
│   ├── services/
│   │   ├── crypto/
│   │   │   └── CryptoService.ts    # AES encryption, key generation
│   │   ├── mesh/
│   │   │   └── MeshManager.ts      # Peer discovery, message routing
│   │   └── storage/
│   │       └── Storage.ts          # AsyncStorage wrapper for persistence
│   └── App.tsx                     # App entry point
```

### Key Modules

**CryptoService**
- `generateSymmetricKey()` — Creates 256-bit AES keys
- `deriveKeyFromPassphrase()` — PBKDF2-based key derivation
- `encryptMessage()` / `decryptMessage()` — AES-256 with checksum validation

**MeshManager**
- `start()` / `stop()` — Lifecycle management
- `sendText()` — Encrypt and queue outbound messages
- `onMessage()` / `onStatusUpdate()` — Event subscriptions
- `regenerateDeviceKey()` — Key rotation support

**Storage**
- `getAllMessages()` / `saveMessage()` / `updateStatus()` — Message persistence
- `getDeviceKey()` / `setDeviceKey()` — Secure key storage

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Expo CLI (installed automatically)

### Installation

```powershell
# Clone or navigate to project
cd D:\MY works\MY_IDEAS\MESH

# Install dependencies
npm install

# Start development server
npm start
```

### Running the App

After `npm start`, you can:
- Press `w` to open in web browser (for quick testing)
- Press `a` to run on Android emulator
- Press `i` to run on iOS simulator
- Scan QR code with Expo Go app on physical device

### Testing Key Persistence

1. Launch the app
2. Send a message (it will be encrypted with generated device key)
3. Check the Device Info Header for your device ID and masked key
4. Close and restart the app
5. Verify the same device ID and key are loaded
6. Click "Generate New Key" to test key rotation

---

## 📋 Phase Roadmap

### ✅ Phase 1: Secure Local Prototype (Current)
- [x] Device key persistence with AsyncStorage
- [x] AES-256 symmetric encryption
- [x] Store-and-forward message queue
- [x] Minimal chat UI with status indicators
- [x] Developer overlay for device info

### 🔄 Phase 2: Multi-Hop Mesh Relay (Next)
- [ ] Bluetooth 5.0 LE integration (`react-native-ble-plx`)
- [ ] Wi-Fi Direct support (Android native module)
- [ ] Peer discovery and connection management
- [ ] Multi-hop message routing with TTL
- [ ] Relay count and path tracking
- [ ] Dynamic routing based on peer availability

### 🔮 Phase 3: Hybrid Cloud Integration
- [ ] Optional internet fallback when available
- [ ] Lightweight cloud relay (Firebase or custom API)
- [ ] Seamless offline-to-online sync
- [ ] Message delivery acknowledgments

### 🛡️ Phase 4: Optimization & Security
- [ ] Public-key cryptography (libsodium/tweetnacl)
- [ ] Secure key exchange protocol
- [ ] Battery optimization for long-term disaster use
- [ ] User authentication system
- [ ] Message verification and integrity checks
- [ ] File attachment support (images, audio)

---

## 🔐 Security Notes

**Phase 1 Security Model:**
- Uses symmetric AES-256 encryption
- Keys stored locally in AsyncStorage (not encrypted at rest)
- Default dev key for fallback (change in production!)

**Roadmap:**
- Phase 2 will add public-key infrastructure
- Phase 4 will implement secure key exchange (X25519 ECDH)
- Consider hardware security modules for production deployments

---

## 🧪 Testing

```powershell
# Type check
npx tsc --noEmit

# Run unit tests (when added)
npm test

# Run on Android
npm run android

# Run on iOS
npm run ios
```

---

## 📦 Dependencies

**Core:**
- `expo` — React Native framework
- `react-native` — Mobile app platform
- `@react-native-async-storage/async-storage` — Persistent storage

**Crypto:**
- `crypto-js` — AES encryption and hashing
- `uuid` — Unique message and device IDs

**Future (Phase 2):**
- `react-native-ble-plx` — Bluetooth LE
- `react-native-wifi-p2p` — Wi-Fi Direct (Android)
- `tweetnacl` or `libsodium-wrappers` — Public-key crypto

---

## 🤝 Contributing

CYPHR is built for humanitarian and emergency use cases. Contributions focused on:
- Reliability and fault tolerance
- Battery efficiency
- Security hardening
- Cross-platform compatibility

are especially welcome.

---

## 📄 License

MIT — Built as a lifeline for communication when all else fails.

---

## 🛠️ Development Notes

**Current State:**
- Encryption and storage layers are production-ready
- Mesh networking is simulated (prototype loops)
- Real BLE/Wi-Fi Direct integration is Phase 2 priority

**Next Steps:**
1. Add `react-native-ble-plx` for Bluetooth LE
2. Implement peer discovery service
3. Build connection state manager
4. Add TTL and relay count to message envelope
5. Test multi-device mesh relay scenarios

**Known Limitations:**
- No real peer-to-peer transport yet (uses simulated delivery)
- Keys stored in plain AsyncStorage (needs hardware security)
- No battery optimization strategies implemented
- iOS Wi-Fi Direct support limited (Apple restrictions)

---

**CYPHR** — Communication when it matters most. 🌐🔐
