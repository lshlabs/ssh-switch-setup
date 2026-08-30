import { WebPlugin } from '@capacitor/core';

import type {
  BridgeStatusResult,
  CheckHostResult,
  ExecuteSshCommandResult,
  NetworkStateResult,
  OpenVpnProfilesResult,
  OpenVpnStatusResult,
  PcControlPlugin,
  SshHostKeyResult,
  SshIdentityResult,
  TrustedSshHostKeyResult,
} from './definitions';

export class PcControlWeb extends WebPlugin implements PcControlPlugin {
  getBridgeStatus(): Promise<BridgeStatusResult> {
    return Promise.resolve({
      native: false,
      platform: 'web',
    });
  }

  getNetworkState(): Promise<NetworkStateResult> {
    return this.unsupported('getNetworkState');
  }

  checkHost(): Promise<CheckHostResult> {
    return this.unsupported('checkHost');
  }

  getSshIdentity(): Promise<SshIdentityResult> {
    return this.unsupported('getSshIdentity');
  }

  ensureSshIdentity(): Promise<SshIdentityResult> {
    return this.unsupported('ensureSshIdentity');
  }

  copySshPublicKey(): Promise<void> {
    return this.unsupported('copySshPublicKey');
  }

  scanSshHostKey(): Promise<SshHostKeyResult> {
    return this.unsupported('scanSshHostKey');
  }

  trustSshHostKey(): Promise<SshHostKeyResult> {
    return this.unsupported('trustSshHostKey');
  }

  getTrustedSshHostKey(): Promise<TrustedSshHostKeyResult> {
    return this.unsupported('getTrustedSshHostKey');
  }

  executeSshCommand(): Promise<ExecuteSshCommandResult> {
    return this.unsupported('executeSshCommand');
  }

  getOpenVpnProfiles(): Promise<OpenVpnProfilesResult> {
    return this.unsupported('getOpenVpnProfiles');
  }

  connectOpenVpn(): Promise<OpenVpnStatusResult> {
    return this.unsupported('connectOpenVpn');
  }

  disconnectOpenVpn(): Promise<OpenVpnStatusResult> {
    return this.unsupported('disconnectOpenVpn');
  }

  getOpenVpnStatus(): Promise<OpenVpnStatusResult> {
    return this.unsupported('getOpenVpnStatus');
  }

  private unsupported<T>(method: string): Promise<T> {
    return Promise.reject(
      this.unimplemented(`${method} requires the Android native implementation.`),
    );
  }
}
