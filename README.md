<p align="center">
  <h1 align="center">🔐 CYPHR</h1>
  <p align="center">
    <strong>Offline-First Mesh Communication Network</strong>
  </p>
  <p align="center">
    Secure, encrypted peer-to-peer messaging over Bluetooth &amp; Wi-Fi Direct.<br/>
    No towers. No satellites. No internet. Just your phone and your people.
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"/></a>
    <img src="https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg" alt="Platform"/>
    <img src="https://img.shields.io/badge/Phase-2%20(BLE%20Mesh)-orange.svg" alt="Phase"/>
    <img src="https://img.shields.io/badge/Encryption-AES--256-purple.svg" alt="Encryption"/>
    <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome"/>
  </p>
</p>

---

## 🎯 What is CYPHR?

CYPHR is **not just a chat app** — it's a **lifeline** when all else fails.

When earthquakes destroy cell towers, when hurricanes knock out power grids, when floods isolate communities — CYPHR keeps people connected. Every phone running CYPHR becomes a relay node in a self-healing mesh network, storing and forwarding encrypted messages until they reach the intended recipient.

**Built for:**
- 🌊 Disaster relief coordination
- 🚑 Emergency first-responder communication
- 🏔️ Remote field operations
- 🔒 Secure offline messaging
- 🌍 Areas with no cellular infrastructure

---

## ✨ Features

| Feature | Status | Description |
|---------|--------|-------------|
| **AES-256 Encryption** | ✅ Stable | End-to-end symmetric encryption with SHA-256 integrity |
| **Device Key Persistence** | ✅ Stable | Cryptographic identity survives app restarts |
| **Store-and-Forward Queue** | ✅ Stable | Messages queue offline and deliver when a path is found |
| **Bluetooth 5.0 LE Mesh** | 🔄 Beta | BLE peer discovery, auto-connect, and relay |
| **Multi-Hop Relay** | 🔄 Beta | Messages hop across devices with TTL and deduplication |
| **Chunked BLE Transfer** | 🔄 Beta | Large messages split across BLE MTU boundaries |
| **Auto-Reconnect** | 🔄 Beta | Exponential backoff reconnection for dropped peers |
| **Wi-Fi Direct** | 📋 Planned | High-bandwidth peer-to-peer transport |
| **Public-Key Crypto** | 📋 Planned | X25519 ECDH key exchange, forward secrecy |
| **SOS Beacon** | 📋 Planned | One-tap distress signal with GPS coordinates |
| **Voice Messages** | 📋 Planned | Compressed audio relay through mesh |
| **Group Channels** | 📋 Planned | Named channels with per-group encryption |
| **Cloud Bridge** | 📋 Planned | Optional internet fallback when available |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (installed automatically)
- Android Studio (for Android) or Xcode (for iOS)
- A physical device with Bluetooth 5.0 (for mesh features)

### Installation

```bash
# Clone the repository
git clone https://github.com/cyphr-mesh/cyphr.git
cd cyphr

# Install dependencies
npm install

# Verify TypeScript compiles
npx tsc --noEmit

# Start the development server
npm start
```

### Running on Device

After `npm start`, you can:
- Press `a` to run on Android emulator/device
- Press `i` to run on iOS simulator/device
- Scan the QR code with [Expo Go](https://expo.dev/go) on a physical device

> **Note:** BLE mesh features require a physical device — they don't work in emulators.

### Running Crypto Tests

```bash
node test-crypto.js
```

---

## 🏗️ Architecture

```
CYPHR/
├── src/
│   ├── App.tsx                          # App entry point
│   ├── components/
│   │   ├── ChatScreen.tsx               # Main chat UI
│   │   └── DeviceInfoHeader.tsx         # Device identity display
│   └── services/
│       ├── crypto/
│       │   └── CryptoService.ts         # AES-256 encryption engine
│       ├── mesh/
│       │   └── MeshManager.ts           # Mesh orchestration & relay logic
│       ├── network/
│       │   └── BLETransport.ts          # Bluetooth LE transport layer
│       └── storage/
│           └── Storage.ts               # AsyncStorage persistence
├── .github/                             # CI, templates, community files
├── LICENSE                              # AGPL-3.0
├── CONTRIBUTING.md                      # Contributor guide
├── SECURITY.md                          # Security policy
└── CHANGELOG.md                         # Version history
```

### How Messages Flow

```
User sends "Help needed at building 4"
    │
    ▼
┌──────────────────────────────────────┐
│ CryptoService.encryptMessage()       │
│ AES-256 encrypt → SHA-256 checksum   │
│ → EncryptedEnvelope                  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ MeshManager.sendText()               │
│ Queue envelope → BLE broadcast       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ BLETransport.sendEnvelope()          │
│ Chunk → frame → write to BLE GATT   │
│ C|<tid>|0/3|<base64>                 │
│ C|<tid>|1/3|<base64>                 │
│ C|<tid>|2/3|<base64>                 │
└──────────────┬───────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────┐         ┌─────────┐
│ Peer A  │ ──────► │ Peer B  │  (multi-hop relay)
│ relay   │         │ deliver │
└─────────┘         └─────────┘
```

### Relay Pipeline

Each message follows this path when received by a node:

1. **Dedup** — Check if we've seen this envelope ID before
2. **Deliver** — If addressed to us (or broadcast), decrypt and display
3. **TTL Check** — Drop if time-to-live is exhausted
4. **Probabilistic Relay** — 70% chance of forwarding (prevents storms)
5. **Delayed Forward** — Random 50-200ms jitter before relaying to all peers

---

## 📋 Phase Roadmap

### ✅ Phase 1: Secure Local Prototype — `v0.1.0`
- [x] AES-256 symmetric encryption with SHA-256 integrity
- [x] Device key persistence (AsyncStorage)
- [x] PBKDF2 key derivation from passphrase
- [x] Store-and-forward message queue
- [x] Chat UI with message status indicators
- [x] Device info header with masked key display
- [x] Key regeneration support

### 🔄 Phase 2: Multi-Hop BLE Mesh — `v0.2.0` (current)
- [x] Bluetooth 5.0 LE transport layer
- [x] GATT service/characteristic protocol
- [x] Peer discovery and auto-connection
- [x] MTU negotiation for optimal chunk sizes
- [x] Chunked message transfer protocol
- [x] Multi-hop relay with TTL
- [x] Deduplication cache (500 entries)
- [x] Probabilistic relay (70% forward rate)
- [x] Auto-reconnect with exponential backoff
- [ ] Wi-Fi Direct transport adapter
- [ ] Transport abstraction layer (pluggable transports)
- [ ] Network topology visualization

### 📋 Phase 3: Hybrid Cloud Bridge
- [ ] Optional internet fallback when connectivity returns
- [ ] Lightweight cloud relay (Firebase or custom API)
- [ ] Seamless offline-to-online message sync
- [ ] Delivery acknowledgments and read receipts
- [ ] Cross-mesh bridging (connect isolated mesh networks via internet)

### 📋 Phase 4: Security Hardening & Optimization
- [ ] Public-key cryptography (libsodium / tweetnacl)
- [ ] X25519 ECDH key exchange
- [ ] Perfect forward secrecy
- [ ] HMAC message authentication
- [ ] Hardware keystore integration (iOS Keychain / Android Keystore)
- [ ] Battery optimization strategies
- [ ] User authentication
- [ ] File attachments (images, audio, documents)

### 📋 Phase 5: Humanitarian Features
- [ ] 🆘 SOS Beacon — one-tap distress signal with GPS
- [ ] 🔊 Voice messages — compressed audio through mesh
- [ ] 👥 Group channels — named groups with per-channel encryption
- [ ] 📋 Emergency templates — "I'm safe", "Need help", "Trapped at [location]"
- [ ] 🌍 Offline translation — pre-loaded phrase packs
- [ ] 📸 Image transfer — compressed photos through mesh
- [ ] 📍 BLE RSSI positioning — GPS-less approximate location

---

## 🔐 Security Model

### Current State (Phase 1-2)

| Protection Level | Details |
|-----------------|---------|
| ✅ **Encrypted in transit** | AES-256 symmetric encryption on all messages |
| ✅ **Integrity verified** | SHA-256 checksums detect tampering |
| ✅ **Unique identities** | Per-device cryptographic IDs |
| ✅ **Replay suppression** | Deduplication cache prevents message replay |
| ⚠️ **Keys at rest** | Stored in AsyncStorage (OS-level protection only) |
| ⚠️ **No forward secrecy** | Same key encrypts all messages |
| ⚠️ **Symmetric only** | No public-key infrastructure yet |
| ❌ **No key exchange** | Peers must pre-share keys |

### Planned (Phase 4)

- Public-key cryptography with libsodium
- X25519 ECDH key exchange
- Hardware security module integration
- Perfect forward secrecy
- HMAC message authentication codes

> ⚠️ **CYPHR is currently in development.** The encryption is functional but not yet hardened for adversarial environments. See [SECURITY.md](SECURITY.md) for full details.

---

## 🤝 Contributing

CYPHR is built for humanity. We welcome contributions that improve:

- 🛡️ **Reliability** — fault tolerance and error recovery
- 🔋 **Battery efficiency** — every milliamp matters in a disaster
- 🔐 **Security** — hardening the encryption and key management
- 📱 **Cross-platform** — iOS, Android, and edge cases
- ♿ **Accessibility** — usable by everyone, including under extreme stress
- 🌍 **Localization** — translated for global disaster response

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

### Good First Issues

Look for issues labeled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) to get started.

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React Native + Expo |
| **Language** | TypeScript (strict mode) |
| **Encryption** | crypto-js (AES-256, SHA-256, PBKDF2) |
| **BLE** | react-native-ble-plx |
| **Storage** | @react-native-async-storage/async-storage |
| **Events** | eventemitter3 |
| **IDs** | uuid v4 |

---

## 📄 License

CYPHR is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0).

This means:
- ✅ You can use, modify, and distribute CYPHR freely
- ✅ You can use it commercially
- 📋 You **must** keep the source code open for any modifications
- 📋 You **must** share source if you deploy it as a network service
- 📋 You **must** include the license and copyright notice

See [LICENSE](LICENSE) for the full text.

> **Why AGPL?** CYPHR is built as a lifeline for when communication matters most. The AGPL ensures that improvements to this lifeline always remain freely available to everyone — no one can take this tool proprietary.

---

## 🙏 Acknowledgments

- Built with [React Native](https://reactnative.dev/) and [Expo](https://expo.dev/)
- Encryption powered by [crypto-js](https://github.com/brix/crypto-js)
- BLE transport via [react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx)
- Inspired by the resilience of communities who communicate when all else fails

---

<p align="center">
  <strong>CYPHR</strong> — Communication when it matters most. 🌐🔐
</p>
<p align="center">
  <sub>Built for humanity. Open forever.</sub>
</p>
