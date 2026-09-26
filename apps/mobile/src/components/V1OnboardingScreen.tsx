import { useCallback, useEffect, useRef, useState } from 'react';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { PcControl, type OpenVpnProfile, type SetupDevice, type TrustSshHostKeyOptions } from '@pc-control/capacitor-pc-control';
import { defaultAppSettings, isPowerOnConfigured, type AppSettings } from '@pc-control/core';
import {
  confirmationCode as deriveConfirmationCode,
  parsePairingBootstrap,
  parsePairingStatus,
  type PairingBootstrap,
  type PairedPcInfo,
} from '@pc-control/pairing-protocol';
import { useAppCopy } from '../i18n';

const englishCopy: Record<string, string> = {
  '‹ 뒤로': '‹ Back',
  '나중에': 'Later',
  '설정 중단 확인': 'Leave setup',
  '진행 상황이 저장되지 않아요': 'Your progress will not be saved',
  '지금 나가면 입력한 내용이 사라져요. 설정 마법사를 다시 시작하면 처음부터 진행해야 해요.':
    'Leaving now discards your entries. Setup will start from the beginning next time.',
  '계속 설정': 'Continue setup',
  'PC를 어떻게 설정할까요?': 'How would you like to set up your PC?',
  '환경에 맞는 설정 방법을 선택해주세요.': 'Choose the setup method that fits your PC.',
  '추천 · PC Control for Windows로 자동 설정': 'Recommended · Set up with PC Control for Windows',
  'PC에 프로그램을 설치하면 연결에 필요한 설정을 자동으로 준비해요.':
    'Install the utility on your PC to prepare the connection automatically.',
  '설치 없이 수동 설정': 'Set up manually without installing',
  '연결 정보를 직접 설정하려는 경우 사용해요.': 'Enter the connection details yourself.',
  'PC Control for Windows를 실행해주세요': 'Open PC Control for Windows',
  'PC를 찾는 중에도 QR 코드를 바로 스캔할 수 있어요.':
    'You can scan the QR code while we look for your PC.',
  'PC를 찾고 있어요…': 'Looking for your PC…',
  '연결': 'Connect',
  '다시 찾기': 'Search again',
  'PC 화면의 QR 코드 스캔': 'Scan the QR code on your PC',
  'PC에서 연결을 확인해주세요': 'Confirm the connection on your PC',
  '화면에 같은 코드가 표시되면 연결을 허용해주세요.':
    'If the same code appears on its screen, allow the connection.',
  'PC 연결 정보를 입력해주세요': 'Enter your PC connection details',
  'SSH로 PC에 연결할 때 사용할 정보예요.': 'These details are used for the SSH connection.',
  'PC 주소': 'PC address',
  '192.168.0.10 또는 DESKTOP.local': '192.168.0.10 or DESKTOP.local',
  'Windows 사용자 이름': 'Windows username',
  'PC SSH 포트': 'PC SSH port',
  'PC의 authorized_keys에 휴대폰 연결 키를 등록해주세요.':
    'Add your phone public key to the PC authorized_keys file.',
  'Windows 설정 스크립트': 'Windows setup script',
  '연결 키 복사': 'Copy connection key',
  '연결 확인': 'Check connection',
  'PC 보안 정보 확인': 'Verify PC identity',
  'PC에서 직접 확인한 SSH 지문과 아래 값이 같은지 확인해주세요.':
    'Compare this SSH fingerprint with the one shown on your PC.',
  '같아요': 'They match',
  'PC 켜기 설정': 'PC power-on setup',
  '공유기 SSH로 Wake-on-LAN을 사용할 경우 설정해요.':
    'Set this up if your router sends Wake-on-LAN over SSH.',
  'PC 켜기 사용': 'Enable PC power-on',
  'PC MAC 주소': 'PC MAC address',
  '네트워크 장비 주소': 'Router address',
  '네트워크 장비 SSH 사용자 이름': 'Router SSH username',
  '네트워크 장비 SSH 포트': 'Router SSH port',
  'LAN 인터페이스 이름': 'LAN interface name',
  '계속': 'Continue',
  '공유기 보안 정보 확인': 'Verify router identity',
  '공유기에서 직접 확인한 SSH 지문과 같은지 확인해주세요.':
    'Compare this SSH fingerprint with the one shown by your router.',
  '다른 네트워크 연결': 'Connect from another network',
  '외부에서도 PC에 연결하려면 OpenVPN 프로필을 선택해주세요.':
    'Choose an OpenVPN profile to connect from outside your home network.',
  '다른 네트워크에서 연결': 'Connect from another network',
  'OpenVPN for Android에서 프로필을 준비해주세요.':
    'Add a profile in OpenVPN for Android first.',
  'OpenVPN 설치·권한·프로필 확인': 'Check OpenVPN app, permission, and profiles',
  '설정 확인': 'Review setup',
  '설정 요약': 'Setup summary',
  'PC 켜기:': 'PC power-on:',
  '외부 연결:': 'Remote connection:',
  '설정됨': 'Configured',
  '프로필 선택됨': 'Profile selected',
  '사용 안 함': 'Off',
  '저장': 'Save',
  'PC 연결이 완료됐어요': 'PC connection is ready',
  '시작하기': 'Get started',
  'OpenVPN for Android를 설치하고 프로필을 추가한 뒤 다시 확인해주세요.':
    'Install OpenVPN for Android, add a profile, then try again.',
  'PC를 찾지 못했어요. PC 화면의 QR 코드를 스캔할 수도 있어요.':
    'We could not find your PC. You can scan the QR code on its screen.',
  'QR 스캐너를 준비할 수 없어요. 다시 시도해주세요.': 'Could not prepare the QR scanner. Try again.',
  '휴대폰 연결 키를 준비할 수 없어요.': 'Could not prepare the phone connection key.',
  'Android 휴대폰': 'Android phone',
  'PC와 휴대폰의 확인 코드가 달라요. 연결을 중단했어요.':
    'The confirmation codes do not match. Pairing was stopped.',
  '페어링 요청 정보가 달라요.': 'Pairing request details do not match.',
  'PC에서 연결을 거절했어요.': 'The PC rejected the connection.',
  '페어링 요청이 만료됐어요.': 'The pairing request expired.',
  '연결이 취소됐어요.': 'The connection was cancelled.',
  'PC에서 연결 키를 등록하지 못했어요.': 'The PC could not register the connection key.',
  'PC 연결 응답을 기다리는 시간이 초과됐어요. 다시 시도해주세요.':
    'Timed out waiting for the PC. Try again.',
  'PC의 보안 정보가 달라요. 연결을 중단했어요.':
    'The PC identity changed. Pairing was stopped.',
  '실제 SSH 서버의 보안 정보가 PC 설정 화면과 달라요.':
    'The SSH server fingerprint differs from the PC setup screen.',
  'SSH 인증에 실패했어요.': 'SSH authentication failed.',
  'PC 주소, Windows 사용자 이름, SSH 포트를 확인해주세요.':
    'Check the PC address, Windows username, and SSH port.',
  'PC 켜기에 필요한 MAC 주소와 공유기 정보를 확인해주세요.':
    'Check the MAC address and router details needed to power on the PC.',
  '공유기 WOL 설정을 확인할 수 없어요.': 'Could not verify router Wake-on-LAN setup.',
  'PC SSH 검증을 먼저 완료해주세요.': 'Verify the PC SSH connection first.',
  '공유기 SSH 검증을 먼저 완료해주세요.': 'Verify the router SSH connection first.',
  'OpenVPN 프로필을 선택해주세요.': 'Choose an OpenVPN profile.',
  'PC SSH 검증이 완료되지 않았어요.': 'PC SSH verification is incomplete.',
};

type Screen =
  | 'choice'
  | 'discover'
  | 'approval'
  | 'manual-pc'
  | 'pc-trust'
  | 'wake'
  | 'router-trust'
  | 'remote'
  | 'summary'
  | 'complete';
const TOOL_URL =
  'https://raw.githubusercontent.com/lshlabs/ssh-switch/main/scripts/setup-windows-ssh.ps1';

export function V1OnboardingScreen({
  settings,
  onCommit,
  onComplete,
  onSkip,
  registerBack,
}: {
  settings: AppSettings;
  onCommit: (next: AppSettings, pcKey: TrustSshHostKeyOptions,
    routerKey?: TrustSshHostKeyOptions, selectedVpnProfileId?: string) => Promise<void>;
  onComplete: () => void;
  onSkip: () => void;
  registerBack: (handler: (() => boolean) | null) => void;
}) {
  const { locale } = useAppCopy();
  const copy = useCallback((ko: string) => locale === 'en' ? englishCopy[ko] ?? ko : ko, [locale]);
  const [screen, setScreen] = useState<Screen>('choice');
  const [draft, setDraft] = useState<AppSettings>(() => ({
    ...defaultAppSettings(),
    themePreference: settings.themePreference,
    languagePreference: settings.languagePreference,
    copyMode: settings.copyMode,
  }));
  const [devices, setDevices] = useState<SetupDevice[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [selectedBootstrap, setSelectedBootstrap] = useState<PairingBootstrap>();
  const [pendingFingerprint, setPendingFingerprint] = useState<{
    host: string;
    port: number;
    algorithm: string;
    fingerprint: string;
    target: 'pc' | 'router';
  }>();
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [profiles, setProfiles] = useState<OpenVpnProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [showSkip, setShowSkip] = useState(false);
  const runRef = useRef(0);
  const activePairing = useRef<{ endpoint: string; requestId: string; requestSecret: string;
    challenge?: string } | null>(null);
  const pcTrust = useRef<{ host: string; port: number; algorithm: string; fingerprint: string } | null>(null);
  const routerTrust = useRef<{ host: string; port: number; algorithm: string; fingerprint: string } | null>(null);

  const cancelActivePairing = useCallback(() => {
    const active = activePairing.current;
    activePairing.current = null;
    if (active) void PcControl.cancelSetupPairing(active).catch(() => {
      // Windows Setup retains the cleanup record and retries on its next start.
    });
  }, []);

  const back = useCallback(() => {
    runRef.current += 1;
    if (screen === 'approval' || screen === 'wake') cancelActivePairing();
    setError('');
    if (screen === 'complete') {
      onComplete();
      return true;
    }
    const previous: Partial<Record<Screen, Screen>> = {
      discover: 'choice',
      approval: 'discover',
      'manual-pc': 'choice',
      'pc-trust': 'manual-pc',
      wake: 'choice',
      'router-trust': 'wake',
      remote: 'wake',
      summary: 'remote',
    };
    if (screen === 'choice') setShowSkip(true);
    else setScreen(previous[screen] ?? 'choice');
    return true;
  }, [screen, onComplete, cancelActivePairing]);

  useEffect(() => {
    registerBack(back);
    return () => registerBack(null);
  }, [back, registerBack]);
  useEffect(() => () => {
    runRef.current += 1;
    cancelActivePairing();
  }, [cancelActivePairing]);
  const search = useCallback(async () => {
    setSearching(true);
    setError('');
    try {
      setDevices((await PcControl.discoverSetupDevices()).devices);
    } catch {
      setError(copy('PC를 찾지 못했어요. PC 화면의 QR 코드를 스캔할 수도 있어요.'));
    } finally {
      setSearching(false);
    }
  }, [copy]);
  useEffect(() => {
    if (screen === 'discover') void search();
  }, [screen, search]);
  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles((await PcControl.getOpenVpnProfiles()).profiles);
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    if (screen !== 'remote') return;
    void refreshProfiles();
  }, [screen, refreshProfiles]);

  async function prepareVpn() {
    setBusy(true);
    setError('');
    try {
      const installed = await PcControl.isOpenVpnInstalled();
      if (!installed.installed) {
        await PcControl.openOpenVpnApp();
        setError(copy('OpenVPN for Android를 설치하고 프로필을 추가한 뒤 다시 확인해주세요.'));
        return;
      }
      await PcControl.prepareOpenVpnControl();
      await refreshProfiles();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  function field<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
    setError('');
  }

  async function scanQr() {
    setError('');
    setBusy(true);
    try {
      const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!module.available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        let ready = false;
        for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          ready = (await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available;
        }
        if (!ready) throw new Error(copy('QR 스캐너를 준비할 수 없어요. 다시 시도해주세요.'));
      }
      const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode], autoZoom: true });
      const value = result.barcodes[0]?.rawValue;
      if (!value) return;
      await beginPairing(parsePairingBootstrap(JSON.parse(value) as unknown));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function selectDevice(device: SetupDevice) {
    setError('');
    try {
      const result = await PcControl.getSetupBootstrap({ endpoint: device.endpoint });
      await beginPairing(parsePairingBootstrap(result.bootstrap));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function beginPairing(bootstrap: PairingBootstrap) {
    const run = ++runRef.current;
    setBusy(true);
    setError('');
    try {
      const identity = await PcControl.ensureSshIdentity();
      if (!identity.publicKey) throw new Error(copy('휴대폰 연결 키를 준비할 수 없어요.'));
      setSelectedBootstrap(bootstrap);
      const { started, requestSecret } = await PcControl.startSetupPairing({
        endpoint: bootstrap.pairingEndpoint,
        oneTimeToken: bootstrap.oneTimeToken,
        deviceName: copy('Android 휴대폰'),
      });
      activePairing.current = { endpoint: bootstrap.pairingEndpoint, requestId: started.requestId, requestSecret };
      if (run !== runRef.current) { cancelActivePairing(); return; }
      const localCode = await deriveConfirmationCode(
        bootstrap.oneTimeToken,
        identity.publicKey,
        bootstrap.pairingIdentityFingerprint,
      );
      if (started.confirmationCode !== localCode)
        throw new Error(copy('PC와 휴대폰의 확인 코드가 달라요. 연결을 중단했어요.'));
      setConfirmationCode(localCode);
      setScreen('approval');
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline && run === runRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        if (run !== runRef.current) return;
        let raw: unknown;
        try {
          ({ status: raw } = await PcControl.getSetupPairingStatus({
            endpoint: bootstrap.pairingEndpoint,
            requestId: started.requestId,
            requestSecret,
          }));
        } catch {
          // A transient LAN failure is distinct from a PC rejection or cancellation.
          continue;
        }
        const status = parsePairingStatus(raw);
        if (status.requestId !== started.requestId)
          throw new Error(copy('페어링 요청 정보가 달라요.'));
        if (status.state === 'rejected') throw new Error(copy('PC에서 연결을 거절했어요.'));
        if (status.state === 'expired') throw new Error(copy('페어링 요청이 만료됐어요.'));
        if (status.state === 'cancelled') throw new Error(copy('연결이 취소됐어요.'));
        if (status.state === 'failed')
          throw new Error(status.error ?? copy('PC에서 연결 키를 등록하지 못했어요.'));
        if (status.state === 'verifying') {
          if (
            status.pc.hostId !== bootstrap.hostId ||
            status.pc.sshHostKeyFingerprint !== bootstrap.pairingIdentityFingerprint
          ) {
            throw new Error(copy('PC의 보안 정보가 달라요. 연결을 중단했어요.'));
          }
          await verifyAutoPc(status.pc);
          if (run !== runRef.current) return;
          if (activePairing.current?.requestId === started.requestId)
            activePairing.current.challenge = status.challenge;
          return;
        }
      }
      throw new Error(copy('PC 연결 응답을 기다리는 시간이 초과됐어요. 다시 시도해주세요.'));
    } catch (reason) {
      cancelActivePairing();
      if (run === runRef.current) {
        setError(String(reason));
        setScreen('discover');
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyAutoPc(info: PairedPcInfo) {
    const scanned = await PcControl.scanSshHostKey({ host: info.currentLanIp, port: info.sshPort });
    if (scanned.fingerprint !== info.sshHostKeyFingerprint) {
      throw new Error(copy('실제 SSH 서버의 보안 정보가 PC 설정 화면과 달라요.'));
    }
    const result = await PcControl.executeSshCommand({
      target: 'windows',
      host: info.currentLanIp,
      port: info.sshPort,
      username: info.sshUsername,
      expectedHostFingerprint: scanned.fingerprint,
      temporaryHostKeyAlgorithm: scanned.algorithm,
      temporaryHostKeyFingerprint: scanned.fingerprint,
      command: 'hostname',
    });
    if (result.exitCode !== 0) throw new Error(copy('SSH 인증에 실패했어요.'));
    pcTrust.current = scanned;
    setDraft((old) => ({
      ...old,
      pcName: info.displayName,
      pcHostId: info.hostId,
      pcHost: info.currentLanIp,
      pcHostname: info.hostname,
      pcHostFingerprint: scanned.fingerprint,
      pcLanPrefix: info.lanPrefix,
      pcPort: info.sshPort,
      pcUsername: info.sshUsername,
      pcMac: info.macAddressCandidate ?? '',
      routerHost: info.defaultGatewayCandidate ?? '',
    }));
    setScreen('wake');
  }

  async function verifyManualPc() {
    if (
      !draft.pcHost.trim() ||
      !draft.pcUsername.trim() ||
      draft.pcPort < 1 ||
      draft.pcPort > 65535
    ) {
      setError(copy('PC 주소, Windows 사용자 이름, SSH 포트를 확인해주세요.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await PcControl.ensureSshIdentity();
      const scanned = await PcControl.scanSshHostKey({ host: draft.pcHost, port: draft.pcPort });
      setPendingFingerprint({ ...scanned, target: 'pc' });
      setScreen('pc-trust');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function trustManualPc() {
    if (!pendingFingerprint) return;
    setBusy(true);
    setError('');
    try {
      const result = await PcControl.executeSshCommand({
        target: 'windows',
        host: draft.pcHost,
        port: draft.pcPort,
        username: draft.pcUsername,
        expectedHostFingerprint: pendingFingerprint.fingerprint,
        temporaryHostKeyAlgorithm: pendingFingerprint.algorithm,
        temporaryHostKeyFingerprint: pendingFingerprint.fingerprint,
        command: 'hostname',
      });
      if (result.exitCode !== 0) throw new Error(copy('SSH 인증에 실패했어요.'));
      pcTrust.current = pendingFingerprint;
      field('pcHostFingerprint', pendingFingerprint.fingerprint);
      setScreen('wake');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function continueWake() {
    if (!wakeEnabled) {
      setScreen('remote');
      return;
    }
    if (!isPowerOnConfigured(draft)) {
      setError(copy('PC 켜기에 필요한 MAC 주소와 공유기 정보를 확인해주세요.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const scanned = await PcControl.scanSshHostKey({
        host: draft.routerHost,
        port: draft.routerPort,
      });
      setPendingFingerprint({ ...scanned, target: 'router' });
      setScreen('router-trust');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function trustRouter() {
    if (!pendingFingerprint) return;
    setBusy(true);
    setError('');
    try {
      const result = await PcControl.executeSshCommand({
        target: 'router',
        host: draft.routerHost,
        port: draft.routerPort,
        username: draft.routerUsername,
        expectedHostFingerprint: pendingFingerprint.fingerprint,
        temporaryHostKeyAlgorithm: pendingFingerprint.algorithm,
        temporaryHostKeyFingerprint: pendingFingerprint.fingerprint,
        command: `test -x /usr/sbin/ether-wake && ip link show dev ${draft.wolInterface} >/dev/null`,
      });
      if (result.exitCode !== 0) throw new Error(copy('공유기 WOL 설정을 확인할 수 없어요.'));
      routerTrust.current = pendingFingerprint;
      setScreen('remote');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      if (!pcTrust.current) throw new Error(copy('PC SSH 검증을 먼저 완료해주세요.'));
      if (wakeEnabled && !routerTrust.current) throw new Error(copy('공유기 SSH 검증을 먼저 완료해주세요.'));
      if (remoteEnabled && !selectedProfile) throw new Error(copy('OpenVPN 프로필을 선택해주세요.'));
      const pairing = activePairing.current;
      if (pairing) {
        if (!pairing.challenge) throw new Error(copy('PC SSH 검증이 완료되지 않았어요.'));
        await PcControl.completeSetupPairing({
          endpoint: pairing.endpoint,
          requestId: pairing.requestId,
          requestSecret: pairing.requestSecret,
          challenge: pairing.challenge,
        });
      }
      await onCommit({
        ...draft,
        ...(!wakeEnabled
          ? { pcMac: '', routerHost: '', routerUsername: '', wolInterface: '', routerPort: 22 }
          : {}),
        onboardingStep: 0,
        onboardingCompleted: true,
      }, pcTrust.current, wakeEnabled ? routerTrust.current ?? undefined : undefined,
      remoteEnabled ? selectedProfile : undefined);
      if (pairing) await PcControl.finalizeSetupPairing({
        endpoint: pairing.endpoint,
        requestId: pairing.requestId,
        requestSecret: pairing.requestSecret,
      });
      activePairing.current = null;
      setScreen('complete');
    } catch (reason) {
      cancelActivePairing();
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const input = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder = '',
  ) => (
    <label className="v1-field">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );

  return (
    <div className="v1-onboarding">
      <div className="v1-top">
        <button type="button" onClick={back} disabled={screen === 'complete'}>
          {copy('‹ 뒤로')}
        </button>
        <button type="button" onClick={() => setShowSkip(true)} disabled={screen === 'complete'}>
          {copy('나중에')}
        </button>
      </div>
      {showSkip && (
        <div className="v1-skip-backdrop">
          <div
            className="v1-skip-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={copy('설정 중단 확인')}
          >
            <h2>{copy('진행 상황이 저장되지 않아요')}</h2>
            <p>{copy('지금 나가면 입력한 내용이 사라져요. 설정 마법사를 다시 시작하면 처음부터 진행해야 해요.')}</p>
            <div>
              <button type="button" onClick={() => setShowSkip(false)}>
                {copy('계속 설정')}
              </button>
              <button type="button" className="v1-primary" onClick={() => {
                runRef.current += 1;
                cancelActivePairing();
                onSkip();
              }}>
                {copy('나중에')}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="v1-error">
          {error}
        </p>
      )}
      {screen === 'choice' && (
        <section>
          <h1>{copy('PC를 어떻게 설정할까요?')}</h1>
          <p>{copy('환경에 맞는 설정 방법을 선택해주세요.')}</p>
          <button type="button" className="v1-choice" onClick={() => setScreen('discover')}>
            <strong>{copy('추천 · PC Control for Windows로 자동 설정')}</strong>
            <span>{copy('PC에 프로그램을 설치하면 연결에 필요한 설정을 자동으로 준비해요.')}</span>
          </button>
          <button type="button" className="v1-choice" onClick={() => setScreen('manual-pc')}>
            <strong>{copy('설치 없이 수동 설정')}</strong>
            <span>{copy('연결 정보를 직접 설정하려는 경우 사용해요.')}</span>
          </button>
        </section>
      )}
      {screen === 'discover' && (
        <section>
          <h1>{copy('PC Control for Windows를 실행해주세요')}</h1>
          <p>{copy('PC를 찾는 중에도 QR 코드를 바로 스캔할 수 있어요.')}</p>
          {searching && <p>{copy('PC를 찾고 있어요…')}</p>}
          {devices.map((device) => (
            <button
              key={device.endpoint}
              type="button"
              className="v1-choice"
              onClick={() => void selectDevice(device)}
            >
              <strong>{device.name}</strong>
              <span>{device.endpoint} · {copy('연결')}</span>
            </button>
          ))}
          <button type="button" onClick={() => void search()}>
            {copy('다시 찾기')}
          </button>
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void scanQr()}
          >
            {copy('PC 화면의 QR 코드 스캔')}
          </button>
        </section>
      )}
      {screen === 'approval' && (
        <section>
          <h1>{copy('PC에서 연결을 확인해주세요')}</h1>
          <p>{selectedBootstrap?.displayName} {copy('화면에 같은 코드가 표시되면 연결을 허용해주세요.')}</p>
          <strong className="v1-code">{confirmationCode}</strong>
        </section>
      )}
      {screen === 'manual-pc' && (
        <section>
          <h1>{copy('PC 연결 정보를 입력해주세요')}</h1>
          <p>{copy('SSH로 PC에 연결할 때 사용할 정보예요.')}</p>
          {input(
            copy('PC 주소'),
            draft.pcHost,
            (v) => field('pcHost', v),
            copy('192.168.0.10 또는 DESKTOP.local'),
          )}
          {input(copy('Windows 사용자 이름'), draft.pcUsername, (v) => field('pcUsername', v))}
          {input(copy('PC SSH 포트'), String(draft.pcPort), (v) => field('pcPort', Number(v)), '22')}
          <p>
            {copy('PC의 authorized_keys에 휴대폰 연결 키를 등록해주세요.')}{' '}
            <a href={TOOL_URL}>{copy('Windows 설정 스크립트')}</a>
          </p>
          <button
            type="button"
            onClick={() =>
              void PcControl.ensureSshIdentity()
                .then(() => PcControl.copySshPublicKey())
                .catch((reason: unknown) => setError(String(reason)))
            }
          >
            {copy('연결 키 복사')}
          </button>
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void verifyManualPc()}
          >
            {copy('연결 확인')}
          </button>
        </section>
      )}
      {screen === 'pc-trust' && (
        <section>
          <h1>{copy('PC 보안 정보 확인')}</h1>
          <p>{copy('PC에서 직접 확인한 SSH 지문과 아래 값이 같은지 확인해주세요.')}</p>
          <code>{pendingFingerprint?.fingerprint}</code>
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void trustManualPc()}
          >
            {copy('같아요')}
          </button>
        </section>
      )}
      {screen === 'wake' && (
        <section>
          <h1>{copy('PC 켜기 설정')}</h1>
          <p>{copy('공유기 SSH로 Wake-on-LAN을 사용할 경우 설정해요.')}</p>
          <label className="v1-toggle">
            <input
              type="checkbox"
              checked={wakeEnabled}
              onChange={(event) => setWakeEnabled(event.target.checked)}
            />
            {copy('PC 켜기 사용')}
          </label>
          {wakeEnabled && (
            <>
              {input(copy('PC MAC 주소'), draft.pcMac, (v) => field('pcMac', v.toUpperCase()))}
              {input(copy('네트워크 장비 주소'), draft.routerHost, (v) => field('routerHost', v))}
              {input(copy('네트워크 장비 SSH 사용자 이름'), draft.routerUsername, (v) =>
                field('routerUsername', v),
              )}
              {input(copy('네트워크 장비 SSH 포트'), String(draft.routerPort), (v) =>
                field('routerPort', Number(v)),
              )}
              {input(copy('LAN 인터페이스 이름'), draft.wolInterface, (v) => field('wolInterface', v))}
            </>
          )}
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void continueWake()}
          >
            {copy('계속')}
          </button>
        </section>
      )}
      {screen === 'router-trust' && (
        <section>
          <h1>{copy('공유기 보안 정보 확인')}</h1>
          <p>{copy('공유기에서 직접 확인한 SSH 지문과 같은지 확인해주세요.')}</p>
          <code>{pendingFingerprint?.fingerprint}</code>
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void trustRouter()}
          >
            {copy('같아요')}
          </button>
        </section>
      )}
      {screen === 'remote' && (
        <section>
          <h1>{copy('다른 네트워크 연결')}</h1>
          <p>{copy('외부에서도 PC에 연결하려면 OpenVPN 프로필을 선택해주세요.')}</p>
          <label className="v1-toggle">
            <input
              type="checkbox"
              checked={remoteEnabled}
              onChange={(event) => setRemoteEnabled(event.target.checked)}
            />
            {copy('다른 네트워크에서 연결')}
          </label>
          {remoteEnabled && (
            <div className="v1-profiles">
              {profiles.length ? (
                profiles.map((profile) => (
                  <label key={profile.id}>
                    <input
                      type="radio"
                      name="vpn"
                      checked={selectedProfile === profile.id}
                      onChange={() => setSelectedProfile(profile.id)}
                    />
                    {profile.name}
                  </label>
                ))
              ) : (
                <p>{copy('OpenVPN for Android에서 프로필을 준비해주세요.')}</p>
              )}
              <button type="button" disabled={busy} onClick={() => void prepareVpn()}>
                {copy('OpenVPN 설치·권한·프로필 확인')}
              </button>
            </div>
          )}
          <button type="button" className="v1-primary" onClick={() => setScreen('summary')}>
            {copy('설정 확인')}
          </button>
        </section>
      )}
      {screen === 'summary' && (
        <section>
          <h1>{copy('설정 요약')}</h1>
          <p>
            PC: {draft.pcName} · {draft.pcHost}
          </p>
          <p>{copy('PC 켜기:')} {wakeEnabled ? copy('설정됨') : copy('사용 안 함')}</p>
          <p>{copy('외부 연결:')} {remoteEnabled ? copy('프로필 선택됨') : copy('사용 안 함')}</p>
          <button
            type="button"
            className="v1-primary"
            disabled={busy}
            onClick={() => void finish()}
          >
            {copy('저장')}
          </button>
        </section>
      )}
      {screen === 'complete' && (
        <section>
          <h1>{copy('PC 연결이 완료됐어요')}</h1>
          <button type="button" className="v1-primary" onClick={onComplete}>
            {copy('시작하기')}
          </button>
        </section>
      )}
    </div>
  );
}
