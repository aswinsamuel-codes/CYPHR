# Changelog

All notable changes to the CYPHR project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned (Phase 3 & 4)
- Pluggable transport adapter interface.
- Wi-Fi Direct network support.
- Public key cryptography (X25519) and perfect forward secrecy.
- Hardware Keychain/Keystore integration for device key storage.
- SOS distress beacon mode with location broadcasting.

---

## [0.2.0] - 2026-05-20

### Added
- **BLE Transport Layer**: Introduced a native Bluetooth Low Energy Central/Peripheral transport manager using `react-native-ble-plx`.
- **Chunked Transfer Protocol**: Created automatic message chunking/reassembly to fit small BLE MTU limits safely.
- **Auto-Discovery & Peer-Connection**: Multi-node Bluetooth search, auto-handshaking, and session management.
- **Store-and-Forward Mesh Relay**: Added multi-hop packet routing with configurable TTL (Time-To-Live) and deduplication.
- **Flooding Control**: Probabilistic forwarding (70% relay chance) and message delays to avoid network congestion.
- **Reconnection Engine**: Exponential backoff reconnection for dropped BLE link sessions.

---

## [0.1.0] - 2025-10-30

### Added
- **Symmetric Encryption Engine**: AES-256 encryption/decryption with SHA-256 checksum validation.
- **Passphrase Key Derivation**: PBKDF2 key generation from user passphrases.
- **Device Identity Storage**: Persistent cryptographic identity generation on first app launch using AsyncStorage.
- **Symmetric Key Regeneration**: Feature allowing the user to rotate or regenerate the local cryptographic key.
- **Chat UI Layout**: Dark-themed messaging interface, device info header, key display, and peer list placeholders.
