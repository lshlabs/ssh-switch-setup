# Part 1 implementation decisions

Baseline: lshlabs/ssh-switch, inspected 2026-11-09. Android is React 19/TypeScript + Capacitor 8, with Kotlin native services and mwiede JSch. The active onboarding is `apps/mobile/src/components/OnboardingScreen.tsx`; the similarly named screen under `screens` is not mounted. Existing QR pairing there and the Tauri server use HTTP, so they are not a secure implementation of the requested HTTPS protocol.

Reuse AndroidKeystore RSA-3072 identity (alias unchanged), SHA256withRSA proof, JSch strict host-key checking, native settings/trust storage, `hostname` verification, existing `shutdown /s /t 0` and `shutdown /r /t 0` allowlist, and OpenVPN External AIDL permission/status flow. Actual VPN selection uses profile UUID (despite the older README and plans saying name); preserve it. No VPN secrets are managed. Existing WOL remains unchanged.

Add independent .NET 10 WPF/Kestrel under windows-setup. Per the user's clarification, ignore all existing Windows setup implementations, including Tauri and the old PowerShell setup script: no code, scripts or runtime dependencies are reused from them. Leave their files untouched. Implement Windows diagnostics, configuration, recovery and pairing anew. No mDNS bootstrap trust: scan QR or paste the complete bootstrap JSON. Existing manual Android SSH onboarding remains available.

Windows supports local accounts with an existing profile. Effective `sshd -T -C` configuration determines key path and port; unsupported multiple/custom paths and address-dependent Match policies fail closed. Never rewrite sshd_config, change global authentication, or replace existing keys. Account selection is explicit after UAC (the elevated identity may differ from the intended SSH user). Administrator shared-key files grant access to other administrators too; prefer a standard local account and separately verify shutdown rights. No automatic account creation or privilege grants.

Reference: https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration

All actual OS mutations require a button action in the elevated wizard. Development tests must use temporary files/loopback and must not invoke OS configuration or power commands.
