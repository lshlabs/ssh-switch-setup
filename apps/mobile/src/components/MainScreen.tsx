/* eslint-disable react-hooks/set-state-in-effect -- status sync from native */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { History, Power, PowerOff, RotateCcw, Settings2, ShieldCheck } from 'lucide-react';
import { PcControl } from '@pc-control/capacitor-pc-control';
import type {
  AppSettings,
  NetworkState,
  PcControlConfig,
  PcStatus,
  PowerAction,
  VpnStatus,
} from '@pc-control/core';
import { isPcConnectionConfigured, isPowerOnConfigured } from '@pc-control/core';
import { HomeStatusCard } from './HomeStatusCard';
import { Button } from './ui/button';
import { PreferenceDialog } from './ui/preference-dialog';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import type { HomeSession, HomeStatusSnapshot } from '../hooks/useHomeSession';
import { describeError } from '../lib/errorMapping';
import { useAppCopy } from '../i18n';

type BusyState = PowerAction | 'status' | undefined;
type VpnAction = 'connect' | 'disconnect' | undefined;
type BackHandler = () => boolean;
type StatusRefreshResult = {
  networkPath: NetworkState;
  pcStatus: PcStatus;
  vpnStatus: VpnStatus;
};
type ConnectionSnapshot = Pick<StatusRefreshResult, 'networkPath' | 'pcStatus' | 'vpnStatus'> & {
  pcReachable: boolean | undefined;
  networkSsid: string | undefined;
};

const MIN_FEEDBACK_MS = 650;
const VPN_STATUS_REFRESH_WAIT_MS = 10_000;
const PC_HOSTNAME_STORAGE_PREFIX = 'pc-control.pc-hostname.v1';
const DEFAULT_PC_NAME = '내 PC';

function waitForMinimum(startedAt: number) {
  const remaining = MIN_FEEDBACK_MS - (Date.now() - startedAt);
  return remaining > 0
    ? new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
    : Promise.resolve();
}

function hasConnectionSessionChanged(previous: ConnectionSnapshot, next: ConnectionSnapshot) {
  return (
    previous.pcStatus !== next.pcStatus ||
    previous.pcReachable !== next.pcReachable ||
    previous.networkPath !== next.networkPath ||
    previous.networkSsid !== next.networkSsid ||
    previous.vpnStatus !== next.vpnStatus
  );
}

export function MainScreen({
  config,
  settings,
  onSave,
  refreshIntervalSec,
  autoDisconnect,
  session,
  onOpenSettings,
  onOpenHistory,
  onToast,
  registerBack,
}: {
  config: PcControlConfig;
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<void>;
  refreshIntervalSec: number;
  autoDisconnect: boolean;
  session: HomeSession;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onToast: (message: string) => void;
  registerBack: (handler: BackHandler | null) => void;
}) {
  const { t, copy, locale } = useAppCopy();
  const [pcStatus, setPcStatus] = useState<PcStatus>(
    () => session.statusSnapshot?.pcStatus ?? 'unknown',
  );
  const [pcLatency, setPcLatency] = useState<number | undefined>(
    () => session.statusSnapshot?.pcLatency,
  );
  const [pcReachable, setPcReachable] = useState<boolean | undefined>(
    () => session.statusSnapshot?.pcReachable,
  );
  const [pcHostname, setPcHostname] = useState<string | undefined>(
    () => session.statusSnapshot?.pcHostname ?? readStoredPcHostname(config.pc.host),
  );
  const [networkPath, setNetworkPath] = useState<NetworkState>(
    () => session.statusSnapshot?.networkPath ?? 'unknown',
  );
  const [networkSsid, setNetworkSsid] = useState<string | undefined>(
    () => session.statusSnapshot?.networkSsid,
  );
  const [vpnStatus, setVpnStatus] = useState<VpnStatus>(
    () => session.statusSnapshot?.vpnStatus ?? 'disconnected',
  );
  const [vpnAction, setVpnAction] = useState<VpnAction>();
  const [busy, setBusy] = useState<BusyState>();
  const [pcHostKey, setPcHostKey] = useState<string | undefined>(
    () => session.statusSnapshot?.pcHostKey,
  );
  const [routerHostKey, setRouterHostKey] = useState<string | undefined>(
    () => session.statusSnapshot?.routerHostKey,
  );
  const [showConfirm, setShowConfirm] = useState<PowerAction | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [actionStartedAt, setActionStartedAt] = useState<number>();
  const [actionElapsedSec, setActionElapsedSec] = useState(0);
  const [relativeNow, setRelativeNow] = useState(Date.now);
  const actionLockRef = useRef(false);
  const refreshLockRef = useRef(false);
  const latencyRefreshLockRef = useRef(false);
  const latencySessionRef = useRef(0);
  const statusRefreshGenerationRef = useRef(0);
  const connectionSnapshotRef = useRef<ConnectionSnapshot | undefined>(
    session.statusSnapshot
      ? {
          pcStatus: session.statusSnapshot.pcStatus,
          pcReachable: session.statusSnapshot.pcReachable,
          networkPath: session.statusSnapshot.networkPath,
          vpnStatus: session.statusSnapshot.vpnStatus,
          networkSsid: session.statusSnapshot.networkSsid,
        }
      : undefined,
  );
  const statusSnapshotRef = useRef(session.statusSnapshot);
  const pcHostnameRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const networkChangeRefreshTimerRef = useRef<number | undefined>(undefined);
  const ssidPermissionRequestedRef = useRef(false);
  const postActionRefreshTimerRef = useRef<number | undefined>(undefined);
  const errorSourceRef = useRef<'status' | 'action' | undefined>(undefined);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const dialogCloseRef = useRef<(() => void) | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameReturnFocusRef = useRef<HTMLElement | null>(null);
  const nameDialogCloseRef = useRef<(() => void) | null>(null);
  const refreshStatusRef = useRef<() => Promise<StatusRefreshResult | undefined>>(() =>
    Promise.resolve(undefined),
  );
  const isBusy = busy !== undefined;
  const isVpnBusy =
    vpnAction !== undefined || vpnStatus === 'connecting' || vpnStatus === 'disconnecting';
  const isAnyBusy = isBusy || isVpnBusy;
  const configured = isPcConnectionConfigured(settings);
  const powerOnAvailable = isPowerOnConfigured(settings);
  const actionAvailability: Record<PowerAction, boolean> = {
    'power-on': !isAnyBusy && powerOnAvailable && Boolean(routerHostKey),
    shutdown: !isAnyBusy && configured && Boolean(pcHostKey),
    reboot: !isAnyBusy && configured && Boolean(pcHostKey),
  };
  const configuredName = typeof settings.pcName === 'string' ? settings.pcName.trim() : '';
  const hasCustomName = Boolean(configuredName && configuredName !== DEFAULT_PC_NAME);
  const displayName = hasCustomName ? configuredName : (pcHostname ?? t('home.defaultPcName'));
  const {
    latencyHistory,
    lastOnlineAt,
    observeStatus,
    recordAction,
    resetLatencyHistory,
    hasUnreadActionHistory,
    markActionHistoryRead,
    updateStatusSnapshot,
  } = session;

  const resetLatencySession = useCallback(() => {
    latencySessionRef.current += 1;
    statusRefreshGenerationRef.current += 1;
    resetLatencyHistory();
  }, [resetLatencyHistory]);

  const syncConnectionSnapshot = useCallback(
    (next: ConnectionSnapshot) => {
      const previous = connectionSnapshotRef.current;
      connectionSnapshotRef.current = next;
      if (previous && hasConnectionSessionChanged(previous, next)) {
        resetLatencySession();
      }
    },
    [resetLatencySession],
  );

  useLayoutEffect(() => {
    resetLatencySession();
  }, [resetLatencySession]);

  const handleOpenHistory = useCallback(() => {
    markActionHistoryRead();
    onOpenHistory();
  }, [markActionHistoryRead, onOpenHistory]);

  useEffect(() => {
    registerBack(() => {
      if (showConfirm) {
        dialogCloseRef.current?.();
        return true;
      }
      if (showNameDialog) {
        nameDialogCloseRef.current?.();
        return true;
      }
      return false;
    });
    return () => registerBack(null);
  }, [registerBack, showConfirm, showNameDialog]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (postActionRefreshTimerRef.current !== undefined) {
        window.clearTimeout(postActionRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const storedHostname =
      readStoredPcHostname(config.pc.host) ?? statusSnapshotRef.current?.pcHostname;
    pcHostnameRef.current = storedHostname;
    setPcHostname(storedHostname);
  }, [config.pc.host]);

  useEffect(() => {
    if (!actionStartedAt || !busy || busy === 'status') return;
    const updateElapsed = () =>
      setActionElapsedSec(Math.floor((Date.now() - actionStartedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [actionStartedAt, busy]);

  useEffect(() => {
    if (!lastOnlineAt) return;
    setRelativeNow(Date.now());
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [lastOnlineAt]);

  const refreshStatus = useCallback(
    async (showFeedback = false): Promise<StatusRefreshResult | undefined> => {
      if (busyRef.current || refreshLockRef.current || !config.pc.host) return undefined;
      refreshLockRef.current = true;
      busyRef.current = true;
      const requestGeneration = statusRefreshGenerationRef.current;
      setBusy('status');
      const startedAt = Date.now();
      let refreshed = false;
      try {
        const [pc, net, vpn, pcKey, routerKey] = await Promise.all([
          PcControl.getPcStatus({
            host: config.pc.host,
            port: config.pc.sshPort,
            timeoutMs: 2500,
            ...(config.router.host
              ? { routerHost: config.router.host, routerPort: config.router.sshPort }
              : {}),
            routerTimeoutMs: 2000,
          }),
          config.router.host
            ? PcControl.getNetworkState({
                routerHost: config.router.host,
                routerPort: config.router.sshPort,
              }).catch(() => ({ state: 'unknown' as const }))
            : Promise.resolve({ state: 'unknown' as const }),
          PcControl.getOpenVpnStatus().catch(() => ({
            status: 'error' as const,
            vpnWasStartedByApp: false,
          })),
          PcControl.getTrustedSshHostKey({ host: config.pc.host, port: config.pc.sshPort }).catch(
            () => ({ trusted: false }),
          ),
          config.router.host
            ? PcControl.getTrustedSshHostKey({
                host: config.router.host,
                port: config.router.sshPort,
              }).catch(() => ({ trusted: false }))
            : Promise.resolve({ trusted: false }),
        ]);
        if (!mountedRef.current || requestGeneration !== statusRefreshGenerationRef.current) {
          return undefined;
        }
        if (pc.resolvedHost && pc.resolvedHost !== settings.pcHost) {
          await onSave({ ...settings, pcHost: pc.resolvedHost });
        }
        syncConnectionSnapshot({
          pcStatus: pc.status,
          pcReachable: pc.reachable,
          networkPath: net.state,
          vpnStatus: vpn.status,
          networkSsid: net.state === 'local' ? net.ssid : undefined,
        });
        setPcStatus(pc.status);
        setPcReachable(pc.reachable);
        setPcLatency(pc.latencyMs);
        setNetworkPath(net.state);
        setNetworkSsid(net.state === 'local' ? net.ssid : undefined);
        setVpnStatus(vpn.status);
        const pcHostKeyResult = (pc.resolvedHost && pc.resolvedHost !== config.pc.host
          ? await PcControl.getTrustedSshHostKey({ host: pc.resolvedHost, port: config.pc.sshPort })
          : pcKey) as { fingerprint?: string; trusted?: boolean };
        const routerHostKeyResult = routerKey as { fingerprint?: string };
        setPcHostKey(pcHostKeyResult.fingerprint);
        setRouterHostKey(routerHostKeyResult.fingerprint);
        const nextSnapshot: HomeStatusSnapshot = {
          pcStatus: pc.status,
          pcReachable: pc.reachable,
          networkPath: net.state,
          vpnStatus: vpn.status,
          ...(net.state === 'local' && net.ssid ? { networkSsid: net.ssid } : {}),
          ...(pc.latencyMs !== undefined ? { pcLatency: pc.latencyMs } : {}),
          ...(pcHostnameRef.current ? { pcHostname: pcHostnameRef.current } : {}),
          ...(pcHostKeyResult.fingerprint ? { pcHostKey: pcHostKeyResult.fingerprint } : {}),
          ...(routerHostKeyResult.fingerprint
            ? { routerHostKey: routerHostKeyResult.fingerprint }
            : {}),
        };
        statusSnapshotRef.current = nextSnapshot;
        updateStatusSnapshot(nextSnapshot);
        if (net.state === 'local' && !net.ssid && !ssidPermissionRequestedRef.current) {
          ssidPermissionRequestedRef.current = true;
          void PcControl.requestNetworkSsidPermission()
            .then((permission) => {
              if (permission.granted && mountedRef.current) void refreshStatusRef.current();
            })
            .catch(() => {});
        }
        if (
          pc.status === 'online' &&
          pcHostKeyResult.trusted &&
          pcHostKeyResult.fingerprint &&
          (showFeedback || !pcHostnameRef.current)
        ) {
          try {
            const hostnameResult = await PcControl.executeSshCommand({
              host: config.pc.host,
              port: config.pc.sshPort,
              target: 'windows',
              username: config.pc.sshUser,
              command: 'hostname',
              connectTimeoutMs: 5000,
              commandTimeoutMs: 5000,
              expectedHostFingerprint: pcHostKeyResult.fingerprint,
            });
            const remoteHostname = parseRemoteHostname(hostnameResult.stdout);
            if (mountedRef.current && hostnameResult.exitCode === 0 && remoteHostname) {
              pcHostnameRef.current = remoteHostname;
              setPcHostname(remoteHostname);
              persistPcHostname(config.pc.host, remoteHostname);
              const hostnameSnapshot = { ...nextSnapshot, pcHostname: remoteHostname };
              statusSnapshotRef.current = hostnameSnapshot;
              updateStatusSnapshot(hostnameSnapshot);
            }
          } catch {
            // The hostname is optional; keep the last successful value when this check fails.
          }
        }
        if (errorSourceRef.current !== 'action' || showFeedback) {
          errorSourceRef.current = undefined;
        }
        refreshed = true;
        return {
          networkPath: net.state,
          pcStatus: pc.status,
          vpnStatus: vpn.status,
        };
      } catch (error) {
        if (!mountedRef.current) return undefined;
        if (requestGeneration !== statusRefreshGenerationRef.current) return undefined;
        if (errorSourceRef.current === 'action' && !showFeedback) return undefined;
        const previousConnection = connectionSnapshotRef.current;
        if (previousConnection) {
          syncConnectionSnapshot({
            ...previousConnection,
            pcStatus: 'error',
            pcReachable: false,
          });
        }
        const describedError = describeError(error);
        errorSourceRef.current = 'status';
        setPcStatus('error');
        if (showFeedback) onToast(copy(describedError.key, describedError.params));
        const errorSnapshot: HomeStatusSnapshot = {
          ...(statusSnapshotRef.current ?? {
            networkPath: 'unknown' as const,
            vpnStatus: 'disconnected' as const,
          }),
          pcStatus: 'error',
        };
        statusSnapshotRef.current = errorSnapshot;
        updateStatusSnapshot(errorSnapshot);
      } finally {
        await waitForMinimum(startedAt);
        busyRef.current = false;
        refreshLockRef.current = false;
        if (mountedRef.current) {
          setBusy((current) => (current === 'status' ? undefined : current));
          if (showFeedback && refreshed) onToast(t('home.refreshSuccess'));
        }
      }
    },
    [
      config.pc.host,
      config.pc.sshPort,
      config.pc.sshUser,
      config.router.host,
      config.router.sshPort,
      copy,
      onSave,
      onToast,
      settings,
      t,
      syncConnectionSnapshot,
      updateStatusSnapshot,
    ],
  );

  useEffect(() => {
    busyRef.current = isBusy;
  }, [isBusy]);
  useEffect(() => {
    refreshStatusRef.current = refreshStatus;
  }, [refreshStatus]);

  useEffect(() => {
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;

    const scheduleRefresh = () => {
      statusRefreshGenerationRef.current += 1;
      if (networkChangeRefreshTimerRef.current !== undefined) {
        window.clearTimeout(networkChangeRefreshTimerRef.current);
      }
      networkChangeRefreshTimerRef.current = window.setTimeout(() => {
        networkChangeRefreshTimerRef.current = undefined;
        void refreshStatusRef.current();
      }, 120);
    };

    void PcControl.addListener('networkChange', scheduleRefresh)
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (networkChangeRefreshTimerRef.current !== undefined) {
        window.clearTimeout(networkChangeRefreshTimerRef.current);
        networkChangeRefreshTimerRef.current = undefined;
      }
      if (listener) void listener.remove();
    };
  }, [resetLatencySession]);

  const refreshLatency = useCallback(async () => {
    if (
      pcStatus !== 'online' ||
      busyRef.current ||
      latencyRefreshLockRef.current ||
      !config.pc.host
    ) {
      return;
    }
    latencyRefreshLockRef.current = true;
    const requestSession = latencySessionRef.current;
    try {
      const pc = await PcControl.getPcStatus({
        host: config.pc.host,
        port: config.pc.sshPort,
        timeoutMs: 2500,
        ...(config.router.host
          ? { routerHost: config.router.host, routerPort: config.router.sshPort }
          : {}),
        routerTimeoutMs: 2000,
      });
      if (pc.resolvedHost && pc.resolvedHost !== settings.pcHost) {
        await onSave({ ...settings, pcHost: pc.resolvedHost });
      }
      if (!mountedRef.current || busyRef.current || requestSession !== latencySessionRef.current) {
        return;
      }
      const currentConnection = connectionSnapshotRef.current;
      syncConnectionSnapshot({
        pcStatus: pc.status,
        pcReachable: pc.reachable,
        networkPath: currentConnection?.networkPath ?? networkPath,
        vpnStatus: currentConnection?.vpnStatus ?? vpnStatus,
        networkSsid: currentConnection?.networkSsid,
      });
      setPcStatus(pc.status);
      setPcReachable(pc.reachable);
      setPcLatency(pc.latencyMs);
      observeStatus(pc.status, pc.reachable, pc.latencyMs);
    } catch {
      if (mountedRef.current && requestSession === latencySessionRef.current) {
        const currentConnection = connectionSnapshotRef.current;
        resetLatencySession();
        if (currentConnection) {
          connectionSnapshotRef.current = {
            ...currentConnection,
            pcStatus: 'unknown',
            pcReachable: false,
          };
        }
        setPcStatus('unknown');
        setPcReachable(false);
        setPcLatency(undefined);
        void refreshStatusRef.current();
      }
      // The status refresh owns user-facing errors; a missed chart sample is silent.
    } finally {
      latencyRefreshLockRef.current = false;
    }
  }, [
    config.pc.host,
    config.pc.sshPort,
    config.router.host,
    config.router.sshPort,
    networkPath,
    onSave,
    observeStatus,
    pcStatus,
    resetLatencySession,
    settings,
    syncConnectionSnapshot,
    vpnStatus,
  ]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useAutoRefresh(pcStatus === 'online' && !isAnyBusy, 1, refreshLatency, isAnyBusy);
  useAutoRefresh(
    !isBusy && !['waking', 'shutting-down', 'rebooting'].includes(pcStatus),
    refreshIntervalSec,
    refreshStatus,
    isBusy,
  );

  async function refreshStatusAfterVpn(expectConnected: boolean) {
    const deadline = Date.now() + VPN_STATUS_REFRESH_WAIT_MS;
    while (mountedRef.current && Date.now() < deadline) {
      const result = await refreshStatusRef.current();
      const settled = result
        ? expectConnected
          ? result.vpnStatus === 'connected' &&
            result.networkPath === 'vpn' &&
            result.pcStatus !== 'unknown'
          : result.vpnStatus !== 'connected' && result.networkPath !== 'vpn'
        : false;
      if (settled) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
  }

  function feedback() {
    if ('vibrate' in navigator) navigator.vibrate(8);
  }

  async function runAction(action: PowerAction) {
    if (!actionAvailability[action]) return;
    const unavailableActionMessage = getUnavailableActionMessage(action, pcStatus, t);
    if (unavailableActionMessage) {
      onToast(unavailableActionMessage);
      return;
    }
    if (action === 'power-on' && !powerOnAvailable) {
      onToast(t('home.powerSetupRequired'));
      return;
    }
    if ((action === 'shutdown' || action === 'reboot') && !configured) {
      onToast(t('home.setupRequired'));
      return;
    }
    if (action === 'power-on' && !routerHostKey) {
      onToast(t('home.routerTrustRequired'));
      return;
    }
    if ((action === 'shutdown' || action === 'reboot') && !pcHostKey) {
      onToast(t('home.pcTrustRequired'));
      return;
    }
    if (actionLockRef.current || isBusy) return;
    feedback();
    actionLockRef.current = true;
    busyRef.current = true;
    setBusy(action);
    const startedAt = Date.now();
    setActionStartedAt(startedAt);
    setActionElapsedSec(0);
    errorSourceRef.current = undefined;
    resetLatencySession();
    setPcStatus(
      action === 'power-on' ? 'waking' : action === 'shutdown' ? 'shutting-down' : 'rebooting',
    );
    try {
      const result = await PcControl.runPowerAction({
        action,
        autoDisconnectVpn: autoDisconnect,
        macAddress: config.pc.macAddress,
        pcHost: config.pc.host,
        ...(pcHostKey ? { pcHostFingerprint: pcHostKey } : {}),
        pcPort: config.pc.sshPort,
        pcUsername: config.pc.sshUser,
        ...(config.router.host
          ? { routerHost: config.router.host, routerPort: config.router.sshPort }
          : {}),
        ...(routerHostKey ? { routerHostFingerprint: routerHostKey } : {}),
        ...(config.router.host
          ? {
              routerUsername: config.router.sshUser ?? '',
              wolInterface: config.router.wolInterface,
            }
          : {}),
      });
      if (result.resolvedPcHost && result.resolvedPcHost !== settings.pcHost) {
        await onSave({ ...settings, pcHost: result.resolvedPcHost });
      }
      if (mountedRef.current) {
        setPcStatus(result.finalStatus);
        setPcReachable(result.finalStatus === 'online');
      }
      if (result.finalStatus === 'online') observeStatus('online', true);
      recordAction(action, result.finalStatus, result.durationMs);
      feedback();
      onToast(
        result.vpnDisconnectFailed
          ? t('home.vpnDisconnectFailed')
          : t('home.actionCompleted', { action: powerActionLabel(action, t) }),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      const describedError = describeError(error);
      errorSourceRef.current = 'action';
      setPcStatus('error');
      onToast(copy(describedError.key, describedError.params));
    } finally {
      await waitForMinimum(startedAt);
      actionLockRef.current = false;
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(undefined);
        setActionStartedAt(undefined);
        setShowConfirm(null);
        postActionRefreshTimerRef.current = window.setTimeout(() => {
          postActionRefreshTimerRef.current = undefined;
          if (mountedRef.current) void refreshStatusRef.current();
        }, 0);
      }
    }
  }

  function requestAction(action: PowerAction) {
    if (!actionAvailability[action] || actionLockRef.current) return;
    const unavailableActionMessage = getUnavailableActionMessage(action, pcStatus, t);
    if (unavailableActionMessage) {
      onToast(unavailableActionMessage);
      return;
    }
    if (action === 'power-on') {
      void runAction(action);
      return;
    }
    dialogReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowConfirm(action);
  }

  async function toggleVpn() {
    if (isAnyBusy) return;
    const connect = vpnStatus !== 'connected';
    resetLatencySession();
    setVpnAction(connect ? 'connect' : 'disconnect');
    feedback();
    try {
      if (!connect) {
        const result = await PcControl.disconnectOpenVpn();
        if (!mountedRef.current) return;
        setVpnStatus(result.status);
        feedback();
        await refreshStatusAfterVpn(false);
        if (!mountedRef.current) return;
        onToast(t('home.vpnDisconnected'));
        return;
      }

      const profiles = await PcControl.getOpenVpnProfiles();
      const profileId =
        profiles.selectedProfileId ??
        (profiles.profiles.length === 1 ? profiles.profiles[0]?.id : undefined);
      if (!profileId) throw { code: 'OPENVPN_PROFILE_NOT_SELECTED' };
      if (mountedRef.current) {
        setVpnStatus('connecting');
      }
      const result = await PcControl.connectOpenVpn({ profileId });
      if (!mountedRef.current) return;
      setVpnStatus(result.status);
      feedback();
      await refreshStatusAfterVpn(true);
      if (!mountedRef.current) return;
      onToast(t('home.vpnConnected'));
    } catch (error) {
      if (!mountedRef.current) return;
      const message = copy(describeError(error).key);
      setVpnStatus('error');
      onToast(message);
    } finally {
      if (mountedRef.current) setVpnAction(undefined);
    }
  }

  function openNameDialog() {
    nameReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNameDraft(displayName);
    setShowNameDialog(true);
  }

  async function savePcName() {
    const nextName = nameDraft.trim();
    if (!nextName) {
      onToast(t('home.nameRequired'));
      nameInputRef.current?.focus();
      return;
    }
    setNameSaving(true);
    try {
      await onSave({ ...settings, pcName: nextName });
      setShowNameDialog(false);
      onToast(t('home.nameChanged'));
    } catch {
      onToast(t('home.nameSaveFailed'));
    } finally {
      setNameSaving(false);
    }
  }

  const lastOnlineLabel = lastOnlineAt
    ? formatRelativeTime(lastOnlineAt, relativeNow, t, locale)
    : t('home.lastOnlineNever');

  return (
    <div className="home-layout">
      <header className="home-topline">
        <div className="brand-lockup" aria-label="PC Control">
          <span className="brand-icon">
            <Power size={20} aria-hidden="true" />
          </span>
          <span>PC Control</span>
        </div>
        <div className="home-header-actions">
          <Button
            variant="ghost"
            size="icon"
            className="home-vpn-toggle"
            data-vpn-status={vpnStatus}
            disabled={isAnyBusy}
            onClick={() => void toggleVpn()}
            aria-label={
              vpnStatus === 'connected'
                ? t('home.vpnDisconnect')
                : vpnStatus === 'connecting'
                  ? t('home.vpnConnecting')
                  : vpnStatus === 'disconnecting'
                    ? t('home.vpnDisconnecting')
                    : t('home.vpnConnect')
            }
            aria-pressed={vpnStatus === 'connected'}
          >
            <ShieldCheck
              size={20}
              className={isVpnBusy ? 'vpn-connecting-motion' : ''}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenHistory}
            aria-label={
              hasUnreadActionHistory ? t('home.historyOpenUnread') : t('home.historyOpen')
            }
          >
            <span className="history-button-icon" aria-hidden="true">
              <History size={20} />
              {hasUnreadActionHistory && <span className="history-unread-badge" />}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label={t('home.settingsOpen')}
          >
            <Settings2 size={20} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <HomeStatusCard
        pcStatus={pcStatus}
        configured={configured}
        pcReachable={pcReachable}
        pcLatency={pcLatency}
        pcHost={settings.pcHost}
        displayName={displayName}
        latencyHistory={latencyHistory}
        lastOnlineLabel={lastOnlineLabel}
        networkPath={networkPath}
        networkSsid={networkSsid}
        actionElapsedSec={actionStartedAt ? actionElapsedSec : undefined}
        onRename={openNameDialog}
        onOpenSettings={onOpenSettings}
        onRefreshStatus={() => void refreshStatus(true)}
      />

      <section className="home-actions" aria-label={t('home.pcControl')}>
        <div className="power-grid">
          <Button
            size="lg"
            className="power-button power-primary"
            disabled={!actionAvailability['power-on']}
            onClick={() => requestAction('power-on')}
          >
            <Power size={22} aria-hidden="true" />
            {busy === 'power-on'
              ? t('home.actionRunning', { action: t('home.powerOn') })
              : t('home.powerOn')}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="power-button power-off"
            disabled={!actionAvailability.shutdown}
            onClick={() => requestAction('shutdown')}
          >
            <PowerOff size={20} aria-hidden="true" />
            {busy === 'shutdown'
              ? t('home.actionRunning', { action: t('home.shutdown') })
              : t('home.shutdown')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="power-button power-reboot"
            disabled={!actionAvailability.reboot}
            onClick={() => requestAction('reboot')}
          >
            <RotateCcw size={20} aria-hidden="true" />
            {busy === 'reboot'
              ? t('home.actionRunning', { action: t('home.reboot') })
              : t('home.reboot')}
          </Button>
        </div>
      </section>

      {showConfirm && (
        <PreferenceDialog
          variant="confirm"
          title={t('home.confirmAction', { action: powerActionLabel(showConfirm, t) })}
          closeRef={dialogCloseRef}
          returnFocusRef={dialogReturnFocusRef}
          onClose={() => setShowConfirm(null)}
          actions={[
            { label: t('common.cancel'), close: true },
            {
              label: t('common.confirm'),
              close: true,
              onClick: () => void runAction(showConfirm),
            },
          ]}
        >
          <p>{t('home.confirmActionMessage')}</p>
        </PreferenceDialog>
      )}
      {showNameDialog && (
        <PreferenceDialog
          title={t('home.pcNameDialogTitle')}
          editing
          busy={nameSaving}
          closeRef={nameDialogCloseRef}
          returnFocusRef={nameReturnFocusRef}
          onClose={() => setShowNameDialog(false)}
          onSubmit={() => void savePcName()}
          actions={[
            { label: t('common.cancel'), close: true },
            { label: nameSaving ? t('home.saving') : t('common.save'), submit: true },
          ]}
        >
          <label className="preferences-dialog-edit-container">
            <input
              ref={nameInputRef}
              className="preferences-dialog-input"
              value={nameDraft}
              maxLength={24}
              autoComplete="off"
              aria-label={t('home.pcNameDialogTitle')}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
        </PreferenceDialog>
      )}
    </div>
  );
}

function getUnavailableActionMessage(
  action: PowerAction,
  pcStatus: PcStatus,
  t: (key: string) => string,
) {
  if (action === 'power-on' && pcStatus === 'online') return t('home.alreadyOn');
  if (action === 'reboot' && pcStatus === 'offline') {
    return t('home.rebootOffline');
  }
  return undefined;
}

function parseRemoteHostname(stdout: string) {
  const hostname = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return hostname && hostname.length <= 253 ? hostname : undefined;
}

function pcHostnameStorageKey(host: string) {
  return `${PC_HOSTNAME_STORAGE_PREFIX}:${encodeURIComponent(host.trim() || 'default')}`;
}

function readStoredPcHostname(host: string) {
  if (typeof window === 'undefined' || !host.trim()) return undefined;
  try {
    const stored = window.localStorage.getItem(pcHostnameStorageKey(host))?.trim();
    return stored && stored.length <= 253 ? stored : undefined;
  } catch {
    return undefined;
  }
}

function persistPcHostname(host: string, hostname: string) {
  if (!host.trim()) return;
  try {
    window.localStorage.setItem(pcHostnameStorageKey(host), hostname);
  } catch {
    // Storage may be unavailable in a restricted web preview.
  }
}

function formatRelativeTime(
  timestamp: number,
  now: number,
  t: (key: string, params?: { value: number }) => string,
  locale: string,
) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return t('history.justNow');
  if (seconds < 60) return t('history.secondsAgo', { value: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('history.minutesAgo', { value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('history.hoursAgo', { value: hours });
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(timestamp);
}

function powerActionLabel(action: PowerAction, t: (key: string) => string) {
  return action === 'power-on'
    ? t('home.powerOn')
    : action === 'shutdown'
      ? t('home.shutdown')
      : t('home.reboot');
}
