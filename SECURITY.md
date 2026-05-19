# Security Policy & Limitations

This document outlines the security posture of the CYPHR project, details how to report vulnerabilities, and lists current known cryptographic and transport limitations.

> ⚠️ **IMPORTANT**: CYPHR is currently under active development. The encryption is functional but has not yet been audited by third-party security professionals. It should not be used for life-critical security scenarios in adversarial environments until audited.

---

## 🛡️ Supported Versions

Only the latest release (and current main branch) is supported for security updates:

| Version | Supported |
|---------|-----------|
| >= 0.2.x | ✅ Yes |
| < 0.2.x | ❌ No |

---

## 📬 Reporting a Vulnerability

If you discover a security vulnerability, please do **NOT** open a public issue. Instead, report it privately:

1. Send an email to **cyphr-security@proton.me**.
2. If possible, encrypt your email or share details via a secure pastebin.
3. We will acknowledge receipt of your report within **48 hours**.
4. We will send a detailed assessment and proposed mitigation plan within **7 days**.
5. Once a fix is released, we will publicly credit you in the changelog and release notes.

---

## ⚠️ Current Cryptographic Limitations

As of **Phase 2 (v0.2.0)**, CYPHR has several design trade-offs and limitations:

1. **Symmetric-Only Encryption**:
   - Currently, encryption is symmetric AES-256 using a shared secret key configured on the devices.
   - There is no public-key exchange protocol (e.g., ECDH) yet. Peers must pre-share keys out-of-band.
2. **Key Storage**:
   - Device keys are persisted in React Native's `AsyncStorage`.
   - On iOS and Android, this relies on OS-level file permissions. It is not currently hardened inside the iOS Keychain or Android Keystore (hardware-backed security module).
3. **No Perfect Forward Secrecy (PFS)**:
   - Since the same symmetric key is reused for all messages, compromise of the key allows decryption of all past messages captured in transit.
4. **No Replay Protection**:
   - Although the `MeshManager` deduplicates messages using a 500-entry memory cache, a persistent attacker can capture a packet and replay it much later once the cache clears.
5. **No Peer Authentication**:
   - Nodes only verify message integrity via SHA-256 checksums, but cannot verify the sender's identity beyond the sender ID parameter included in the decrypted payload.

---

## 🗺️ Security Roadmap

We plan to address these limitations in **Phase 4**:

- **Libsodium Integration**: Add `tweetnacl` or native libsodium wrappers.
- **Asymmetric Key Exchange**: Implement X25519 ECDH key exchange to establish unique session keys.
- **Perfect Forward Secrecy**: Implement the double-ratchet algorithm (or a simplified version suited for mesh networks).
- **Hardware Keystore Persistence**: Move device keys from `AsyncStorage` to secure Keychain/Keystore.
- **HMAC Signatures**: Add message authentication tags to prevent ciphertext tampering before decryption.
