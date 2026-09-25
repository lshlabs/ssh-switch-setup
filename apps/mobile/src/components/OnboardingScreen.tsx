import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Check, ChevronRight, Copy, LoaderCircle, Monitor, Network, Power, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import { PcControl, type OpenVpnProfile } from '@pc-control/capacitor-pc-control';
import { type AppSettings, validateSettingField } from '@pc-control/core';
import { useAppCopy } from '../i18n';
import { createOnboardingSession } from './onboardingSession';
import { PreferenceDialog } from './ui/preference-dialog';

type Screen =
  | 'welcome' | 'prepare' | 'pc-host' | 'pc-username' | 'pc-port-choice' | 'pc-port-custom'
  | 'pc-prepare' | 'pc-key' | 'pc-verifying' | 'pc-trust' | 'pc-failure' | 'pc-ready'
  | 'wake-intent' | 'wake-readiness' | 'wake-help' | 'mac' | 'router-host'
  | 'router-username' | 'interface' | 'router-port-choice' | 'router-port-custom'
  | 'wake-verifying' | 'router-trust' | 'wake-failure' | 'wake-ready'
  | 'remote-intent' | 'vpn' | 'summary' | 'save-failure' | 'complete';
type Stage = 'pc' | 'wake' | 'remote';
type PcFailure = 'connection' | 'auth' | 'security';
type WakeFailure = 'router' | 'settings' | 'security';
type ReturnTo = 'pc-verification' | 'wake-verification' | 'summary';
type FieldName = 'pcHost' | 'pcUsername' | 'pcPort' | 'pcMac' | 'routerHost' | 'routerUsername' | 'wolInterface' | 'routerPort';
type BackHandler = () => boolean;
const TOOL_URL = 'https://raw.githubusercontent.com/lshlabs/ssh-switch/main/scripts/setup-windows-ssh.ps1';
const PC_STAGES = ['pc', 'security', 'key'] as const;
const WAKE_STAGES = ['router', 'security', 'settings'] as const;
const WAIT_STAGE_MS = 450;
const WAIT_TOTAL_MS = 1500;
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, ms)));

function stageFor(screen: Screen): Stage {
  if (screen === 'welcome' || screen === 'prepare' || screen.startsWith('pc-')) return 'pc';
  if (screen.startsWith('wake-') || ['mac', 'router-host', 'router-username', 'interface', 'router-port-choice', 'router-port-custom'].includes(screen)) return 'wake';
  return 'remote';
}

export function OnboardingScreen({ settings, onSave, onComplete, onSkip, registerBack }: {
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<void>;
  onComplete: () => void;
  onSkip: () => void;
  registerBack: (handler: BackHandler | null) => void;
}) {
  const { t } = useAppCopy();
  const m = useCallback((key: string) => t(`onboarding.master.${key}`), [t]);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [history, setHistory] = useState<Screen[]>([]);
  const [draft, setDraft] = useState(() => createOnboardingSession(settings));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [inlineError, setInlineError] = useState<string>();
  const [identityReady, setIdentityReady] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [pcVerified, setPcVerified] = useState(false);
  const [wakeConfigured, setWakeConfigured] = useState(false);
  const [vpnIntent, setVpnIntent] = useState(false);
  const [vpnInstalled, setVpnInstalled] = useState<boolean>();
  const [vpnProfiles, setVpnProfiles] = useState<OpenVpnProfile[]>([]);
  const [vpnSelected, setVpnSelected] = useState<string>();
  const [vpnBusy, setVpnBusy] = useState(false);
  const [vpnStatusError, setVpnStatusError] = useState(false);
  const [pcFailure, setPcFailure] = useState<PcFailure>('connection');
  const [wakeFailure, setWakeFailure] = useState<WakeFailure>('router');
  const [hostKey, setHostKey] = useState<{ host: string; port: number; algorithm: string; fingerprint: string }>();
  const [processStage, setProcessStage] = useState<string>('pc');
  const [busy, setBusy] = useState(false);
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [openWolHelp, setOpenWolHelp] = useState<'pc' | 'router' | null>(null);
  const [returnTo, setReturnTo] = useState<ReturnTo>();
  const returnFromRef = useRef<Screen | undefined>(undefined);
  const editHistoryStartRef = useRef<number | undefined>(undefined);
  const editTerminalRef = useRef<Screen | undefined>(undefined);
  const dialogCloseRef = useRef<(() => void) | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pcStartedRef = useRef(0);
  const wakeStartedRef = useRef(0);
  const pcRunRef = useRef(0);
  const wakeRunRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identityAttemptedRef = useRef(false);
  const contentRef = useRef<HTMLElement | null>(null);
  const focusNextRef = useRef(false);
  const [copied, setCopied] = useState<'url' | 'key'>();

  function go(next: Screen) {
    setInlineError(undefined);
    setHistory((current) => [...current, screen]);
    setScreen(next);
  }
  function setField<K extends FieldName>(field: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === 'pcHost' || field === 'pcUsername' || field === 'pcPort') setPcVerified(false);
    setWakeConfigured(false);
  }
  function validate(field: FieldName): boolean {
    const invalid = validateSettingField(draft, field)[0];
    const invalidIpv4 = field === 'pcHost' && (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(draft.pcHost) || draft.pcHost.split('.').some((part) => Number(part) > 255));
    const emptyRequired = ['pcMac', 'routerHost', 'routerUsername', 'wolInterface'].includes(field) && !String(draft[field]).trim();
    if (invalid || emptyRequired || invalidIpv4) {
      setErrors((current) => ({ ...current, [field]: invalidIpv4 ? m('pcHost.error') : invalid ? t(invalid.key) : t(`validation.${field}`) }));
      return false;
    }
    return true;
  }
  function edit(next: Screen, target: ReturnTo, terminal = next) {
    returnFromRef.current = screen;
    editHistoryStartRef.current = history.length;
    setReturnTo(target);
    editTerminalRef.current = terminal;
    setScreen(next);
  }
  function finishEdit(portOverride?: number) {
    const target = returnTo;
    setReturnTo(undefined);
    setHistory((current) => current.slice(0, editHistoryStartRef.current ?? current.length));
    editHistoryStartRef.current = undefined;
    editTerminalRef.current = undefined;
    returnFromRef.current = undefined;
    if (target === 'pc-verification') void verifyPc(portOverride);
    else if (target === 'wake-verification') void verifyWake(portOverride);
    else if (target === 'summary') setScreen('summary');
  }
  function advance(next: Screen) {
    if (returnTo && screen === editTerminalRef.current) finishEdit();
    else go(next);
  }
  function back(): boolean {
    if (showSkipDialog) { dialogCloseRef.current?.(); return true; }
    if (screen === 'complete') { onComplete(); return true; }
    pcRunRef.current += 1;
    wakeRunRef.current += 1;
    if (returnTo) {
      setReturnTo(undefined);
      editTerminalRef.current = undefined;
      setHistory((current) => current.slice(0, editHistoryStartRef.current ?? current.length));
      setScreen(returnFromRef.current ?? 'summary');
      returnFromRef.current = undefined;
      editHistoryStartRef.current = undefined;
      return true;
    }
    const previous = history.at(-1);
    if (!previous) { setShowSkipDialog(true); return true; }
    setHistory((current) => current.slice(0, -1));
    setScreen(previous);
    return true;
  }
  useEffect(() => {
    registerBack(back);
    return () => registerBack(null);
  });
  useEffect(() => {
    if (screen === 'vpn') void refreshVpn();
  }, [screen]);
  useEffect(() => {
    let listener: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && screen === 'vpn') void refreshVpn();
    }).then((handle) => { listener = handle; }).catch(() => {});
    return () => { if (listener) void listener.remove(); };
  }, [screen]);
  useLayoutEffect(() => {
    if (focusNextRef.current) {
      focusNextRef.current = false;
      contentRef.current?.querySelector('input')?.focus({ preventScroll: true });
    } else if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [screen]);
  useEffect(() => {
    if (screen !== 'pc-prepare' || identityReady || identityBusy || identityAttemptedRef.current) return;
    identityAttemptedRef.current = true;
    setIdentityBusy(true);
    void PcControl.ensureSshIdentity()
      .then(() => setIdentityReady(true))
      .catch(() => setInlineError(m('identityError')))
      .finally(() => setIdentityBusy(false));
  }, [screen, identityReady, identityBusy, m]);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  async function timedStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    setProcessStage(stage);
    const started = performance.now();
    try { return await operation(); }
    finally { await delay(WAIT_STAGE_MS - (performance.now() - started)); }
  }
  async function pcSuccess(run: number) {
    await delay(WAIT_TOTAL_MS - (performance.now() - pcStartedRef.current));
    if (run !== pcRunRef.current) return;
    setPcVerified(true);
    setScreen('pc-ready');
  }
  async function checkPcKey(fingerprint: string, port = draft.pcPort, run = pcRunRef.current) {
    try {
      const result = await timedStage('key', () => PcControl.executeSshCommand({
        host: draft.pcHost, port, username: draft.pcUsername, target: 'windows',
        command: 'hostname', expectedHostFingerprint: fingerprint,
        connectTimeoutMs: 20000, commandTimeoutMs: 5000,
      }));
      if (run !== pcRunRef.current) return;
      if (result.exitCode !== 0) throw new Error('SSH command failed');
      await pcSuccess(run);
    } catch { if (run === pcRunRef.current) { setPcFailure('auth'); setScreen('pc-failure'); } }
  }
  async function verifyPc(port = draft.pcPort) {
    const run = ++pcRunRef.current;
    pcStartedRef.current = performance.now();
    setProcessStage('pc');
    go('pc-verifying');
    try {
      const reachable = await timedStage('pc', () => PcControl.checkHost({ host: draft.pcHost, port, timeoutMs: 5000 }));
      if (run !== pcRunRef.current) return;
      if (!reachable.reachable) { setPcFailure('connection'); setScreen('pc-failure'); return; }
      const trusted = await timedStage('security', () => PcControl.getTrustedSshHostKey({ host: draft.pcHost, port }));
      if (run !== pcRunRef.current) return;
      if (!trusted.trusted || !trusted.algorithm || !trusted.fingerprint) {
        const scanned = await PcControl.scanSshHostKey({ host: draft.pcHost, port, connectTimeoutMs: 5000 });
        if (run !== pcRunRef.current) return;
        setHostKey({ host: draft.pcHost, port, algorithm: scanned.algorithm, fingerprint: scanned.fingerprint });
        setScreen('pc-trust');
        return;
      }
      await checkPcKey(trusted.fingerprint, port, run);
    } catch { if (run === pcRunRef.current) { setPcFailure('connection'); setScreen('pc-failure'); } }
  }
  async function wakeSuccess(run: number) {
    await delay(WAIT_TOTAL_MS - (performance.now() - wakeStartedRef.current));
    if (run !== wakeRunRef.current) return;
    setWakeConfigured(true);
    setScreen('wake-ready');
  }
  async function checkRouterSettings(fingerprint: string, port = draft.routerPort, run = wakeRunRef.current) {
    try {
      const result = await timedStage('settings', () => PcControl.executeSshCommand({
        target: 'router', host: draft.routerHost, port,
        username: draft.routerUsername, expectedHostFingerprint: fingerprint,
        command: `test -x /usr/sbin/ether-wake && ip link show dev ${draft.wolInterface} >/dev/null`,
        connectTimeoutMs: 8000, commandTimeoutMs: 5000,
      }));
      if (run !== wakeRunRef.current) return;
      if (result.exitCode !== 0) throw new Error('Router WOL requirements unavailable');
      await wakeSuccess(run);
    } catch { if (run === wakeRunRef.current) { setWakeFailure('settings'); setScreen('wake-failure'); } }
  }
  async function verifyWake(port = draft.routerPort) {
    const run = ++wakeRunRef.current;
    wakeStartedRef.current = performance.now();
    setProcessStage('router');
    go('wake-verifying');
    try {
      const reachable = await timedStage('router', () => PcControl.checkHost({ host: draft.routerHost, port, timeoutMs: 5000 }));
      if (run !== wakeRunRef.current) return;
      if (!reachable.reachable) { setWakeFailure('router'); setScreen('wake-failure'); return; }
      const trusted = await timedStage('security', () => PcControl.getTrustedSshHostKey({ host: draft.routerHost, port }));
      if (run !== wakeRunRef.current) return;
      if (!trusted.trusted || !trusted.algorithm || !trusted.fingerprint) {
        const scanned = await PcControl.scanSshHostKey({ host: draft.routerHost, port, connectTimeoutMs: 5000 });
        if (run !== wakeRunRef.current) return;
        setHostKey({ host: draft.routerHost, port, algorithm: scanned.algorithm, fingerprint: scanned.fingerprint });
        setScreen('router-trust');
        return;
      }
      await checkRouterSettings(trusted.fingerprint, port, run);
    } catch { if (run === wakeRunRef.current) { setWakeFailure('router'); setScreen('wake-failure'); } }
  }
  async function trustAndContinue(target: 'pc' | 'router') {
    if (!hostKey) return;
    const run = target === 'pc' ? pcRunRef.current : wakeRunRef.current;
    setBusy(true);
    try {
      await PcControl.trustSshHostKey(hostKey);
      if (run !== (target === 'pc' ? pcRunRef.current : wakeRunRef.current)) return;
      if (target === 'pc') { setScreen('pc-verifying'); await checkPcKey(hostKey.fingerprint, hostKey.port, run); }
      else { setScreen('wake-verifying'); await checkRouterSettings(hostKey.fingerprint, hostKey.port, run); }
    } catch {
      if (run === (target === 'pc' ? pcRunRef.current : wakeRunRef.current)) {
        if (target === 'pc') { setPcFailure('security'); setScreen('pc-failure'); }
        else { setWakeFailure('security'); setScreen('wake-failure'); }
      }
    } finally { setBusy(false); }
  }
  async function prepareIdentity() {
    setIdentityBusy(true); setInlineError(undefined);
    try { await PcControl.ensureSshIdentity(); setIdentityReady(true); }
    catch { setInlineError(m('identityError')); }
    finally { setIdentityBusy(false); }
  }
  async function copyValue(kind: 'url' | 'key') {
    setInlineError(undefined);
    try {
      if (kind === 'url') await navigator.clipboard.writeText(TOOL_URL);
      else await PcControl.copySshPublicKey();
      setCopied(kind);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(undefined), 950);
      void PcControl.showSystemToast({ message: m(kind === 'url' ? 'urlCopied' : 'keyCopied'), skipWhenClipboardConfirmationAvailable: true }).catch(() => {});
    } catch { setInlineError(m(kind === 'url' ? 'urlCopyError' : 'keyCopyError')); }
  }
  async function refreshVpn() {
    setVpnBusy(true);
    setVpnStatusError(false);
    try {
      const installed = await PcControl.isOpenVpnInstalled();
      setVpnInstalled(installed.installed);
      if (!installed.installed) { setVpnProfiles([]); return; }
      const result = await PcControl.getOpenVpnProfiles();
      setVpnProfiles(result.profiles);
      setVpnSelected((current) => current && result.profiles.some((profile) => profile.id === current) ? current : undefined);
    } catch { setVpnStatusError(true); }
    finally { setVpnBusy(false); }
  }
  async function openVpn() {
    setInlineError(undefined);
    try { await PcControl.openOpenVpnApp(); }
    catch { setInlineError(t('settings.toast.openVpnAppOpenFailed')); }
  }
  async function save() {
    setBusy(true); setInlineError(undefined);
    let previousProfile: string | undefined;
    let profileChanged = false;
    try {
      if (Capacitor.isNativePlatform()) {
        const profiles = await PcControl.getOpenVpnProfiles().catch(() => undefined);
        previousProfile = profiles?.selectedProfileId;
        if (vpnIntent && vpnSelected) await PcControl.selectOpenVpnProfile({ profileId: vpnSelected });
        else await PcControl.clearOpenVpnProfileSelection();
        profileChanged = true;
      }
      await onSave({
        ...draft,
        ...(!wakeConfigured ? { pcMac: '', routerHost: '', routerUsername: '', wolInterface: '', routerPort: 22 } : {}),
        onboardingStep: 0,
        onboardingCompleted: true,
      });
      setScreen('complete');
    } catch {
      if (profileChanged) {
        try {
          if (previousProfile) await PcControl.selectOpenVpnProfile({ profileId: previousProfile });
          else await PcControl.clearOpenVpnProfileSelection();
        } catch { /* The save error remains visible; retry can restore a consistent selection. */ }
      }
      setScreen('save-failure');
    }
    finally { setBusy(false); }
  }
  function skipWake() {
    setWakeConfigured(false);
    setDraft((current) => ({ ...current, pcMac: '', routerHost: '', routerUsername: '', wolInterface: '', routerPort: 22 }));
    advance('remote-intent');
  }
  function skipVpn() { setVpnIntent(false); setVpnSelected(undefined); advance('summary'); }
  const stage = stageFor(screen);
  const fullFooter = (label: string, onClick: () => void, disabled = false) => <Footer><Primary disabled={disabled} onClick={onClick}>{label}</Primary></Footer>;
  const input = (options: { title: string; description: string; field: FieldName; label: string; placeholder?: string; help: string; helpSummary: string; next: Screen; numeric?: boolean; transform?: (value: string) => string | number; final?: boolean }) => (
    <Flow title={options.title} description={options.description} variant="input">
      <Field label={options.label} value={String(draft[options.field] || '')} placeholder={options.placeholder}
        error={errors[options.field]} help={options.help} helpSummary={options.helpSummary}
        inputMode={options.numeric ? 'numeric' : 'text'} enterKeyHint={options.final ? 'done' : 'next'}
        onSubmit={() => { if (validate(options.field)) { focusNextRef.current = ['pc-username', 'router-host', 'router-username', 'interface'].includes(options.next); advance(options.next); } }}
        onChange={(value) => setField(options.field, (options.transform ? options.transform(value) : value) as never)} />
      {fullFooter(m('continue'), () => { if (validate(options.field)) advance(options.next); })}
    </Flow>
  );

  return (
    <div className="preferences-page onboarding-page">
      <div className="onboarding-layout" inert={showSkipDialog} onClickCapture={(event) => { returnFocusRef.current = (event.target as HTMLElement).closest('button'); }}>
        <header className="onboarding-flow-toolbar">
          <button type="button" className="onboarding-back" aria-label={t('onboarding.navigation.previous')}
            disabled={screen === 'welcome' || screen === 'complete'} onClick={back}><span aria-hidden="true">‹</span></button>
          {screen !== 'complete' && <button type="button" className="onboarding-skip" onClick={() => setShowSkipDialog(true)}>{m('later')}</button>}
        </header>
        {screen !== 'welcome' && screen !== 'complete' && <StageIndicator current={stage} labels={[m('stage.pc'), m('stage.wake'), m('stage.remote')]} ariaPrefix={m('stage.ariaPrefix')} />}
        <main className="onboarding-flow-content" ref={contentRef} key={screen}>
          {screen === 'welcome' && <Flow title={m('welcome.title')} description={m('welcome.description')} visual="pc">
            {fullFooter(m('welcome.action'), () => go('prepare'))}
          </Flow>}
          {screen === 'prepare' && <Flow title={m('prepare.title')} description={m('prepare.description')} visual="pc">
            <p className="onboarding-supporting">{m('prepare.note')}</p>
            {fullFooter(m('prepare.action'), () => go('pc-host'))}
          </Flow>}
          {screen === 'pc-host' && input({ title: m('pcHost.title'), description: m('pcHost.description'), field: 'pcHost', label: m('pcHost.label'), placeholder: '192.168.0.10', helpSummary: m('pcHost.helpSummary'), help: m('pcHost.help'), next: 'pc-username' })}
          {screen === 'pc-username' && input({ title: m('pcUsername.title'), description: m('pcUsername.description'), field: 'pcUsername', label: m('pcUsername.label'), placeholder: 'admin', helpSummary: m('pcUsername.helpSummary'), help: m('pcUsername.help'), next: 'pc-port-choice' })}
          {screen === 'pc-port-choice' && <Flow title={m('pcPortChoice.title')} description={m('pcPortChoice.description')}>
            <Choices>
              <Choice onClick={() => { setField('pcPort', 22); advance('pc-prepare'); }}>{m('defaultPort')}</Choice>
              <Choice onClick={() => { if (draft.pcPort === 22) setField('pcPort', 0); go('pc-port-custom'); }}>{m('otherPort')}</Choice>
            </Choices>
          </Flow>}
          {screen === 'pc-port-custom' && input({ title: m('pcPort.title'), description: m('pcPort.description'), field: 'pcPort', label: m('pcPort.label'), placeholder: '22', helpSummary: m('pcPort.helpSummary'), help: m('pcPort.help'), next: 'pc-prepare', numeric: true, transform: Number, final: true })}
          {screen === 'pc-prepare' && <Flow title={m('pcPrepare.title')} description={m('pcPrepare.description')} visual="phone">
            <div className="onboarding-task-list">
              <section className="onboarding-task"><strong>{m('pcPrepare.task1')}</strong><p>{m('pcPrepare.task1Body')}</p>
                <div className="onboarding-url"><span>{TOOL_URL}</span><button type="button" className="onboarding-copy-button" aria-label={m('copyUrl')} onClick={() => void copyValue('url')}>{copied === 'url' ? <Check size={19} /> : <Copy size={19} />}</button></div>
              </section>
              <section className="onboarding-task"><strong>{m('pcPrepare.task2')}</strong><p>{m('pcPrepare.task2Body')}</p>
                <Disclosure label={m('runHelpTitle')} detail={m('runHelp')} />
              </section>
            </div>
            {inlineError && <InlineError message={inlineError} />}
            {!identityReady && <SecondaryAction disabled={identityBusy} onClick={() => void prepareIdentity()}>{identityBusy ? m('identityBusy') : m('identityPrepare')}</SecondaryAction>}
            {fullFooter(m('pcPrepare.action'), () => advance('pc-key'), !identityReady || identityBusy)}
          </Flow>}
          {screen === 'pc-key' && <Flow title={m('pcKey.title')} description={m('pcKey.description')} visual="key">
            <div className="onboarding-url"><span>{m('pcKey.keyReady')}</span><button type="button" className="onboarding-copy-button" aria-label={m('copyKey')} onClick={() => void copyValue('key')}>{copied === 'key' ? <Check size={19} /> : <Copy size={19} />}</button></div>
            {inlineError && <InlineError message={inlineError} />}
            {fullFooter(m('pcKey.action'), () => { if (returnTo) finishEdit(); else void verifyPc(); })}
          </Flow>}
          {screen === 'pc-verifying' && <Flow title={m('pcVerify.title')} visual="process">
            <StatusRows rows={PC_STAGES.map((key) => m(`pcVerify.${key}`))} keys={PC_STAGES} current={processStage} checking={m('checking')} done={m('done')} waiting={m('waiting')} />
          </Flow>}
          {screen === 'pc-trust' && hostKey && <Flow title={m('pcTrust.title')} description={m('pcTrust.description')} visual="shield">
            <code className="onboarding-fingerprint">{hostKey.fingerprint}</code>
            <Choices><Choice disabled={busy} onClick={() => void trustAndContinue('pc')}>{m('trustSame')}</Choice><Choice onClick={() => { setPcFailure('security'); go('pc-failure'); }}>{m('trustDifferent')}</Choice></Choices>
          </Flow>}
          {screen === 'pc-failure' && <FailureScreen title={m(`pcFailure.${pcFailure}.title`)} description={m(`pcFailure.${pcFailure}.description`)} primary={m(`pcFailure.${pcFailure}.action`)} retry={m('retry')}
            onPrimary={() => edit(pcFailure === 'auth' ? 'pc-prepare' : 'pc-host', 'pc-verification', 'pc-key')} onRetry={() => void verifyPc()} />}
          {screen === 'pc-ready' && <Flow title={m('pcReady.title')} description={m('pcReady.description')} visual="success">
            <SummaryRow label={m('summary.pc')} status={m('summary.verified')} />
            {fullFooter(m('continue'), () => go('wake-intent'))}
          </Flow>}

          {screen === 'wake-intent' && <Flow title={m('wakeIntent.title')} description={m('wakeIntent.description')} visual="power">
            <Choices><Choice onClick={() => go('wake-readiness')}>{m('wakeIntent.yes')}</Choice><Choice onClick={skipWake}>{m('skipNow')}</Choice></Choices>
          </Flow>}
          {screen === 'wake-readiness' && <Flow title={m('wakeReadiness.title')} description={m('wakeReadiness.description')} visual="power">
            <Choices><Choice onClick={() => go('mac')}>{m('wakeReadiness.ready')}</Choice><Choice onClick={() => go('wake-help')}>{m('wakeReadiness.help')}</Choice><Choice onClick={skipWake}>{m('skipNow')}</Choice></Choices>
          </Flow>}
          {screen === 'wake-help' && <Flow title={m('wakeHelp.title')} description={m('wakeHelp.description')}>
            <div className="onboarding-guide-list">
              <Disclosure label={m('wakeHelp.pcTitle')} summary={m('wakeHelp.pcSummary')} detail={m('wakeHelp.pcBody')} expanded={openWolHelp === 'pc'} onExpandedChange={() => setOpenWolHelp((current) => current === 'pc' ? null : 'pc')} />
              <Disclosure label={m('wakeHelp.routerTitle')} summary={m('wakeHelp.routerSummary')} detail={m('wakeHelp.routerBody')} expanded={openWolHelp === 'router'} onExpandedChange={() => setOpenWolHelp((current) => current === 'router' ? null : 'router')} />
            </div>
            <Choices><Choice onClick={() => go('mac')}>{m('wakeHelp.canSetup')}</Choice><Choice onClick={skipWake}>{m('skipNow')}</Choice></Choices>
          </Flow>}
          {screen === 'mac' && input({ title: m('mac.title'), description: m('mac.description'), field: 'pcMac', label: m('mac.label'), placeholder: '2C:F0:5D:83:5B:07', helpSummary: m('mac.helpSummary'), help: m('mac.help'), next: 'router-host', transform: (value) => value.toUpperCase() })}
          {screen === 'router-host' && input({ title: m('routerHost.title'), description: m('routerHost.description'), field: 'routerHost', label: m('routerHost.label'), placeholder: '192.168.0.1', helpSummary: m('routerHost.helpSummary'), help: m('routerHost.help'), next: 'router-username' })}
          {screen === 'router-username' && input({ title: m('routerUsername.title'), description: m('routerUsername.description'), field: 'routerUsername', label: m('routerUsername.label'), placeholder: 'username', helpSummary: m('routerUsername.helpSummary'), help: m('routerUsername.help'), next: 'interface' })}
          {screen === 'interface' && input({ title: m('interface.title'), description: m('interface.description'), field: 'wolInterface', label: m('interface.label'), placeholder: 'br0', helpSummary: m('interface.helpSummary'), help: m('interface.help'), next: 'router-port-choice' })}
          {screen === 'router-port-choice' && <Flow title={m('routerPortChoice.title')} description={m('routerPortChoice.description')}>
            <Choices><Choice onClick={() => { setField('routerPort', 22); if (returnTo) finishEdit(22); else void verifyWake(22); }}>{m('defaultPort')}</Choice>
              <Choice onClick={() => { if (draft.routerPort === 22) setField('routerPort', 0); go('router-port-custom'); }}>{m('otherPort')}</Choice></Choices>
          </Flow>}
          {screen === 'router-port-custom' && <Flow title={m('routerPort.title')} description={m('routerPort.description')} variant="input">
            <Field label={m('routerPort.label')} value={draft.routerPort ? String(draft.routerPort) : ''} placeholder="22" inputMode="numeric" enterKeyHint="done" error={errors.routerPort}
              helpSummary={m('routerPort.helpSummary')} help={m('routerPort.help')} onChange={(value) => setField('routerPort', Number(value))} onSubmit={() => { if (validate('routerPort')) { if (returnTo) finishEdit(); else void verifyWake(); } }} />
            {fullFooter(m('continue'), () => { if (validate('routerPort')) { if (returnTo) finishEdit(); else void verifyWake(); } })}
          </Flow>}
          {screen === 'wake-verifying' && <Flow title={m('wakeVerify.title')} visual="process">
            <StatusRows rows={WAKE_STAGES.map((key) => m(`wakeVerify.${key}`))} keys={WAKE_STAGES} current={processStage} checking={m('checking')} done={m('done')} waiting={m('waiting')} />
          </Flow>}
          {screen === 'router-trust' && hostKey && <Flow title={m('routerTrust.title')} description={m('routerTrust.description')} visual="shield">
            <code className="onboarding-fingerprint">{hostKey.fingerprint}</code>
            <Choices><Choice disabled={busy} onClick={() => void trustAndContinue('router')}>{m('trustSame')}</Choice><Choice onClick={() => { setWakeFailure('security'); go('wake-failure'); }}>{m('trustDifferent')}</Choice></Choices>
          </Flow>}
          {screen === 'wake-failure' && <FailureScreen title={m(`wakeFailure.${wakeFailure}.title`)} description={m(`wakeFailure.${wakeFailure}.description`)} primary={m(`wakeFailure.${wakeFailure}.action`)} retry={m('retry')}
            onPrimary={() => edit(wakeFailure === 'router' || wakeFailure === 'security' ? 'router-host' : 'mac', 'wake-verification', 'router-port-choice')} onRetry={() => void verifyWake()} />}
          {screen === 'wake-ready' && <Flow title={m('wakeReady.title')} description={m('wakeReady.description')} visual="success">
            <SummaryRow label={m('summary.wake')} status={m('summary.configured')} />
            {fullFooter(m('continue'), () => go('remote-intent'))}
          </Flow>}

          {screen === 'remote-intent' && <Flow title={m('remoteIntent.title')} description={m('remoteIntent.description')} visual="network">
            <Choices><Choice onClick={() => { setVpnIntent(true); go('vpn'); }}>{m('remoteIntent.yes')}</Choice><Choice onClick={skipVpn}>{m('skipNow')}</Choice></Choices>
          </Flow>}
          {screen === 'vpn' && (vpnStatusError ? <Flow title={m('vpn.checkError')} description={m('vpn.checkErrorDescription')} visual="error">
            <Footer><Primary onClick={() => void refreshVpn()}>{m('retry')}</Primary><TextAction onClick={skipVpn}>{m('skipNow')}</TextAction></Footer>
          </Flow> : vpnInstalled === undefined ? <Flow title={m('vpn.checking')} visual="process" /> : !vpnInstalled ?
            <Flow title={m('vpn.installTitle')} description={m('vpn.installDescription')} visual="network">
              {inlineError && <InlineError message={inlineError} />}
              <Footer><Primary onClick={() => void openVpn()}>{m('vpn.install')}</Primary><TextAction onClick={skipVpn}>{m('skipNow')}</TextAction></Footer>
            </Flow> : !vpnProfiles.length ?
            <Flow title={m('vpn.profileTitle')} description={m('vpn.profileDescription')} visual="network">
              {inlineError && <InlineError message={inlineError} />}
              <Footer><Primary onClick={() => void openVpn()}>{m('vpn.open')}</Primary><TextAction onClick={() => void refreshVpn()}>{vpnBusy ? m('checking') : m('vpn.recheck')}</TextAction><TextAction onClick={skipVpn}>{m('skipNow')}</TextAction></Footer>
            </Flow> : <Flow title={m('vpn.selectTitle')} description={m('vpn.selectDescription')} visual="network">
              <div className="onboarding-radio-list" role="radiogroup" aria-label={m('vpn.selectTitle')}>
                {vpnProfiles.map((profile) => <label key={profile.id} className="preferences-dialog-choice-row onboarding-vpn-choice"><input className="settings-native-radio" type="radio" name="vpn-profile" checked={vpnSelected === profile.id} onChange={() => setVpnSelected(profile.id)} /><span className="preferences-dialog-choice-indicator" aria-hidden="true" /><span>{profile.name}</span></label>)}
              </div>
              {fullFooter(m('continue'), () => advance('summary'), !vpnSelected)}
            </Flow>)}
          {screen === 'summary' && <Flow title={m('summary.title')} description={m('summary.description')} visual="shield">
            <div className="onboarding-status-list onboarding-summary-list">
              <SummaryRow label={m('summary.pc')} status={pcVerified ? m('summary.verified') : m('summary.unavailable')} />
              <SummaryRow label={m('summary.wake')} status={wakeConfigured ? m('summary.configured') : m('summary.off')} />
              <SummaryRow label={m('summary.remote')} status={vpnIntent && vpnSelected ? m('summary.profileSelected') : m('summary.off')} />
            </div>
            {fullFooter(m('summary.save'), () => void save(), busy || !pcVerified)}
          </Flow>}
          {screen === 'save-failure' && <Flow title={m('saveFailure.title')} description={m('saveFailure.description')} visual="error">
            <Footer><Primary disabled={busy} onClick={() => void save()}>{m('retry')}</Primary><TextAction onClick={() => go('summary')}>{m('saveFailure.review')}</TextAction></Footer>
          </Flow>}
          {screen === 'complete' && <Flow title={m('complete.title')} description={m('complete.description')} visual="success">
            <p className="onboarding-supporting">{m('complete.note')}</p>
            {fullFooter(m('complete.action'), onComplete)}
          </Flow>}
        </main>
      </div>
      {showSkipDialog && <PreferenceDialog variant="confirm" title={t('onboarding.dialog.skipTitle')} closeRef={dialogCloseRef} returnFocusRef={returnFocusRef} onClose={() => setShowSkipDialog(false)} actions={[{ label: t('onboarding.dialog.continueSetup'), close: true }, { label: t('onboarding.dialog.skip'), close: true, onClick: onSkip }]}><p>{t('onboarding.dialog.skipDescription')}</p></PreferenceDialog>}
    </div>
  );
}

type Visual = 'pc' | 'phone' | 'key' | 'process' | 'shield' | 'success' | 'power' | 'network' | 'error';
function Flow({ title, description, visual, variant, children }: { title: string; description?: string; visual?: Visual; variant?: 'input'; children?: ReactNode }) {
  const icons = { pc: Monitor, phone: Smartphone, key: ShieldCheck, process: LoaderCircle, shield: ShieldCheck, success: Check, power: Power, network: Network, error: TriangleAlert };
  const Icon = visual ? icons[visual] : undefined;
  return <section className={`onboarding-flow ${variant ? `onboarding-flow--${variant}` : ''}`}>
    {Icon && <div className={`onboarding-visual onboarding-visual--${visual}`} aria-hidden="true"><Icon size={30} strokeWidth={1.8} /></div>}
    <div className="onboarding-question"><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {children}
  </section>;
}
function Footer({ children }: { children: ReactNode }) { return <div className="onboarding-flow-footer">{children}</div>; }
function Primary({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="onboarding-flow-primary oneui-button oneui-button--primary" onClick={onClick} disabled={disabled}>{children}</button>;
}
function SecondaryAction({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="onboarding-secondary-action" onClick={onClick} disabled={disabled}>{children}</button>;
}
function TextAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="onboarding-text-action" onClick={onClick}>{children}</button>;
}
function Choices({ children }: { children: ReactNode }) { return <div className="onboarding-choices" role="group">{children}</div>; }
function Choice({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="onboarding-choice" onClick={onClick} disabled={disabled}><span><strong>{children}</strong></span><span className="onboarding-choice-radio" aria-hidden="true" /></button>;
}
function Disclosure({ label, summary, detail, expanded, onExpandedChange }: { label: string; summary?: string; detail: string; expanded?: boolean; onExpandedChange?: () => void }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = onExpandedChange ? !!expanded : localOpen;
  return <div className={`onboarding-help-disclosure ${open ? 'is-open' : ''}`}>
    <button type="button" className="onboarding-help-row" aria-expanded={open} onClick={onExpandedChange ?? (() => setLocalOpen((value) => !value))}>
      <span><strong>{label}</strong>{summary && <small>{summary}</small>}</span><ChevronRight size={20} aria-hidden="true" />
    </button>
    {open && <div className="onboarding-help-detail">{detail}</div>}
  </div>;
}
function Field({ label, value, placeholder, inputMode, enterKeyHint, onChange, onSubmit, error, help, helpSummary }: { label: string; value: string; placeholder?: string | undefined; inputMode: 'text' | 'numeric'; enterKeyHint: 'next' | 'done'; onChange: (value: string) => void; onSubmit: () => void; error?: string | undefined; help: string; helpSummary: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reveal = (target: HTMLInputElement) => {
    window.setTimeout(() => {
      if (document.activeElement !== target) return;
      const viewport = window.visualViewport;
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height') || '0', 10);
      const overflow = target.getBoundingClientRect().bottom + 28 - viewportBottom;
      if (overflow > 0) target.closest('.onboarding-flow-content')?.scrollBy({ top: overflow, behavior: 'smooth' });
    }, 80);
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onResize = () => { if (inputRef.current && document.activeElement === inputRef.current) reveal(inputRef.current); };
    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
  }, []);
  return <div className="onboarding-field">
    <div className="onboarding-field-control"><div className="onboarding-field-label"><label htmlFor={id}>{label}</label></div>
      <input ref={inputRef} id={id} value={value} placeholder={placeholder} inputMode={inputMode} enterKeyHint={enterKeyHint} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} onFocus={(event) => reveal(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onSubmit(); } }} /></div>
    {error && <p className="onboarding-field-feedback is-error" id={`${id}-error`}>{error}</p>}
    <Disclosure label="어디서 확인하나요?" summary={helpSummary} detail={help} />
  </div>;
}
function InlineError({ message }: { message: string }) { return <p className="onboarding-inline-error" role="alert">{message}</p>; }
function StatusRows({ rows, keys, current, checking, done, waiting }: { rows: string[]; keys: readonly string[]; current: string; checking: string; done: string; waiting: string }) {
  const currentIndex = keys.indexOf(current);
  return <div className="onboarding-status-list">{rows.map((row, index) => <div className="onboarding-status-row" key={keys[index]}><span>{row}</span><span>{index < currentIndex ? done : index === currentIndex ? checking : waiting}</span></div>)}</div>;
}
function SummaryRow({ label, status }: { label: string; status: string }) { return <div className="onboarding-status-row"><span>{label}</span><strong>{status}</strong></div>; }
function StageIndicator({ current, labels, ariaPrefix }: { current: Stage; labels: [string, string, string]; ariaPrefix: string }) {
  const stages: Stage[] = ['pc', 'wake', 'remote'];
  const index = stages.indexOf(current);
  return <div className="onboarding-stage-indicator" role="img" aria-label={`${ariaPrefix}: ${labels[index]}`}>
    {stages.map((stage, position) => <span key={stage} className={position <= index ? 'is-active' : ''} />)}
  </div>;
}
function FailureScreen({ title, description, primary, retry, onPrimary, onRetry }: { title: string; description: string; primary: string; retry: string; onPrimary: () => void; onRetry: () => void }) {
  return <Flow title={title} description={description} visual="error"><Footer><Primary onClick={onPrimary}>{primary}</Primary><TextAction onClick={onRetry}>{retry}</TextAction></Footer></Flow>;
}
