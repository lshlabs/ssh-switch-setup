import { PageStack } from '../components/ui/page-stack';
import { usePageStack } from '../hooks/usePageStack';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  Globe2,
  KeyRound,
  LoaderCircle,
  Monitor,
  Power,
  Settings2,
  type LucideIcon,
  WandSparkles,
  Wifi,
} from 'lucide-react';
import {
  PcControl,
  type OpenVpnStatusResult,
  type SshHostKeyResult,
} from '@pc-control/capacitor-pc-control';
import {
  isPowerOnConfigured,
  isPcConnectionConfigured,
  validateAppSettings,
  type AppSettings,
  type PcControlConfig,
  type PcStatus,
} from '@pc-control/core';
import { useAppCopy } from '../i18n';
import {
  PreferenceActionRow,
  PreferenceRow,
  PreferenceSection,
  PreferenceStatusRow,
  PreferenceToolbar,
} from '../components/ui/preferences';
import { describeError } from '../lib/errorMapping';
import {
  isPcUnavailableError,
  isSshAuthError,
  type PcVerificationState,
} from '../lib/pcVerification';

type BackHandler = () => boolean;
type Check = 'idle' | 'checking' | 'ok' | 'error';
type RouterLoginCheck = 'idle' | 'checking' | 'pending' | 'ok' | 'auth-failed' | 'error';
type PcCheck = PcVerificationState;
type HostKeyScanState = 'idle' | 'checking' | 'pending' | 'error';
type DiagnosticsPage =
  'overview' | 'connection' | 'wake' | 'remote' | 'quickCheck' | 'pcTrust' | 'routerTrust';
type QuickDiagnosticStatus = 'idle' | 'checking' | 'passed' | 'attention';
type QuickDiagnosticStepId = 'settings' | 'identity' | 'pc' | 'wake' | 'remote';
type QuickDiagnosticStep = {
  id: QuickDiagnosticStepId;
  status: QuickDiagnosticStatus;
};
type SummaryTone = 'neutral' | 'success' | 'warning' | 'danger';
type NetworkEnsuredHandler = (vpnWasStartedByApp: boolean) => void;
type DiagnosticsState = {
  pcStatus: PcStatus;
  pcCheck: PcCheck;
  routerCheck: Check;
  routerLoginCheck: RouterLoginCheck;
  vpnInstalled?: boolean | undefined;
  vpnSelectedProfile?: string | undefined;
  vpnPermission: Check;
  vpnStatus: OpenVpnStatusResult;
  quickDiagnosticSteps: QuickDiagnosticStep[];
  quickDiagnosticCleanupFailed: boolean;
};
type HostKeyState = {
  key?: { algorithm?: string; fingerprint?: string; trusted: boolean } | undefined;
  scanState: HostKeyScanState;
};

const diagnosticsStateCache = new Map<string, DiagnosticsState>();
const hostKeyStateCache = new Map<string, HostKeyState>();

const QUICK_DIAGNOSTIC_STEP_IDS: QuickDiagnosticStepId[] = [
  'settings',
  'identity',
  'pc',
  'wake',
  'remote',
];

const QUICK_DIAGNOSTIC_STEP_ICONS: Record<QuickDiagnosticStepId, LucideIcon> = {
  settings: Settings2,
  identity: KeyRound,
  pc: Monitor,
  wake: Power,
  remote: Globe2,
};

const MIN_QUICK_DIAGNOSTIC_STEP_DURATION_MS = 800;

function createQuickDiagnosticSteps(): QuickDiagnosticStep[] {
  return QUICK_DIAGNOSTIC_STEP_IDS.map((id) => ({ id, status: 'idle' }));
}

export function DiagnosticsScreen({
  settings,
  config,
  onToast,
  onBack,
  registerBack,
}: {
  settings: AppSettings;
  config: PcControlConfig;
  onToast: (message: string) => void;
  onBack: () => void;
  registerBack: (handler: BackHandler | null) => void;
}) {
  const { t, copy } = useAppCopy();
  const cacheKey = `${config.pc.host}:${config.pc.sshPort}|${config.router.host}:${config.router.sshPort}`;
  const cachedState = diagnosticsStateCache.get(cacheKey);
  const [pcStatus, setPcStatus] = useState<PcStatus>(() => cachedState?.pcStatus ?? 'unknown');
  const [pcCheck, setPcCheck] = useState<PcCheck>(() => cachedState?.pcCheck ?? 'idle');
  const [routerCheck, setRouterCheck] = useState<Check>(() => cachedState?.routerCheck ?? 'idle');
  const [routerLoginCheck, setRouterLoginCheck] = useState<RouterLoginCheck>(
    () => cachedState?.routerLoginCheck ?? 'idle',
  );
  const [vpnInstalled, setVpnInstalled] = useState<boolean | undefined>(
    () => cachedState?.vpnInstalled,
  );
  const [vpnSelectedProfile, setVpnSelectedProfile] = useState<string | undefined>(
    () => cachedState?.vpnSelectedProfile,
  );
  const [vpnPermission, setVpnPermission] = useState<Check>(
    () => cachedState?.vpnPermission ?? 'idle',
  );
  const [vpnStatus, setVpnStatus] = useState<OpenVpnStatusResult>(
    () => cachedState?.vpnStatus ?? { status: 'disconnected', vpnWasStartedByApp: false },
  );
  const [quickDiagnosticSteps, setQuickDiagnosticSteps] = useState<QuickDiagnosticStep[]>(
    () => cachedState?.quickDiagnosticSteps ?? createQuickDiagnosticSteps(),
  );
  const [quickDiagnosticRunning, setQuickDiagnosticRunning] = useState(false);
  const [quickDiagnosticCleanupFailed, setQuickDiagnosticCleanupFailed] = useState(
    () => cachedState?.quickDiagnosticCleanupFailed ?? false,
  );
  const [quickDiagnosticActiveStep, setQuickDiagnosticActiveStep] =
    useState<QuickDiagnosticStepId>();
  const quickDiagnosticRunningRef = useRef(false);
  const navigation = usePageStack<DiagnosticsPage>('overview');
  const { open: setPage, back: goBack } = navigation;
  const ensureNetwork = config.router.host
    ? () =>
        PcControl.ensureHomeNetwork({
          routerHost: config.router.host,
          routerPort: config.router.sshPort,
          postConnectReachabilityTimeoutMs: 10000,
        })
    : undefined;

  useEffect(() => {
    diagnosticsStateCache.set(cacheKey, {
      pcStatus,
      pcCheck,
      routerCheck,
      routerLoginCheck,
      vpnInstalled,
      vpnSelectedProfile,
      vpnPermission,
      vpnStatus,
      quickDiagnosticSteps,
      quickDiagnosticCleanupFailed,
    });
  }, [
    cacheKey,
    pcCheck,
    pcStatus,
    quickDiagnosticCleanupFailed,
    quickDiagnosticSteps,
    routerCheck,
    routerLoginCheck,
    vpnInstalled,
    vpnPermission,
    vpnSelectedProfile,
    vpnStatus,
  ]);

  useEffect(() => {
    registerBack(() => {
      return goBack();
    });
    return () => registerBack(null);
  }, [goBack, registerBack]);
  useEffect(() => {
    void PcControl.isOpenVpnInstalled()
      .then((result) => setVpnInstalled(result.installed))
      .catch(() => setVpnInstalled(false));
    void PcControl.getOpenVpnProfiles()
      .then((result) => {
        setVpnSelectedProfile(result.selectedProfileId);
      })
      .catch(() => setVpnSelectedProfile(undefined));
    void PcControl.getOpenVpnPermissionStatus()
      .then((result) => {
        setVpnInstalled(result.installed);
        setVpnPermission(result.granted ? 'ok' : 'error');
      })
      .catch(() => {
        setVpnPermission('error');
      });
    void PcControl.getOpenVpnStatus()
      .then(setVpnStatus)
      .catch(() => setVpnStatus((current) => ({ ...current, status: 'error' })));
    if (!config.pc.host) return;
    void PcControl.getPcStatus({
      host: config.pc.host,
      port: config.pc.sshPort,
      timeoutMs: 2500,
      ...(config.router.host
        ? { routerHost: config.router.host, routerPort: config.router.sshPort }
        : {}),
    })
      .then((result) => {
        setPcStatus(result.status);
        if (result.status === 'offline' && result.reason !== 'network-unavailable') {
          setPcCheck('offline');
        }
      })
      .catch(() => setPcStatus('unknown'));
  }, [config.pc.host, config.pc.sshPort, config.router.host, config.router.sshPort]);

  async function checkPc(
    notify = true,
    onNetworkEnsured?: NetworkEnsuredHandler,
  ): Promise<QuickDiagnosticStatus> {
    if (!config.pc.host || !config.pc.sshUser || !Number.isInteger(config.pc.sshPort)) {
      return 'attention';
    }
    setPcCheck('checking');
    try {
      if (ensureNetwork) {
        const network = await ensureNetwork();
        onNetworkEnsured?.(network.vpnWasStartedByApp);
      }
      const reachable = await PcControl.checkHost({
        host: config.pc.host,
        port: config.pc.sshPort,
        timeoutMs: 5000,
      });
      if (!reachable.reachable) {
        setPcStatus('offline');
        setPcCheck('offline');
        if (notify) onToast(copy('diagnostics.connection.pcOfflinePending'));
        return 'attention';
      }
      setPcStatus('online');
      const trusted = await PcControl.getTrustedSshHostKey({
        host: config.pc.host,
        port: config.pc.sshPort,
      });
      if (!trusted.trusted || !trusted.fingerprint) {
        setPcCheck('host-key-unverified');
        if (notify) onToast(copy('diagnostics.connection.hostKeyPending'));
        return 'attention';
      }
      try {
        await PcControl.executeSshCommand({
          host: config.pc.host,
          port: config.pc.sshPort,
          target: 'windows',
          username: config.pc.sshUser,
          command: 'hostname',
          expectedHostFingerprint: trusted.fingerprint,
          connectTimeoutMs: 5000,
          commandTimeoutMs: 5000,
        });
      } catch (error) {
        if (isPcUnavailableError(error)) {
          setPcStatus('offline');
          setPcCheck('offline');
          if (notify) onToast(copy('diagnostics.connection.pcOfflinePending'));
          return 'attention';
        }
        if (isSshAuthError(error)) {
          setPcCheck('auth-failed');
          const described = describeError(error);
          if (notify) onToast(copy(described.key, described.params));
          return 'attention';
        }
        throw error;
      }
      setPcCheck('verified');
      if (notify) onToast(copy('diagnostics.connection.success'));
      return 'passed';
    } catch (error) {
      if (isPcUnavailableError(error)) {
        setPcStatus('offline');
        setPcCheck('offline');
        if (notify) onToast(copy('diagnostics.connection.pcOfflinePending'));
      } else {
        setPcCheck('error');
        const described = describeError(error);
        if (notify) onToast(copy(described.key, described.params));
      }
      return 'attention';
    }
  }

  async function checkRouter(
    notify = true,
    onNetworkEnsured?: NetworkEnsuredHandler,
  ): Promise<QuickDiagnosticStatus> {
    if (!config.router.host || !Number.isInteger(config.router.sshPort)) return 'attention';
    setRouterCheck('checking');
    try {
      if (ensureNetwork) {
        const network = await ensureNetwork();
        onNetworkEnsured?.(network.vpnWasStartedByApp);
      } else {
        const result = await PcControl.checkHost({
          host: config.router.host,
          port: config.router.sshPort,
          timeoutMs: 5000,
        });
        if (!result.reachable) throw { code: 'HOST_UNREACHABLE' };
      }
      setRouterCheck('ok');
      if (notify) onToast(copy('diagnostics.wake.routerSuccess'));
      return 'passed';
    } catch (error) {
      setRouterCheck('error');
      const described = describeError(error);
      if (notify) onToast(copy(described.key, described.params));
      return 'attention';
    }
  }

  async function checkRouterLogin(
    notify = true,
    onNetworkEnsured?: NetworkEnsuredHandler,
  ): Promise<QuickDiagnosticStatus> {
    if (!config.router.host || !config.router.sshUser || !Number.isInteger(config.router.sshPort)) {
      return 'attention';
    }
    setRouterLoginCheck('checking');
    try {
      if (ensureNetwork) {
        const network = await ensureNetwork();
        onNetworkEnsured?.(network.vpnWasStartedByApp);
      }
      const trusted = await PcControl.getTrustedSshHostKey({
        host: config.router.host,
        port: config.router.sshPort,
      });
      if (!trusted.trusted || !trusted.fingerprint) {
        setRouterLoginCheck('pending');
        if (notify) onToast(copy('diagnostics.connection.hostKeyPending'));
        return 'attention';
      }
      await PcControl.executeSshCommand({
        host: config.router.host,
        port: config.router.sshPort,
        target: 'router',
        username: config.router.sshUser,
        command: 'uname -a',
        expectedHostFingerprint: trusted.fingerprint,
        connectTimeoutMs: 5000,
        commandTimeoutMs: 5000,
      });
      setRouterLoginCheck('ok');
      if (notify) onToast(copy('diagnostics.wake.routerLoginSuccess'));
      return 'passed';
    } catch (error) {
      if (isPcUnavailableError(error)) {
        setRouterLoginCheck('pending');
      } else if (isSshAuthError(error)) {
        setRouterLoginCheck('auth-failed');
      } else {
        setRouterLoginCheck('error');
      }
      const described = describeError(error);
      if (notify) onToast(copy(described.key, described.params));
      return 'attention';
    }
  }

  function checkSettings(): QuickDiagnosticStatus {
    return isPcConnectionConfigured(settings) &&
      isPowerOnConfigured(settings) &&
      validateAppSettings(settings).length === 0
      ? 'passed'
      : 'attention';
  }

  async function checkIdentity(): Promise<QuickDiagnosticStatus> {
    try {
      const result = await PcControl.getSshIdentity();
      return result.available ? 'passed' : 'attention';
    } catch {
      return 'attention';
    }
  }

  async function checkRemotePrerequisites(): Promise<QuickDiagnosticStatus> {
    try {
      const installation = await PcControl.isOpenVpnInstalled();
      setVpnInstalled(installation.installed);
      if (!installation.installed) {
        setVpnSelectedProfile(undefined);
        setVpnPermission('error');
        return 'attention';
      }

      const [profiles, permission, status] = await Promise.all([
        PcControl.getOpenVpnProfiles(),
        PcControl.getOpenVpnPermissionStatus(),
        PcControl.getOpenVpnStatus(),
      ]);
      setVpnSelectedProfile(profiles.selectedProfileId);
      setVpnPermission(permission.granted ? 'ok' : 'error');
      setVpnStatus(status);
      const selectedProfile = profiles.profiles.some(
        (profile) => profile.id === profiles.selectedProfileId,
      );
      const vpnReady = status.status === 'connected' || status.status === 'disconnected';
      return permission.granted && selectedProfile && vpnReady ? 'passed' : 'attention';
    } catch {
      setVpnPermission('error');
      return 'attention';
    }
  }

  async function runQuickDiagnostics() {
    if (quickDiagnosticRunning || quickDiagnosticRunningRef.current) return;
    let nextSteps = createQuickDiagnosticSteps();
    setQuickDiagnosticSteps(nextSteps);
    setQuickDiagnosticCleanupFailed(false);
    quickDiagnosticRunningRef.current = true;
    setQuickDiagnosticRunning(true);
    let vpnStartedByQuickDiagnostic = false;
    const observeNetwork = (vpnWasStartedByApp: boolean) => {
      vpnStartedByQuickDiagnostic ||= vpnWasStartedByApp;
    };

    const runStep = async (
      id: QuickDiagnosticStepId,
      check: () => QuickDiagnosticStatus | Promise<QuickDiagnosticStatus>,
    ) => {
      const stepStartedAt = Date.now();
      setQuickDiagnosticActiveStep(id);
      nextSteps = nextSteps.map((step) =>
        step.id === id ? { ...step, status: 'checking' } : step,
      );
      setQuickDiagnosticSteps(nextSteps);
      let status: QuickDiagnosticStatus;
      try {
        status = await check();
      } catch {
        status = 'attention';
      }
      const remainingDuration =
        MIN_QUICK_DIAGNOSTIC_STEP_DURATION_MS - (Date.now() - stepStartedAt);
      if (remainingDuration > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, remainingDuration);
        });
      }
      nextSteps = nextSteps.map((step) => (step.id === id ? { ...step, status } : step));
      setQuickDiagnosticSteps(nextSteps);
      return status;
    };

    try {
      await runStep('settings', () => checkSettings());
      await runStep('identity', checkIdentity);
      await runStep('pc', () => checkPc(false, observeNetwork));
      await runStep('wake', async () => {
        const routerReachability = await checkRouter(false, observeNetwork);
        if (routerReachability !== 'passed') return routerReachability;
        return checkRouterLogin(false, observeNetwork);
      });
      await runStep('remote', checkRemotePrerequisites);
    } finally {
      let cleanupFailed = false;
      if (vpnStartedByQuickDiagnostic) {
        try {
          const result = await PcControl.disconnectOpenVpn({
            onlyIfStartedByApp: true,
            timeoutMs: 10000,
          });
          setVpnStatus(result);
          cleanupFailed = result.status === 'error';
        } catch {
          setVpnStatus((current) => ({ ...current, status: 'error' }));
          cleanupFailed = true;
        }
      }
      quickDiagnosticRunningRef.current = false;
      setQuickDiagnosticCleanupFailed(cleanupFailed);
      setQuickDiagnosticActiveStep(undefined);
      setQuickDiagnosticRunning(false);
    }
  }

  function renderPage(page: DiagnosticsPage) {
    if (page === 'overview') {
      return (
        <div className="diagnostics-overview diagnostics-screen-page preferences-page">
          <PreferenceToolbar
            title={copy('diagnostics.title')}
            backLabel={t('navigation.back')}
            onBack={onBack}
          />
          <div className="preferences-list">
            <div className="preferences-group">
              <PreferenceRow
                icon="connections"
                title={copy('diagnostics.overview.connectionTitle')}
                summary={copy('diagnostics.overview.connectionDescription')}
                disabled={quickDiagnosticRunning}
                onClick={() => setPage('connection')}
              />
              <PreferenceRow
                icon="multi-devices"
                title={copy('diagnostics.overview.wakeTitle')}
                summary={copy('diagnostics.overview.wakeDescription')}
                disabled={quickDiagnosticRunning}
                onClick={() => setPage('wake')}
              />
              <PreferenceRow
                icon="security"
                title={copy('diagnostics.overview.remoteTitle')}
                summary={copy('diagnostics.overview.remoteDescription')}
                disabled={quickDiagnosticRunning}
                onClick={() => setPage('remote')}
              />
              <PreferenceRow
                icon="modes"
                title={copy('diagnostics.quickCheck.title')}
                summary={copy('diagnostics.quickCheck.description')}
                onClick={() => setPage('quickCheck')}
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className="diagnostics-detail-page diagnostics-screen-page preferences-page"
        data-diagnostics-page={page}
      >
        <PreferenceToolbar
          title={
            page === 'quickCheck'
              ? copy('diagnostics.quickCheck.title')
              : copy(`diagnostics.${page}.title`)
          }
          backLabel={t('navigation.backToDiagnostics')}
          onBack={goBack}
        />
        {page === 'connection' && (
          <PreferenceSection className="diagnostics-section">
            <PreferenceStatusRow
              label={copy('diagnostics.labels.pcConnection')}
              description={pcStatusSummary(pcStatus, copy)}
              descriptionTone={pcStatusTone(pcStatus)}
            />
            <PreferenceActionRow
              label={copy('diagnostics.connection.loginTitle')}
              description={pcCheckLabel(pcCheck, copy)}
              descriptionTone={pcCheckTone(pcCheck)}
              disabled={quickDiagnosticRunning || !config.pc.host || pcCheck === 'checking'}
              onClick={() => void checkPc()}
            />
            <HostKeyRow
              variant="summary"
              host={config.pc.host}
              port={config.pc.sshPort}
              kind="pc"
              {...(ensureNetwork ? { ensureNetwork } : {})}
              disabled={quickDiagnosticRunning}
              onOpenPage={() => setPage('pcTrust')}
              onToast={onToast}
            />
          </PreferenceSection>
        )}

        {page === 'wake' && (
          <PreferenceSection className="diagnostics-section">
            <PreferenceActionRow
              label={copy('diagnostics.labels.routerConnection')}
              description={routerCheckSummary(config.router.host, routerCheck, copy)}
              descriptionTone={config.router.host ? checkTone(routerCheck) : 'warning'}
              disabled={quickDiagnosticRunning || !config.router.host || routerCheck === 'checking'}
              onClick={() => void checkRouter()}
            />
            <PreferenceActionRow
              label={copy('diagnostics.labels.routerLogin')}
              description={routerLoginLabel(routerLoginCheck, copy)}
              descriptionTone={routerLoginTone(routerLoginCheck)}
              disabled={
                quickDiagnosticRunning ||
                !config.router.host ||
                !config.router.sshUser ||
                routerLoginCheck === 'checking'
              }
              onClick={() => void checkRouterLogin()}
            />
            <HostKeyRow
              variant="summary"
              host={config.router.host}
              port={config.router.sshPort}
              kind="router"
              {...(ensureNetwork ? { ensureNetwork } : {})}
              disabled={quickDiagnosticRunning}
              onOpenPage={() => setPage('routerTrust')}
              onToast={onToast}
            />
          </PreferenceSection>
        )}

        {page === 'pcTrust' && (
          <HostKeyRow
            variant="page"
            host={config.pc.host}
            port={config.pc.sshPort}
            kind="pc"
            {...(ensureNetwork ? { ensureNetwork } : {})}
            onToast={onToast}
          />
        )}

        {page === 'routerTrust' && (
          <HostKeyRow
            variant="page"
            host={config.router.host}
            port={config.router.sshPort}
            kind="router"
            {...(ensureNetwork ? { ensureNetwork } : {})}
            onToast={onToast}
          />
        )}

        {page === 'remote' && (
          <PreferenceSection className="diagnostics-section">
            <PreferenceStatusRow
              label={copy('diagnostics.labels.vpnApp')}
              description={vpnInstalledLabel(vpnInstalled, copy)}
              descriptionTone={vpnInstalledTone(vpnInstalled)}
            />
            <PreferenceStatusRow
              label={copy('diagnostics.labels.vpnProfile')}
              description={vpnProfileLabel(vpnInstalled, vpnSelectedProfile, copy)}
              descriptionTone={vpnProfileTone(vpnInstalled, vpnSelectedProfile)}
            />
            <PreferenceStatusRow
              label={copy('diagnostics.labels.vpnPermission')}
              description={vpnPermissionSummary(vpnInstalled, vpnPermission, copy)}
              descriptionTone={vpnInstalled === false ? 'neutral' : checkTone(vpnPermission)}
            />
            <PreferenceStatusRow
              label={copy('diagnostics.labels.vpnConnection')}
              description={vpnStatusLabel(vpnStatus.status, copy)}
              descriptionTone={vpnStatusTone(vpnStatus.status)}
            />
          </PreferenceSection>
        )}

        {page === 'quickCheck' && (
          <QuickDiagnosticsCard
            steps={quickDiagnosticSteps}
            running={quickDiagnosticRunning}
            cleanupFailed={quickDiagnosticCleanupFailed}
            {...(quickDiagnosticActiveStep ? { activeStep: quickDiagnosticActiveStep } : {})}
            onRun={() => void runQuickDiagnostics()}
          />
        )}
      </div>
    );
  }
  return <PageStack navigation={navigation}>{renderPage}</PageStack>;
}

function QuickDiagnosticsCard({
  steps,
  running,
  activeStep,
  cleanupFailed,
  onRun,
}: {
  steps: QuickDiagnosticStep[];
  running: boolean;
  activeStep?: QuickDiagnosticStepId;
  cleanupFailed: boolean;
  onRun: () => void;
}) {
  const { copy } = useAppCopy();
  const hasResults = steps.some((step) => step.status !== 'idle');
  const passed = steps.filter((step) => step.status === 'passed').length;
  const attentionCount =
    steps.filter((step) => step.status === 'attention').length + (cleanupFailed ? 1 : 0);
  const total = steps.length;
  const heroState = running
    ? 'running'
    : !hasResults
      ? 'ready'
      : attentionCount > 0
        ? 'attention'
        : 'passed';
  const heroTitle = copy(
    `diagnostics.quickCheck.hero.${heroState}`,
    heroState === 'attention' ? { count: attentionCount } : undefined,
  );
  const heroDetail = running
    ? copy('diagnostics.quickCheck.hero.progress', {
        step: activeStep
          ? copy(`diagnostics.quickCheck.steps.${activeStep}`)
          : copy('diagnostics.quickCheck.running'),
      })
    : heroState === 'ready'
      ? copy('diagnostics.quickCheck.hero.planned', { total })
      : heroState === 'passed'
        ? copy('diagnostics.quickCheck.success', { passed, total })
        : copy('diagnostics.quickCheck.hero.attention', { count: attentionCount });
  return (
    <section
      className={`diagnostics-quick-check-card diagnostics-quick-check-state-${heroState}`}
      aria-label={copy('diagnostics.quickCheck.title')}
    >
      <div className="diagnostics-quick-check-hero" role="status" aria-live="polite">
        <div className="diagnostics-quick-check-orbit" aria-hidden="true">
          <span className="diagnostics-quick-check-orbit-ring diagnostics-quick-check-orbit-ring-outer" />
          <span className="diagnostics-quick-check-orbit-ring diagnostics-quick-check-orbit-ring-inner" />
          <span className="diagnostics-quick-check-orbit-core">
            {heroState === 'running' ? (
              <LoaderCircle className="diagnostics-quick-check-loading-icon" size={38} />
            ) : heroState === 'passed' ? (
              <CircleCheck size={38} />
            ) : heroState === 'attention' ? (
              <AlertTriangle size={38} />
            ) : (
              <WandSparkles size={38} />
            )}
          </span>
        </div>
        <h2 className="diagnostics-quick-check-hero-title">{heroTitle}</h2>
        <p className="diagnostics-quick-check-hero-detail">{heroDetail}</p>
      </div>
      <button
        type="button"
        className="oneui-button oneui-button--filled oneui-button--wide diagnostics-quick-check-button"
        disabled={running}
        onClick={onRun}
      >
        {running
          ? copy('diagnostics.quickCheck.running')
          : hasResults
            ? copy('diagnostics.quickCheck.rerun')
            : copy('diagnostics.quickCheck.run')}
      </button>
      <div className="diagnostics-quick-check-panel">
        <div
          className="preferences-group"
          role="list"
          aria-label={copy('diagnostics.quickCheck.items')}
        >
          {steps.map((step) => {
            const StepIcon = QUICK_DIAGNOSTIC_STEP_ICONS[step.id];
            const stepLabel = copy(`diagnostics.quickCheck.steps.${step.id}`);
            const stepStatusLabel = quickDiagnosticSummary(step.status, copy);
            return (
              <div
                className={`preferences-row diagnostics-quick-check-row-${step.id} diagnostics-quick-check-row-${step.status}`}
                key={step.id}
                role="listitem"
                aria-label={`${stepLabel}: ${stepStatusLabel}`}
              >
                <span className="preferences-icon-frame">
                  <span className="preferences-icon diagnostics-quick-check-step-icon">
                    <StepIcon
                      className="diagnostics-quick-check-step-glyph"
                      size={16}
                      strokeWidth={2.1}
                      aria-hidden="true"
                    />
                  </span>
                </span>
                <span className="preferences-copy">
                  <b className="preferences-title">{stepLabel}</b>
                  <small
                    className={`preferences-summary preference-row-description--${quickDiagnosticTone(
                      step.status,
                    )}`}
                  >
                    {stepStatusLabel}
                  </small>
                </span>
                <span className="preferences-divider" aria-hidden="true" />
              </div>
            );
          })}
          {cleanupFailed && (
            <div className="preferences-row diagnostics-quick-check-row-attention" role="listitem">
              <span className="preferences-icon-frame">
                <span className="preferences-icon diagnostics-quick-check-step-icon">
                  <Wifi
                    className="diagnostics-quick-check-step-glyph"
                    size={16}
                    strokeWidth={2.1}
                    aria-hidden="true"
                  />
                </span>
              </span>
              <span className="preferences-copy">
                <b className="preferences-title">{copy('diagnostics.quickCheck.steps.cleanup')}</b>
                <small className="preferences-summary preference-row-description--warning">
                  {copy('diagnostics.statusSummary.attention')}
                </small>
              </span>
              <span className="preferences-divider" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function checkTone(check: Check): SummaryTone {
  return check === 'ok' ? 'success' : check === 'error' ? 'danger' : 'neutral';
}

function routerCheckSummary(host: string, check: Check, copy: (key: string) => string) {
  if (!host) return copy('diagnostics.statusSummary.unavailable');
  return check === 'checking'
    ? copy('diagnostics.statusSummary.checking')
    : check === 'ok'
      ? copy('diagnostics.statusSummary.routerConnected')
      : check === 'error'
        ? copy('diagnostics.statusSummary.routerUnavailable')
        : copy('diagnostics.statusSummary.notChecked');
}

function vpnPermissionSummary(
  installed: boolean | undefined,
  permission: Check,
  copy: (key: string) => string,
) {
  if (installed === false) return copy('diagnostics.statusSummary.unavailable');
  return permission === 'checking'
    ? copy('diagnostics.statusSummary.checking')
    : permission === 'ok'
      ? copy('diagnostics.statusSummary.permissionGranted')
      : permission === 'error'
        ? copy('diagnostics.statusSummary.permissionRequired')
        : copy('diagnostics.statusSummary.notChecked');
}

function routerLoginLabel(check: RouterLoginCheck, copy: (key: string) => string) {
  return check === 'checking'
    ? copy('diagnostics.statusSummary.checking')
    : check === 'ok'
      ? copy('diagnostics.statusSummary.routerLoginSucceeded')
      : check === 'auth-failed'
        ? copy('diagnostics.statusSummary.routerLoginFailed')
        : check === 'pending'
          ? copy('diagnostics.statusSummary.securityPending')
          : check === 'error'
            ? copy('diagnostics.statusSummary.routerLoginFailed')
            : copy('diagnostics.statusSummary.notChecked');
}

function routerLoginTone(check: RouterLoginCheck): SummaryTone {
  return check === 'ok'
    ? 'success'
    : check === 'checking'
      ? 'neutral'
      : check === 'pending'
        ? 'warning'
        : check === 'auth-failed' || check === 'error'
          ? 'danger'
          : 'neutral';
}

function pcStatusTone(status: PcStatus): SummaryTone {
  return status === 'online'
    ? 'success'
    : status === 'offline'
      ? 'warning'
      : status === 'error'
        ? 'danger'
        : status === 'waking' || status === 'shutting-down' || status === 'rebooting'
          ? 'neutral'
          : 'neutral';
}

function pcStatusSummary(status: PcStatus, copy: (key: string) => string) {
  return status === 'online'
    ? copy('diagnostics.statusSummary.pcConnected')
    : status === 'offline' || status === 'error'
      ? copy('diagnostics.statusSummary.pcUnavailable')
      : status === 'waking' || status === 'shutting-down' || status === 'rebooting'
        ? copy('diagnostics.statusSummary.checking')
        : copy('diagnostics.statusSummary.notChecked');
}

function pcCheckLabel(check: PcCheck, copy: (key: string) => string) {
  return check === 'checking'
    ? copy('diagnostics.statusSummary.checking')
    : check === 'verified'
      ? copy('diagnostics.statusSummary.pcLoginSucceeded')
      : check === 'offline'
        ? copy('diagnostics.statusSummary.pcUnavailable')
        : check === 'host-key-unverified'
          ? copy('diagnostics.statusSummary.securityPending')
          : check === 'auth-failed'
            ? copy('diagnostics.statusSummary.pcLoginFailed')
            : check === 'error'
              ? copy('diagnostics.statusSummary.pcLoginFailed')
              : copy('diagnostics.statusSummary.notChecked');
}

function pcCheckTone(check: PcCheck): SummaryTone {
  return check === 'verified'
    ? 'success'
    : check === 'checking'
      ? 'neutral'
      : check === 'offline' || check === 'host-key-unverified'
        ? 'warning'
        : check === 'auth-failed' || check === 'error'
          ? 'danger'
          : 'neutral';
}

function quickDiagnosticTone(status: QuickDiagnosticStatus): SummaryTone {
  return status === 'passed'
    ? 'success'
    : status === 'attention'
      ? 'warning'
      : status === 'checking'
        ? 'neutral'
        : 'neutral';
}

function quickDiagnosticSummary(status: QuickDiagnosticStatus, copy: (key: string) => string) {
  return status === 'passed'
    ? copy('diagnostics.statusSummary.passed')
    : status === 'attention'
      ? copy('diagnostics.statusSummary.attention')
      : status === 'checking'
        ? copy('diagnostics.statusSummary.checking')
        : copy('diagnostics.statusSummary.notChecked');
}

function vpnInstalledLabel(installed: boolean | undefined, copy: (key: string) => string) {
  return installed === undefined
    ? copy('diagnostics.statusSummary.checking')
    : installed
      ? copy('diagnostics.statusSummary.appInstalled')
      : copy('diagnostics.statusSummary.appRequired');
}

function vpnInstalledTone(installed: boolean | undefined): SummaryTone {
  return installed === undefined ? 'neutral' : installed ? 'success' : 'warning';
}

function vpnProfileLabel(
  installed: boolean | undefined,
  selectedProfile: string | undefined,
  copy: (key: string) => string,
) {
  return installed === false
    ? copy('diagnostics.statusSummary.unavailable')
    : selectedProfile
      ? copy('diagnostics.statusSummary.profileSelected')
      : copy('diagnostics.statusSummary.profileRequired');
}

function vpnProfileTone(
  installed: boolean | undefined,
  selectedProfile: string | undefined,
): SummaryTone {
  return installed === false ? 'neutral' : selectedProfile ? 'success' : 'warning';
}

function vpnStatusLabel(status: OpenVpnStatusResult['status'], copy: (key: string) => string) {
  return status === 'connected'
    ? copy('diagnostics.statusSummary.vpnConnected')
    : status === 'connecting'
      ? copy('diagnostics.statusSummary.checking')
      : status === 'disconnecting'
        ? copy('diagnostics.statusSummary.checking')
        : copy('diagnostics.statusSummary.vpnDisconnected');
}

function vpnStatusTone(status: OpenVpnStatusResult['status']): SummaryTone {
  return status === 'connected'
    ? 'success'
    : status === 'connecting' || status === 'disconnecting'
      ? 'neutral'
      : 'danger';
}

function hostKeyCheckSummary(
  host: string,
  key: { fingerprint?: string; trusted: boolean } | undefined,
  scanState: HostKeyScanState,
  copy: (key: string) => string,
) {
  return !host
    ? copy('diagnostics.statusSummary.unavailable')
    : key?.trusted
      ? copy('diagnostics.security.securityInfoChecked')
      : scanState === 'checking'
        ? copy('diagnostics.security.checkingSecurityInfo')
        : scanState === 'pending'
          ? copy('diagnostics.statusSummary.securityPending')
          : scanState === 'error'
            ? copy('diagnostics.security.securityInfoUnavailable')
            : key?.fingerprint
              ? copy('diagnostics.security.securityInfoChecked')
              : copy('diagnostics.security.securityInfoNotChecked');
}

function hostKeyTrustSummary(
  host: string,
  key: { fingerprint?: string; trusted: boolean } | undefined,
  scanState: HostKeyScanState,
  kind: 'pc' | 'router',
  copy: (key: string) => string,
) {
  return !host
    ? copy('diagnostics.statusSummary.unavailable')
    : key?.trusted
      ? kind === 'pc'
        ? copy('diagnostics.security.pcTrusted')
        : copy('diagnostics.security.routerTrusted')
      : scanState === 'error'
        ? copy('diagnostics.security.securityInfoUnavailable')
        : scanState === 'pending'
          ? copy('diagnostics.statusSummary.securityPending')
          : key?.fingerprint
            ? copy('diagnostics.security.readyToTrust')
            : copy('diagnostics.security.checkSecurityInfoFirst');
}

function hostKeyTone(
  host: string,
  key: { fingerprint?: string; trusted: boolean } | undefined,
  scanState: HostKeyScanState,
): SummaryTone {
  return !host || scanState === 'checking'
    ? 'neutral'
    : key?.trusted
      ? 'success'
      : scanState === 'error'
        ? 'danger'
        : scanState === 'pending' || key?.fingerprint
          ? 'warning'
          : 'neutral';
}

function HostKeyRow({
  variant,
  host,
  port,
  kind,
  disabled = false,
  ensureNetwork,
  onOpenPage,
  onToast,
}: {
  variant: 'summary' | 'page';
  host: string;
  port: number;
  kind: 'pc' | 'router';
  disabled?: boolean;
  ensureNetwork?: () => Promise<unknown>;
  onOpenPage?: () => void;
  onToast: (message: string) => void;
}) {
  const { copy } = useAppCopy();
  const cacheKey = `${kind}:${host}:${port}`;
  const cachedState = hostKeyStateCache.get(cacheKey);
  const [key, setKey] = useState<
    | {
        algorithm?: string;
        fingerprint?: string;
        trusted: boolean;
      }
    | undefined
  >(() => cachedState?.key);
  const keyRef = useRef<typeof key>(undefined);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);
  const [busy, setBusy] = useState(false);
  const [scanState, setScanState] = useState<HostKeyScanState>(
    () => cachedState?.scanState ?? 'idle',
  );
  useEffect(() => {
    hostKeyStateCache.set(cacheKey, { key, scanState });
  }, [cacheKey, key, scanState]);
  useEffect(() => {
    if (!host) return;
    void PcControl.getTrustedSshHostKey({ host, port })
      .then(setKey)
      .catch(() => setKey({ trusted: false }));
  }, [host, port]);

  async function scan(): Promise<SshHostKeyResult | undefined> {
    setBusy(true);
    setScanState('checking');
    try {
      if (ensureNetwork) await ensureNetwork();
      if (kind === 'pc') {
        const reachable = await PcControl.checkHost({ host, port, timeoutMs: 5000 });
        if (!reachable.reachable) {
          setScanState('pending');
          onToast(copy('diagnostics.connection.pcOfflinePending'));
          return undefined;
        }
      }
      const previousFingerprint = keyRef.current?.fingerprint;
      const result = await PcControl.scanSshHostKey({ host, port, connectTimeoutMs: 5000 });
      setKey(result);
      setScanState('idle');
      if (previousFingerprint) {
        onToast(
          copy(
            previousFingerprint === result.fingerprint
              ? 'diagnostics.security.securityInfoRefreshUnchanged'
              : 'diagnostics.security.securityInfoRefreshChanged',
          ),
        );
      }
      return result;
    } catch (error) {
      if (kind === 'pc' && isPcUnavailableError(error)) {
        setScanState('pending');
        onToast(copy('diagnostics.connection.pcOfflinePending'));
      } else {
        setScanState('error');
        const described = describeError(error);
        onToast(copy(described.key, described.params));
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function trust() {
    if (!key?.algorithm || !key.fingerprint) return;
    setBusy(true);
    try {
      setKey(
        await PcControl.trustSshHostKey({
          host,
          port,
          algorithm: key.algorithm,
          fingerprint: key.fingerprint,
        }),
      );
      setScanState('idle');
    } catch (error) {
      setScanState('error');
      const described = describeError(error);
      onToast(copy(described.key, described.params));
    } finally {
      setBusy(false);
    }
  }
  const trustLabel =
    kind === 'pc'
      ? copy('diagnostics.security.hostTrust')
      : copy('diagnostics.security.routerTrust');

  if (variant === 'summary') {
    return (
      <PreferenceActionRow
        label={trustLabel}
        description={hostKeyTrustSummary(host, key, scanState, kind, copy)}
        descriptionTone={hostKeyTone(host, key, scanState)}
        disabled={disabled || !host}
        onClick={() => onOpenPage?.()}
      />
    );
  }

  return (
    <PreferenceSection className="diagnostics-section">
      <div className="diagnostics-host-key-target">
        <p className="diagnostics-host-key-detail-label">
          {copy('diagnostics.labels.connectionTarget')}
        </p>
        <p className="diagnostics-host-key-detail-value diagnostics-host-key-target-value">
          {host ? `${host}:${port}` : copy('diagnostics.statusSummary.unavailable')}
        </p>
      </div>
      <PreferenceActionRow
        label={copy('diagnostics.labels.securityCheck')}
        description={
          busy
            ? copy('diagnostics.security.checkingSecurityInfo')
            : hostKeyCheckSummary(host, key, scanState, copy)
        }
        descriptionTone={busy ? 'neutral' : hostKeyTone(host, key, scanState)}
        disabled={!host || busy}
        onClick={() => void scan()}
      />
      <PreferenceActionRow
        label={
          kind === 'pc'
            ? copy('diagnostics.security.trustPc')
            : copy('diagnostics.security.trustRouter')
        }
        description={hostKeyTrustSummary(host, key, scanState, kind, copy)}
        descriptionTone={hostKeyTone(host, key, scanState)}
        disabled={busy || !key?.fingerprint || key.trusted}
        onClick={() => void trust()}
      />
    </PreferenceSection>
  );
}
