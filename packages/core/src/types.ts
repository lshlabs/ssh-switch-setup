export type PcStatus =
  'unknown' | 'online' | 'offline' | 'waking' | 'shutting-down' | 'rebooting' | 'error';

export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export type NetworkState = 'local' | 'vpn' | 'unavailable';

export type PowerAction = 'power-on' | 'shutdown' | 'reboot';

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
