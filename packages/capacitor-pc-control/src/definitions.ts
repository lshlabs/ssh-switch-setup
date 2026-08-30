import type { NetworkState, VpnStatus } from '@pc-control/core';

export interface BridgeStatusResult {
  native: boolean;
  platform: 'android' | 'web';
}

export interface NetworkStateResult {
  state: NetworkState;
}

export interface CheckHostOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface CheckHostResult {
  latencyMs?: number;
  reachable: boolean;
}

export type SshTarget = 'windows' | 'router';

export type SshErrorCode =
  | 'IDENTITY_NOT_AVAILABLE'
  | 'HOST_UNREACHABLE'
  | 'CONNECTION_TIMEOUT'
  | 'HOST_KEY_UNKNOWN'
  | 'HOST_KEY_MISMATCH'
  | 'AUTH_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_FAILED'
  | 'IO_ERROR'
  | 'UNKNOWN';

export interface SshIdentityResult {
  algorithm?: 'ssh-rsa';
  available: boolean;
  created?: boolean;
  fingerprint?: string;
  publicKey?: string;
}

export interface SshHostOptions {
  connectTimeoutMs?: number;
  host: string;
  port?: number;
}

export interface SshHostKeyResult {
  algorithm: string;
  fingerprint: string;
  host: string;
  port: number;
  trusted: boolean;
}

export interface TrustSshHostKeyOptions extends SshHostOptions {
  algorithm: string;
  fingerprint: string;
}

export interface TrustedSshHostKeyResult {
  algorithm?: string;
  fingerprint?: string;
  host: string;
  port: number;
  trusted: boolean;
}

export interface ExecuteSshCommandOptions {
  command: string;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  expectedHostFingerprint?: string;
  host: string;
  port?: number;
  target: SshTarget;
  username: string;
}

export interface ExecuteSshCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface OpenVpnProfile {
  id: string;
  name: string;
}

export interface OpenVpnProfilesResult {
  profiles: OpenVpnProfile[];
}

export interface ConnectOpenVpnOptions {
  profileId: string;
  timeoutMs?: number;
}

export interface OpenVpnStatusResult {
  profileId?: string;
  status: VpnStatus;
}

export interface PcControlPlugin {
  /** Verifies that JavaScript can invoke the platform implementation. */
  getBridgeStatus(): Promise<BridgeStatusResult>;

  /** Planned native API: detects direct LAN, VPN, or unavailable state. */
  getNetworkState(): Promise<NetworkStateResult>;

  /** Planned native API: performs a bounded TCP reachability check. */
  checkHost(options: CheckHostOptions): Promise<CheckHostResult>;

  /** Returns the app-only SSH identity without creating it. */
  getSshIdentity(): Promise<SshIdentityResult>;

  /** Creates the app-only SSH identity inside Android Keystore when absent. */
  ensureSshIdentity(): Promise<SshIdentityResult>;

  /** Copies only the OpenSSH public key to the Android clipboard. */
  copySshPublicKey(): Promise<void>;

  /** Reads the presented host key without authenticating or trusting it. */
  scanSshHostKey(options: SshHostOptions): Promise<SshHostKeyResult>;

  /** Trusts only a host key returned by the latest native scan. */
  trustSshHostKey(options: TrustSshHostKeyOptions): Promise<SshHostKeyResult>;

  /** Returns the fingerprint currently pinned for one host and port. */
  getTrustedSshHostKey(options: SshHostOptions): Promise<TrustedSshHostKeyResult>;

  /** Executes an allowlisted harmless command after strict host-key verification. */
  executeSshCommand(options: ExecuteSshCommandOptions): Promise<ExecuteSshCommandResult>;

  /** Planned native API: lists profiles exposed by OpenVPN for Android. */
  getOpenVpnProfiles(): Promise<OpenVpnProfilesResult>;

  /** Planned native API: connects one OpenVPN for Android profile and awaits readiness. */
  connectOpenVpn(options: ConnectOpenVpnOptions): Promise<OpenVpnStatusResult>;

  /** Planned native API: disconnects the VPN session controlled by this app. */
  disconnectOpenVpn(): Promise<OpenVpnStatusResult>;

  /** Planned native API: returns the latest OpenVPN callback state. */
  getOpenVpnStatus(): Promise<OpenVpnStatusResult>;
}
