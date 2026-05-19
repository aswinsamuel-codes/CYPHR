# Contributing to CYPHR

Thank you for your interest in contributing to CYPHR! 💖 CYPHR is built to keep communities connected during emergencies and natural disasters. Your contributions directly help make this lifeline more robust, secure, and energy-efficient.

---

## 🗺️ How Can I Help?

We welcome all types of contributions, but prioritize the following areas:

- 🔋 **Battery Optimization** — In disasters, power is scarce. Code that minimizes battery drain is highly valued.
- 🛡️ **Security & Encryption** — Hardening the cryptographic layer and moving towards public key cryptosystems.
- 📶 **Alternative Transport Layers** — Implementing Wi-Fi Direct, Multipeer Connectivity, or LoRa adapters.
- 📱 **Cross-Platform Compatibility** — Fixing iOS/Android-specific BLE bugs.
- 🌍 **Localization** — Translating the app into more languages.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js** 18+ & **npm**
- **Expo CLI** (runs via `npx expo`)
- **Android Studio** (for Android build/emulators) or **Xcode** (for iOS simulator, macOS only)
- A physical device is highly recommended since Bluetooth APIs don't work properly in emulators/simulators.

### Installation

1. Fork this repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/cyphr.git
   cd cyphr
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm start
   ```

---

## 🌿 Branching & Commits

### Branch Naming Conventions
Please use descriptive branch prefixes:
- `feat/some-feature` — for new features
- `fix/bug-description` — for bug fixes
- `docs/updating-readme` — for documentation updates
- `refactor/clean-mesh` — for code refactoring

### Commit Message Guidelines
We follow **Conventional Commits**:
- `feat: add SOS beacon mode`
- `fix: resolve BLE reconnection crash`
- `docs: update setup instructions`
- `refactor: clean up cryptographic helper methods`

---

## 🧪 Testing and Verification

Before submitting a Pull Request, please ensure:
1. **TypeScript compiles successfully**:
   ```bash
   npm run typecheck
   ```
2. **Prettier/Linter check passes**:
   ```bash
   npm run lint
   ```
3. **No hardcoded secrets** are left in code.

---

## 🤝 Pull Request Process

1. Create a branch from `main` or the latest development branch.
2. Implement your changes, adding tests if applicable.
3. Verify your changes on a physical device.
4. Submit a Pull Request.
5. Provide a clear description of the problem solved, testing done, and any impact on battery consumption/performance.
6. A maintainer will review your PR as soon as possible.

---

## 💬 Communication & Community

- **Discussions**: Use GitHub Discussions for design ideas, questions, and feature requests.
- **Issues**: Use GitHub Issues for reporting bugs. Please use the issue templates!

By contributing, you agree that your contributions will be licensed under the project's **GNU AGPL-3.0-or-later** license.
