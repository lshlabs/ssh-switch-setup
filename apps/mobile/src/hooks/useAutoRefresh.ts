import { useEffect, useRef } from 'react';

import { App as CapApp } from '@capacitor/app';

export function useAutoRefresh(
  enabled: boolean,
  intervalSec: number,
  onRefresh: () => void,
  isBusy: boolean,
) {
  const timerRef = useRef<number | null>(null);
  const callbackRef = useRef(onRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || intervalSec <= 0 || isBusy) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const id = window.setInterval(() => {
      if (document.hidden) return;
      callbackRef.current();
    }, intervalSec * 1000);
    timerRef.current = id;

    const onVisibility = () => {
      if (!document.hidden) callbackRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let capListener: { remove: () => void } | null = null;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) callbackRef.current();
    }).then((l) => {
      capListener = l;
    });

    return () => {
      window.clearInterval(id);
      timerRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      if (capListener) void capListener.remove();
    };
  }, [enabled, intervalSec, isBusy]);
}
