import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

export function useAutoRefresh(
  enabled: boolean,
  intervalSec: number,
  onRefresh: () => void,
  isBusy: boolean,
) {
  const callbackRef = useRef(onRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || intervalSec <= 0 || isBusy) return;

    let disposed = false;
    const refresh = () => {
      if (!disposed && !document.hidden) callbackRef.current();
    };
    const timer = window.setInterval(refresh, intervalSec * 1000);
    document.addEventListener('visibilitychange', refresh);

    let listener: PluginListenerHandle | undefined;
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) refresh();
      })
        .then((handle) => {
          if (disposed) void handle.remove().catch(() => {});
          else listener = handle;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      if (listener) void listener.remove().catch(() => {});
    };
  }, [enabled, intervalSec, isBusy]);
}
