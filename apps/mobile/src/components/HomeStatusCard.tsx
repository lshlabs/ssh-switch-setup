import {
  AlertCircle,
  Monitor,
  Pencil,
  Power,
  PowerOff,
  RotateCcw,
  Router,
  Settings2,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { NetworkState, PcStatus } from '@pc-control/core';
import { Badge } from './ui/badge';
import { useAppCopy } from '../i18n';
import type { Translate } from '../i18n';

const LatencySparkline = lazy(() => import('./LatencySparkline'));

export function HomeStatusCard({
  pcStatus,
  configured,
  pcReachable,
  pcLatency,
  pcHost,
  displayName,
  latencyHistory,
  lastOnlineLabel,
  networkPath,
  networkSsid,
  actionElapsedSec,
  onRename,
  onOpenSettings,
  onRefreshStatus,
}: {
  pcStatus: PcStatus;
  configured: boolean;
  pcReachable: boolean | undefined;
  pcLatency: number | undefined;
  pcHost: string;
  displayName: string;
  latencyHistory: number[];
  lastOnlineLabel: string;
  networkPath: NetworkState;
  networkSsid: string | undefined;
  actionElapsedSec: number | undefined;
  onRename: () => void;
  onOpenSettings: () => void;
  onRefreshStatus: () => void;
}) {
  const { t } = useAppCopy();
  const statusTone =
    pcStatus === 'online' ? 'success' : pcStatus === 'error' ? 'danger' : 'warning';
  const currentLatency =
    pcStatus === 'online' && pcReachable && pcLatency !== undefined ? pcLatency : undefined;
  const averageLatency = latencyHistory.length
    ? Math.round(latencyHistory.reduce((total, value) => total + value, 0) / latencyHistory.length)
    : undefined;

  return (
    <section className="home-status-block">
      <div className="home-status-head">
        <div className="home-identity">
          <div className="home-title-row">
            <h1 className="home-title">{displayName}</h1>
            <button
              type="button"
              className="home-name-edit"
              onClick={onRename}
              aria-label={t('home.rename')}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
          {pcHost && <p className="home-address">{pcHost}</p>}
        </div>
        <div className="home-status-tools">
          <button
            type="button"
            className="home-status-refresh"
            onClick={onRefreshStatus}
            aria-label={t('home.statusRefresh')}
          >
            <Badge variant={statusTone} aria-live="polite">
              <span
                className={`status-dot ${pcStatus === 'online' ? 'status-dot--pulse' : ''}`}
                aria-hidden="true"
              />
              {statusLabel(pcStatus, t)}
            </Badge>
          </button>
        </div>
      </div>

      <div className={`home-status-center home-status-center-${pcStatus}`}>
        {pcStatus === 'online' ? (
          <OnlineStatus latencyHistory={latencyHistory} />
        ) : (
          <StaticStatus
            status={pcStatus}
            configured={configured}
            actionElapsedSec={actionElapsedSec}
            onOpenSettings={onOpenSettings}
            t={t}
          />
        )}
      </div>

      <HomeTopology networkPath={networkPath} networkSsid={networkSsid} pcName={displayName} />

      <div className="home-metrics">
        <HomeMetric
          label={t('home.currentLatency')}
          value={currentLatency === undefined ? '—' : String(currentLatency)}
          suffix={currentLatency === undefined ? undefined : 'ms'}
        />
        <HomeMetric
          label={t('home.averageLatency')}
          value={averageLatency === undefined ? '—' : String(averageLatency)}
          suffix={averageLatency === undefined ? undefined : 'ms'}
        />
        <HomeMetric label={t('home.lastOnline')} value={lastOnlineLabel} suffix={undefined} />
      </div>
    </section>
  );
}

function OnlineStatus({ latencyHistory }: { latencyHistory: number[] }) {
  return (
    <div className="home-online-status">
      {/* <div className="home-latency-heading">
        <h2>최근 응답 시간</h2>
      </div> */}
      <Suspense fallback={<div className="home-latency-chart" aria-busy="true" />}>
        <LatencySparkline values={latencyHistory} />
      </Suspense>
    </div>
  );
}

function StaticStatus({
  status,
  configured,
  actionElapsedSec,
  onOpenSettings,
  t,
}: {
  status: PcStatus;
  configured: boolean;
  actionElapsedSec: number | undefined;
  onOpenSettings: () => void;
  t: Translate;
}) {
  if (!configured) {
    return (
      <StaticMessage
        icon={Settings2}
        title={t('home.setupRequired')}
        actionLabel={t('home.startSetup')}
        onAction={onOpenSettings}
      />
    );
  }
  if (status === 'waking') {
    return (
      <ActionStatus
        icon={Power}
        title={t('home.statusWaking')}
        detail={t('home.elapsed', { value: actionElapsedSec ?? 0 })}
      />
    );
  }
  if (status === 'shutting-down') {
    return <ActionStatus icon={PowerOff} title={t('home.statusShuttingDown')} />;
  }
  if (status === 'rebooting') {
    return <ActionStatus icon={RotateCcw} title={t('home.statusRebooting')} />;
  }
  if (status === 'offline') {
    return <StaticMessage icon={PowerOff} title={t('home.pcUnavailable')} />;
  }
  if (status === 'error') {
    return <StaticMessage icon={AlertCircle} title={t('home.pcCheckRequired')} tone="danger" />;
  }
  return <StaticMessage icon={WifiOff} title={t('home.networkUnavailable')} />;
}

function ActionStatus({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
}) {
  return (
    <div className="home-action-status">
      <span className="home-status-center-icon" aria-hidden="true">
        <Icon size={42} />
      </span>
      <h2>{title}</h2>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function StaticMessage({
  icon: Icon,
  title,
  tone = 'warning',
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  tone?: 'warning' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`home-static-status status-${tone}`}>
      <span className="home-status-center-icon" aria-hidden="true">
        <Icon size={42} />
      </span>
      <h2>{title}</h2>
      {actionLabel && onAction && (
        <button
          type="button"
          className="oneui-button oneui-button--surface home-static-action"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function HomeTopology({
  networkPath,
  networkSsid,
  pcName,
}: {
  networkPath: NetworkState;
  networkSsid: string | undefined;
  pcName: string;
}) {
  const { t } = useAppCopy();
  const path = networkPath === 'vpn' ? 'vpn' : networkPath === 'local' ? 'local' : 'unknown';
  return (
    <div
      key={path}
      className={`home-topology home-topology-${path}`}
      aria-label={`${t('home.connectionPath')}: ${topologyLabel(path, networkSsid, t)}`}
    >
      <TopologyNode icon={Smartphone} label={t('home.phone')} />
      {path === 'unknown' ? (
        <TopologyLine segment={0} active />
      ) : (
        <>
          <TopologyLine segment={0} active />
          {path === 'local' ? (
            <>
              <TopologyNode icon={Wifi} label={networkSsid ?? 'Wi-Fi'} />
              <TopologyLine segment={1} active />
            </>
          ) : (
            <>
              <TopologyNode
                icon={ShieldCheck}
                label="OpenVPN"
                className="home-topology-node--vpn"
              />
              <TopologyLine segment={1} active />
              <TopologyNode icon={Router} label={t('home.router')} />
              <TopologyLine segment={2} active />
            </>
          )}
        </>
      )}
      <TopologyNode icon={Monitor} label={pcName} />
    </div>
  );
}

function TopologyNode({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className?: string | undefined;
}) {
  return (
    <div className={`home-topology-node${className ? ` ${className}` : ''}`}>
      <span className="home-topology-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="home-topology-label">{label}</span>
    </div>
  );
}

function TopologyLine({ segment, active }: { segment: number; active: boolean }) {
  return (
    <span
      className={`home-topology-line${active ? ' home-topology-line--active' : ' home-topology-line--hidden'}`}
      data-segment={segment}
      aria-hidden="true"
    />
  );
}

function topologyLabel(
  path: 'local' | 'vpn' | 'unknown',
  networkSsid: string | undefined,
  t: (key: string) => string,
) {
  return path === 'local'
    ? (networkSsid ?? 'Wi-Fi')
    : path === 'vpn'
      ? 'OpenVPN'
      : t('home.networkChecking');
}

function statusLabel(status: PcStatus, t: (key: string) => string) {
  return status === 'online'
    ? t('common.online')
    : status === 'offline'
      ? t('common.offline')
      : status === 'waking'
        ? t('home.statusWaking')
        : status === 'shutting-down'
          ? t('home.statusShuttingDown')
          : status === 'rebooting'
            ? t('home.statusRebooting')
            : status === 'error'
              ? t('home.statusNeedsAttention')
              : t('home.statusUnknown');
}

function HomeMetric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix: string | undefined;
}) {
  return (
    <div className="home-metric">
      <span>{label}</span>
      <strong>
        {value}
        {suffix && <small>{suffix}</small>}
      </strong>
    </div>
  );
}
