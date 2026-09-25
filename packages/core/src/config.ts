import type { PcControlConfig } from './types';

/** Product defaults contain no device-specific network or identity values. */
export const DEFAULT_PC_CONTROL_CONFIG = {
  pc: {
    host: '',
    macAddress: '',
    sshPort: 22,
    sshUser: '',
  },
  router: {
    host: '',
    sshPort: 22,
    wolInterface: '',
  },
  networks: {
    lanCidr: '',
    vpnCidr: '',
  },
  openVpnPackage: 'de.blinkt.openvpn',
} as const satisfies PcControlConfig;
