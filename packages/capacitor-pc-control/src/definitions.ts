import type { PluginListenerHandle } from '@capacitor/core';
import type { PairingBootstrap, PairingStarted, PairingStatus } from '@pc-control/pairing-protocol';

import type {
  AppSettings,
  NetworkState,
  PcStatusResult,
  PowerAction,
  PowerActionResult,
  VpnStatus,
} from '@pc-control/core';

export type {
  AppSettings,
  CopyMode,
  LanguagePreference,
  ThemePreference,
  PcStatus,
  PcReachabilityReason,
  PcStatusResult,
  PowerAction,
  PowerActionResult,
} from '@pc-control/core';

export interface AppSettingsResult {
  /** Native storage returns only persisted values; the JS layer merges product defaults. */
  settings: Partial<AppSettings>;
}

export interface BridgeStatusResult {
  native: boolean;
  platform: 'android' | 'web';
}

export interface SystemToastOptions {
  duration?: 'short' | 'long';
  message: string;
  skipWhenClipboardConfirmationAvailable?: boolean;
}

export interface NetworkStateResult {
  ssid?: string;
  state: NetworkState;
}

export interface NetworkSsidPermissionResult {
  granted: boolean;
}

export interface NetworkChangeEvent {
  reason: 'available' | 'lost' | 'capabilities-changed' | 'link-properties-changed';
}

export interface HomeNetworkOptions {
  connectTimeoutMs?: number;
  postConnectReachabilityTimeoutMs?: number;
  reachabilityTimeoutMs?: number;
  routerHost: string;
  routerPort: number;
}

export interface EnsureHomeNetworkResult {
  path: 'local' | 'vpn';
  vpnWasStartedByApp: boolean;
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

export interface SetupDevice {
  name: string;
  endpoint: string;
}

export interface PcStatusOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  /** Optional home-network anchor for unknown/offline distinction. If provided and unreachable, status is `unknown`. */
  routerHost?: string;
  routerPort?: number;
  routerTimeoutMs?: number;
}

export interface RunPowerActionOptions {
  action: PowerAction;
  autoDisconnectVpn?: boolean;
  initialStatusTimeoutMs?: number;
  macAddress: string;
  pcHost: string;
  pcHostFingerprint?: string;
  pcPort: number;
  pcUsername: string;
  pollIntervalMs?: number;
  rebootOfflineTimeoutMs?: number;
  rebootOnlineTimeoutMs?: number;
  /** Required for power-on; omitted for PC-only shutdown/reboot. */
  routerHost?: string;
  routerHostFingerprint?: string;
  routerPort?: number;
  routerUsername?: string;
  shutdownTimeoutMs?: number;
  wakeTimeoutMs?: number;
  wolInterface?: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  reachabilityTimeoutMs?: number;
  postConnectReachabilityTimeoutMs?: number;
  vpnDisconnectTimeoutMs?: number;
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
  /** Used only during onboarding after a native host-key scan; does not persist trust. */
  temporaryHostKeyAlgorithm?: string;
  temporaryHostKeyFingerprint?: string;
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

export interface ExecuteEnsuredSshCommandOptions
  extends ExecuteSshCommandOptions, HomeNetworkOptions {}

export interface ExecuteEnsuredSshCommandResult extends ExecuteSshCommandResult {
  networkPath: 'local' | 'vpn';
  vpnWasStartedByApp: boolean;
}

export interface OpenVpnProfile {
  id: string;
  name: string;
}

export interface OpenVpnProfilesResult {
  profiles: OpenVpnProfile[];
  selectedProfileId?: string;
}

export interface OpenVpnPermissionResult {
  granted: boolean;
  installed: boolean;
}

export interface ConnectOpenVpnOptions {
  profileId: string;
  timeoutMs?: number;
}

export interface DisconnectOpenVpnOptions {
  onlyIfStartedByApp?: boolean;
  timeoutMs?: number;
}

export interface OpenVpnStatusResult {
  profileId?: string;
  status: VpnStatus;
  vpnWasStartedByApp: boolean;
}

export interface OpenVpnInstallationResult {
  installed: boolean;
}

export type OpenVpnLaunchDestination = 'app' | 'play-store';

export interface OpenVpnLaunchResult {
  destination: OpenVpnLaunchDestination;
}

export interface SelectOpenVpnProfileOptions {
  profileId: string;
}

export interface PcControlPlugin {
  /** Verifies that JavaScript can invoke the platform implementation. */
  getBridgeStatus(): Promise<BridgeStatusResult>;

  /** Notifies the app when the Android network changes so status can be refreshed immediately. */
  addListener(
    eventName: 'networkChange',
    listenerFunc: (event: NetworkChangeEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** Requests the Android permission required to display the current Wi-Fi SSID. */
  requestNetworkSsidPermission(): Promise<NetworkSsidPermissionResult>;

  /** Determines the home-network path using router TCP reachability. */
  getNetworkState(
    options: Pick<HomeNetworkOptions, 'routerHost' | 'routerPort'>,
  ): Promise<NetworkStateResult>;

  /** Planned native API: performs a bounded TCP reachability check. */
  checkHost(options: CheckHostOptions): Promise<CheckHostResult>;

  /** Finds Windows Setup utilities while their pairing screens are open. */
  discoverSetupDevices(): Promise<{ devices: SetupDevice[] }>;
  getSetupBootstrap(options: { endpoint: string }): Promise<{ bootstrap: PairingBootstrap }>;
  startSetupPairing(options: { endpoint: string; oneTimeToken: string; deviceName: string }): Promise<{ started: PairingStarted; requestSecret: string }>;
  getSetupPairingStatus(options: { endpoint: string; requestId: string; requestSecret: string }): Promise<{ status: PairingStatus }>;
  completeSetupPairing(options: { endpoint: string; requestId: string; requestSecret: string; challenge: string }): Promise<{ result: { verified: boolean } }>;
  finalizeSetupPairing(options: { endpoint: string; requestId: string; requestSecret: string }): Promise<{ result: { completed: boolean } }>;
  cancelSetupPairing(options: { endpoint: string; requestId: string; requestSecret: string }): Promise<{ result: { cancelled: boolean } }>;

  /** Checks the Windows SSH endpoint without automatically connecting a VPN. */
  getPcStatus(options: PcStatusOptions): Promise<PcStatusResult>;

  /** Returns the app-only SSH identity without creating it. */
  getSshIdentity(): Promise<SshIdentityResult>;

  /** Creates the app-only SSH identity inside Android Keystore when absent. */
  ensureSshIdentity(): Promise<SshIdentityResult>;

  /** Copies only the OpenSSH public key to the Android clipboard. */
  copySshPublicKey(): Promise<void>;

  /** Copies the SSH public-key fingerprint to the Android clipboard. */
  copySshFingerprint(): Promise<void>;

  /** Reads the presented host key without authenticating or trusting it. */
  scanSshHostKey(options: SshHostOptions): Promise<SshHostKeyResult>;

  /** Trusts only a host key returned by the latest native scan. */
  trustSshHostKey(options: TrustSshHostKeyOptions): Promise<SshHostKeyResult>;

  /** Returns the fingerprint currently pinned for one host and port. */
  getTrustedSshHostKey(options: SshHostOptions): Promise<TrustedSshHostKeyResult>;

  /** Executes an allowlisted harmless command after strict host-key verification. */
  executeSshCommand(options: ExecuteSshCommandOptions): Promise<ExecuteSshCommandResult>;

  /** Ensures LAN/VPN connectivity before running a Phase 1 allowlisted SSH command. */
  executeEnsuredSshCommand(
    options: ExecuteEnsuredSshCommandOptions,
  ): Promise<ExecuteEnsuredSshCommandResult>;

  /** Reports whether the supported external OpenVPN controller is installed. */
  isOpenVpnInstalled(): Promise<OpenVpnInstallationResult>;

  /** Opens OpenVPN for Android, or its Play Store page when it is not installed. */
  openOpenVpnApp(): Promise<OpenVpnLaunchResult>;

  /** Starts the official OpenVPN for Android external-control approval flow if needed. */
  prepareOpenVpnControl(): Promise<OpenVpnInstallationResult>;

  /** Planned native API: lists profiles exposed by OpenVPN for Android. */
  getOpenVpnProfiles(): Promise<OpenVpnProfilesResult>;

  /** Checks external-control permission without opening the approval activity. */
  getOpenVpnPermissionStatus(): Promise<OpenVpnPermissionResult>;

  /** Persists only the selected external profile UUID, never profile credentials or contents. */
  selectOpenVpnProfile(options: SelectOpenVpnProfileOptions): Promise<OpenVpnProfilesResult>;

  /** Clears the saved external profile selection without changing the OpenVPN app. */
  clearOpenVpnProfileSelection(): Promise<void>;

  /** Persists the verified V1 profile, host keys, and VPN choice together. */
  commitOnboarding(options: {
    settings: AppSettings;
    pcKey: TrustSshHostKeyOptions;
    routerKey?: TrustSshHostKeyOptions;
    selectedVpnProfileId?: string;
  }): Promise<AppSettingsResult>;

  /** Planned native API: connects one OpenVPN for Android profile and awaits readiness. */
  connectOpenVpn(options: ConnectOpenVpnOptions): Promise<OpenVpnStatusResult>;

  /** Planned native API: disconnects the VPN session controlled by this app. */
  disconnectOpenVpn(options?: DisconnectOpenVpnOptions): Promise<OpenVpnStatusResult>;

  /** Planned native API: returns the latest OpenVPN callback state. */
  getOpenVpnStatus(): Promise<OpenVpnStatusResult>;

  /** Uses router reachability, then OpenVPN fallback when a profile is selected. */
  ensureHomeNetwork(options: HomeNetworkOptions): Promise<EnsureHomeNetworkResult>;

  /** Runs one fixed, native power action with bounded state verification. */
  runPowerAction(options: RunPowerActionOptions): Promise<PowerActionResult>;

  /** Returns persisted app settings (non-secret). */
  getAppSettings(): Promise<AppSettingsResult>;

  /** Persists validated app settings (non-secret, no credentials). */
  setAppSettings(options: { settings: AppSettings }): Promise<AppSettingsResult>;

  /** Returns current app version info. */
  getAppVersion(): Promise<{ versionName: string; versionCode: number }>;

  /** Shows a native device Toast instead of rendering an in-app notification. */
  showSystemToast(options: SystemToastOptions): Promise<void>;
}
