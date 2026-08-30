import type { PcControlConfig } from './types';

/**
 * Non-secret defaults for the currently verified development environment.
 * Keep target addresses in this single layer until an encrypted settings store is added.
 */
export const DEFAULT_PC_CONTROL_CONFIG = {
  pc: {
    host: '192.168.60.177',
    macAddress: '2C:F0:5D:83:5B:07',
    sshPort: 22,
    sshUser: 'admin',
  },
  router: {
    host: '192.168.60.1',
    sshPort: 22,
    wolInterface: 'br0',
  },
  networks: {
    lanCidr: '192.168.60.0/24',
    vpnCidr: '10.8.0.0/24',
  },
  openVpnPackage: 'de.blinkt.openvpn',
} as const satisfies PcControlConfig;
