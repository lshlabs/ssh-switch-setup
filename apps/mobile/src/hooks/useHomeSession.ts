import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetworkState, PcStatus, PowerAction, VpnStatus } from '@pc-control/core';

const MAX_LATENCY_SAMPLES = 30;
const MAX_ACTION_HISTORY = 10;
const ACTION_HISTORY_STORAGE_PREFIX = 'pc-control.action-history.v1';
const ACTION_HISTORY_READ_STORAGE_PREFIX = 'pc-control.action-history-read.v1';

export type PowerActionHistoryItem = {
  id: string;
  action: PowerAction;
  finalStatus: PcStatus;
  completedAt: number;
  durationMs?: number;
};

export type HomeStatusSnapshot = {
  pcStatus: PcStatus;
  pcReachable?: boolean;
  pcLatency?: number;
  pcHostname?: string;
  networkSsid?: string;
  networkPath: NetworkState;
  vpnStatus: VpnStatus;
  pcHostKey?: string;
  routerHostKey?: string;
};

export type HomeSession = ReturnType<typeof useHomeSession>;

export function useHomeSession(sessionKey: string) {
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [lastOnlineAt, setLastOnlineAt] = useState<number>();
  const [statusSnapshot, setStatusSnapshot] = useState<HomeStatusSnapshot>();
  const [actionHistory, setActionHistory] = useState<PowerActionHistoryItem[]>(() =>
    readActionHistory(sessionKey),
  );
  const [lastReadActionId, setLastReadActionId] = useState<string | undefined>(() => {
    const history = readActionHistory(sessionKey);
    return readLastReadActionId(sessionKey) ?? history[0]?.id;
  });
  const sessionKeyRef = useRef(sessionKey);
  const actionSequenceRef = useRef(0);

  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    sessionKeyRef.current = sessionKey;
    setLatencyHistory([]);
    setLastOnlineAt(undefined);
    setStatusSnapshot(undefined);
    const nextHistory = readActionHistory(sessionKey);
    setActionHistory(nextHistory);
    setLastReadActionId(readLastReadActionId(sessionKey) ?? nextHistory[0]?.id);
    actionSequenceRef.current = 0;
  }, [sessionKey]);

  const observeStatus = useCallback((status: PcStatus, reachable: boolean, latencyMs?: number) => {
    if (status !== 'online' && !reachable) return;
    setLastOnlineAt(Date.now());
    if (latencyMs === undefined || !Number.isFinite(latencyMs)) return;
    setLatencyHistory((current) => [...current, latencyMs].slice(-MAX_LATENCY_SAMPLES));
  }, []);

  const recordAction = useCallback(
    (action: PowerAction, finalStatus: PcStatus, durationMs?: number) => {
      const newAction: PowerActionHistoryItem = {
        id: `${Date.now()}-${actionSequenceRef.current++}`,
        action,
        finalStatus,
        completedAt: Date.now(),
        ...(durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
          ? { durationMs: Math.round(durationMs) }
          : {}),
      };
      setActionHistory((history) => {
        const nextHistory = [newAction, ...history].slice(0, MAX_ACTION_HISTORY);
        persistActionHistory(sessionKey, nextHistory);
        return nextHistory;
      });
    },
    [sessionKey],
  );

  const resetLatencyHistory = useCallback(() => {
    setLatencyHistory([]);
  }, []);

  const updateStatusSnapshot = useCallback((snapshot: HomeStatusSnapshot) => {
    setStatusSnapshot(snapshot);
  }, []);

  const markActionHistoryRead = useCallback(() => {
    const latestActionId = actionHistory[0]?.id;
    setLastReadActionId(latestActionId);
    persistLastReadActionId(sessionKey, latestActionId);
  }, [actionHistory, sessionKey]);

  const hasUnreadActionHistory =
    actionHistory.length > 0 && actionHistory[0]?.id !== lastReadActionId;

  return {
    latencyHistory,
    lastOnlineAt,
    statusSnapshot,
    actionHistory,
    hasUnreadActionHistory,
    observeStatus,
    recordAction,
    resetLatencyHistory,
    updateStatusSnapshot,
    markActionHistoryRead,
  };
}

function actionHistoryStorageKey(sessionKey: string) {
  return `${ACTION_HISTORY_STORAGE_PREFIX}:${sessionKey || 'default'}`;
}

function readActionHistory(sessionKey: string): PowerActionHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(actionHistoryStorageKey(sessionKey));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPowerActionHistoryItem).slice(0, MAX_ACTION_HISTORY);
  } catch {
    return [];
  }
}

function persistActionHistory(sessionKey: string, history: PowerActionHistoryItem[]) {
  try {
    window.localStorage.setItem(actionHistoryStorageKey(sessionKey), JSON.stringify(history));
  } catch {
    // Storage may be unavailable in a restricted web preview; the in-memory history still works.
  }
}

function actionHistoryReadStorageKey(sessionKey: string) {
  return `${ACTION_HISTORY_READ_STORAGE_PREFIX}:${sessionKey || 'default'}`;
}

function readLastReadActionId(sessionKey: string) {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(actionHistoryReadStorageKey(sessionKey)) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistLastReadActionId(sessionKey: string, actionId: string | undefined) {
  try {
    const key = actionHistoryReadStorageKey(sessionKey);
    if (actionId) window.localStorage.setItem(key, actionId);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in a restricted web preview; the in-memory state still works.
  }
}

function isPowerActionHistoryItem(value: unknown): value is PowerActionHistoryItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    isPowerAction(item.action) &&
    isPcStatus(item.finalStatus) &&
    typeof item.completedAt === 'number' &&
    Number.isFinite(item.completedAt) &&
    (item.durationMs === undefined ||
      (typeof item.durationMs === 'number' &&
        Number.isFinite(item.durationMs) &&
        item.durationMs >= 0))
  );
}

function isPowerAction(value: unknown): value is PowerAction {
  return value === 'power-on' || value === 'shutdown' || value === 'reboot';
}

function isPcStatus(value: unknown): value is PcStatus {
  return (
    value === 'unknown' ||
    value === 'online' ||
    value === 'offline' ||
    value === 'waking' ||
    value === 'shutting-down' ||
    value === 'rebooting' ||
    value === 'error'
  );
}
