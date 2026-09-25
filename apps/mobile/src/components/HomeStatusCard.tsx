import {
  AlertCircle,
  ChevronRight,
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
  History,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { NetworkState, PcStatus } from '@pc-control/core';
import type { HomeRecentAction as HomeRecentActionData } from '../hooks/useHomeSession';
import { ACTION_ICON, actionHistoryDescriptionKey, actionHistoryTone } from '../lib/actionHistory';
import { Badge } from './ui/badge';
import { ChartContainer, type ChartConfig } from './ui/chart';
import { useAppCopy } from '../i18n';
import type { Translate } from '../i18n';

const LATENCY_WINDOW_SIZE = 30;

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
      <LatencySparkline values={latencyHistory} />
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

function LatencySparkline({ values }: { values: number[] }) {
  const { t } = useAppCopy();
  const recentValues = values.slice(-LATENCY_WINDOW_SIZE);
  const emptyCount = LATENCY_WINDOW_SIZE - recentValues.length;
  const data = Array.from({ length: LATENCY_WINDOW_SIZE }, (_, slot) => {
    const valueIndex = slot - emptyCount;

    return {
      slot,
      latency: valueIndex >= 0 ? recentValues[valueIndex] : null,
    };
  });
  const max = Math.max(30, ...recentValues);

  return (
    <div
      className="home-latency-chart"
      role="img"
      aria-label={
        values.length
          ? t('home.onlineLatencyTrend', { count: values.length })
          : t('home.latencyAfterCheck')
      }
    >
      {values.length ? (
        <ChartContainer
          config={
            {
              latency: { label: t('home.currentLatency'), color: 'var(--app-primary)' },
            } satisfies ChartConfig
          }
          className="home-latency-chart-inner"
        >
          <AreaChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical
              horizontal
              verticalCoordinatesGenerator={({ offset }) =>
                Array.from(
                  { length: 5 },
                  (_, index) => offset.left + (offset.width * (index + 1)) / 6,
                )
              }
              stroke="var(--app-border)"
              strokeDasharray="1 5"
              strokeLinecap="round"
              strokeOpacity={0.48}
            />

            <YAxis
              axisLine={false}
              allowDecimals={false}
              domain={[0, max]}
              tick={{ fill: 'var(--app-muted)', fontSize: 10 }}
              tickLine={false}
              ticks={[0, Math.round(max / 2), max]}
              width={26}
            />

            <XAxis dataKey="slot" hide />

            <Area
              activeDot={false}
              baseValue={0}
              dataKey="latency"
              fill="var(--color-latency)"
              fillOpacity={0.14}
              isAnimationActive={false}
              stroke="var(--color-latency)"
              strokeWidth={2.2}
              type="monotone"
              dot={false}
              connectNulls={false}
            />
            <ReferenceLine y={0} stroke="var(--app-border)" strokeWidth={1} />
          </AreaChart>
        </ChartContainer>
      ) : (
        <span className="home-latency-empty" aria-hidden="true">
          <LoaderCircle className="home-latency-loader" size={24} strokeWidth={2.25} />
        </span>
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

function actionLabel(action: HomeRecentActionData['action'], t: (key: string) => string) {
  return action === 'power-on'
    ? t('home.powerOn')
    : action === 'shutdown'
      ? t('home.shutdown')
      : t('home.reboot');
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

export function HomeRecentAction({
  action,
  relativeTime,
  onOpenHistory,
}: {
  action: HomeRecentActionData | undefined;
  relativeTime: string;
  onOpenHistory: () => void;
}) {
  const { t } = useAppCopy();
  const ActionIcon = action ? ACTION_ICON[action.action] : undefined;
  const actionTone = action ? actionHistoryTone(action.action, action.finalStatus) : 'empty';

  return (
    <section className="home-recent-block" aria-label={t('history.recent')}>
      <h2 className="home-recent-title">{t('history.recent')}</h2>

      <button
        type="button"
        className="home-recent-row"
        onClick={onOpenHistory}
        aria-label={action ? t('history.openRecent') : t('home.historyOpen')}
      >
        <span className={`home-recent-icon home-recent-icon--${actionTone}`} aria-hidden="true">
          {ActionIcon ? <ActionIcon size={22} /> : <History size={22} />}
        </span>

        <div className="home-recent-copy">
          <div className="home-recent-heading">
            <strong>
              {action
                ? `${actionLabel(action.action, t)} ${t('history.doneSuffix')}`
                : t('history.noCompletedActions')}
            </strong>

            {action && <time>{relativeTime}</time>}
          </div>

          <small>
            {action
              ? t(actionHistoryDescriptionKey(action.action, action.finalStatus))
              : t('history.completedActionsHint')}
          </small>
        </div>

        <ChevronRight
          className={`home-recent-chevron ${!action ? 'home-recent-chevron--hidden' : ''}`}
          size={20}
          aria-hidden="true"
        />
      </button>
    </section>
  );
}
