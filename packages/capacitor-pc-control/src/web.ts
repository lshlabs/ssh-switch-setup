import { WebPlugin } from '@capacitor/core';

import type {
  AppSettingsResult,
  BridgeStatusResult,
  CheckHostResult,
  SetupDevice,
  ExecuteSshCommandResult,
  ExecuteEnsuredSshCommandResult,
  NetworkStateResult,
  NetworkSsidPermissionResult,
  OpenVpnPermissionResult,
  OpenVpnProfilesResult,
  OpenVpnLaunchResult,
  OpenVpnStatusResult,
  PcControlPlugin,
  PcStatusResult,
  PowerActionResult,
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

  requestNetworkSsidPermission(): Promise<NetworkSsidPermissionResult> {
    return this.unsupported('requestNetworkSsidPermission');
  }

  checkHost(): Promise<CheckHostResult> {
    return this.unsupported('checkHost');
  }

  discoverSetupDevices(): Promise<{ devices: SetupDevice[] }> {
    return this.unsupported('discoverSetupDevices');
  }

  getSetupBootstrap(): Promise<never> {
    return this.unsupported('getSetupBootstrap');
  }

  startSetupPairing(): Promise<never> {
    return this.unsupported('startSetupPairing');
  }

  getSetupPairingStatus(): Promise<never> {
    return this.unsupported('getSetupPairingStatus');
  }

  completeSetupPairing(): Promise<never> {
    return this.unsupported('completeSetupPairing');
  }

  finalizeSetupPairing(): Promise<never> {
    return this.unsupported('finalizeSetupPairing');
  }

  cancelSetupPairing(): Promise<never> {
    return this.unsupported('cancelSetupPairing');
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

  copySshFingerprint(): Promise<void> {
    return this.unsupported('copySshFingerprint');
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

  executeEnsuredSshCommand(): Promise<ExecuteEnsuredSshCommandResult> {
    return this.unsupported('executeEnsuredSshCommand');
  }

  isOpenVpnInstalled(): Promise<never> {
    return this.unsupported('isOpenVpnInstalled');
  }

  openOpenVpnApp(): Promise<OpenVpnLaunchResult> {
    return this.unsupported('openOpenVpnApp');
  }

  prepareOpenVpnControl(): Promise<never> {
    return this.unsupported('prepareOpenVpnControl');
  }

  getOpenVpnProfiles(): Promise<OpenVpnProfilesResult> {
    return this.unsupported('getOpenVpnProfiles');
  }

  getOpenVpnPermissionStatus(): Promise<OpenVpnPermissionResult> {
    return this.unsupported('getOpenVpnPermissionStatus');
  }

  selectOpenVpnProfile(): Promise<OpenVpnProfilesResult> {
    return this.unsupported('selectOpenVpnProfile');
  }

  clearOpenVpnProfileSelection(): Promise<void> {
    return this.unsupported('clearOpenVpnProfileSelection');
  }

  commitOnboarding(): Promise<AppSettingsResult> {
    return this.unsupported('commitOnboarding');
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

  ensureHomeNetwork(): Promise<never> {
    return this.unsupported('ensureHomeNetwork');
  }

  getPcStatus(): Promise<PcStatusResult> {
    return this.unsupported('getPcStatus');
  }

  runPowerAction(): Promise<PowerActionResult> {
    return this.unsupported('runPowerAction');
  }

  getAppSettings(): Promise<AppSettingsResult> {
    return this.unsupported('getAppSettings');
  }

  setAppSettings(): Promise<AppSettingsResult> {
    return this.unsupported('setAppSettings');
  }

  getAppVersion(): Promise<{ versionName: string; versionCode: number }> {
    return this.unsupported('getAppVersion');
  }

  showSystemToast(): Promise<void> {
    return this.unsupported('showSystemToast');
  }

  private unsupported<T>(method: string): Promise<T> {
    return Promise.reject(
      this.unimplemented(`${method} requires the Android native implementation.`),
    );
  }
}
