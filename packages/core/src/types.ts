export type PcStatus =
  'unknown' | 'online' | 'offline' | 'waking' | 'shutting-down' | 'rebooting' | 'error';

/** Explains only why the PC reachability probe did or did not produce a result. */
export type PcReachabilityReason = 'reachable' | 'pc-unreachable' | 'network-unavailable';

export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export type NetworkState = 'local' | 'vpn' | 'unavailable' | 'unknown';

export type PowerAction = 'power-on' | 'shutdown' | 'reboot';

export type ThemePreference = 'system' | 'light' | 'dark';

export type CopyMode = 'simple' | 'technical';

export type LanguagePreference = 'system' | 'ko' | 'en';

export interface PcStatusResult {
  status: PcStatus;
  reachable: boolean;
  latencyMs?: number;
  reason?: PcReachabilityReason;
  resolvedHost?: string;
}

export interface PowerActionResult {
  action: PowerAction;
  previousStatus: PcStatus;
  finalStatus: PcStatus;
  networkPath: 'local' | 'vpn';
  vpnWasStartedByApp: boolean;
  vpnDisconnectFailed?: boolean;
  commandExecuted: boolean;
  durationMs: number;
  resolvedPcHost?: string;
}

export interface PcControlConfig {
  pc: {
    host: string;
    macAddress: string;
    sshPort: number;
    sshUser: string;
  };
  router: {
    host: string;
    sshPort: number;
    sshUser?: string;
    wolInterface: string;
  };
  networks: {
    lanCidr: string;
    vpnCidr: string;
  };
  openVpnPackage: string;
}
