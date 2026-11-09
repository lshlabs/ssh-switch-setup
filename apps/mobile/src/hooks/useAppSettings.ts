import { useCallback, useEffect, useRef, useState } from 'react';

import { Capacitor } from '@capacitor/core';
import { PcControl } from '@pc-control/capacitor-pc-control';
import { type AppSettings, defaultAppSettings, toPcControlConfig } from '@pc-control/core';
import type { PcControlConfig } from '@pc-control/core';

const WEB_SETTINGS_KEY = 'pc-control.settings.v2';

type LegacyStoredSettings = Partial<AppSettings> & {
  setupCompleted?: unknown;
  wakeStrategy?: unknown;
};

function normalizeSettings(stored: LegacyStoredSettings): AppSettings {
  const defaults = defaultAppSettings();
  const legacySetupCompleted = stored.setupCompleted;
  const currentSettings = { ...stored } as Partial<AppSettings>;
  delete (currentSettings as Record<string, unknown>).setupCompleted;
  delete (currentSettings as Record<string, unknown>).wakeStrategy;
  const merged: AppSettings = { ...defaults, ...currentSettings };
  if (typeof merged.pcName !== 'string') merged.pcName = defaults.pcName;
  if (typeof merged.pcHostId !== 'string') merged.pcHostId = defaults.pcHostId;
  if (typeof merged.pcHostname !== 'string') merged.pcHostname = defaults.pcHostname;
  if (typeof merged.pcHostFingerprint !== 'string')
    merged.pcHostFingerprint = defaults.pcHostFingerprint;
  if (typeof merged.pcLanPrefix !== 'number' || merged.pcLanPrefix < 0 || merged.pcLanPrefix > 32)
    merged.pcLanPrefix = defaults.pcLanPrefix;
  if (typeof merged.pcHost !== 'string') merged.pcHost = defaults.pcHost;
  if (typeof merged.pcUsername !== 'string') merged.pcUsername = defaults.pcUsername;
  if (typeof merged.pcMac !== 'string') merged.pcMac = defaults.pcMac;
  if (typeof merged.routerHost !== 'string') merged.routerHost = defaults.routerHost;
  if (typeof merged.routerUsername !== 'string') merged.routerUsername = defaults.routerUsername;
  if (typeof merged.wolInterface !== 'string') merged.wolInterface = defaults.wolInterface;
  if (typeof merged.pcPort !== 'number' || !Number.isInteger(merged.pcPort))
    merged.pcPort = defaults.pcPort;
  if (typeof merged.routerPort !== 'number' || !Number.isInteger(merged.routerPort))
    merged.routerPort = defaults.routerPort;
  if (typeof merged.refreshIntervalSec !== 'number' || !Number.isInteger(merged.refreshIntervalSec))
    merged.refreshIntervalSec = defaults.refreshIntervalSec;
  if (
    merged.themePreference !== 'system' &&
    merged.themePreference !== 'light' &&
    merged.themePreference !== 'dark'
  )
    merged.themePreference = defaults.themePreference;
  if (
    merged.languagePreference !== 'system' &&
    merged.languagePreference !== 'ko' &&
    merged.languagePreference !== 'en'
  )
    merged.languagePreference = defaults.languagePreference;
  if (merged.copyMode !== 'simple' && merged.copyMode !== 'technical')
    merged.copyMode = defaults.copyMode;
  if (typeof merged.onboardingStep !== 'number' || !Number.isInteger(merged.onboardingStep))
    merged.onboardingStep = defaults.onboardingStep;
  if (typeof merged.onboardingCompleted !== 'boolean') {
    merged.onboardingCompleted =
      typeof legacySetupCompleted === 'boolean'
        ? legacySetupCompleted
        : defaults.onboardingCompleted;
  }
  return merged;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings());
  const [config, setConfig] = useState<PcControlConfig>(toPcControlConfig(defaultAppSettings()));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const settingsRef = useRef(settings);

  const applySettings = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setConfig(toPcControlConfig(next));
  }, []);

  const load = useCallback(async () => {
    setError(undefined);
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await PcControl.getAppSettings();
        const merged = normalizeSettings(result.settings);
        applySettings(merged);
      } catch (error) {
        const fallback = defaultAppSettings();
        applySettings(fallback);
        setError(error instanceof Error ? error.message : 'settings.loadFailed');
      }
      setLoaded(true);
      return;
    }

    try {
      const stored = JSON.parse(
        window.localStorage.getItem(WEB_SETTINGS_KEY) ?? 'null',
      ) as LegacyStoredSettings | null;
      const merged = normalizeSettings(stored ?? {});
      applySettings(merged);
    } catch {
      const fallback = defaultAppSettings();
      applySettings(fallback);
    }
    setLoaded(true);
  }, [applySettings]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from native storage
    void load();
  }, [load]);

  const save = useCallback(
    async (next: AppSettings) => {
      setError(undefined);
      const previous = settingsRef.current;
      const optimistic = normalizeSettings(next);
      applySettings(optimistic);
      try {
        if (Capacitor.isNativePlatform()) {
          const result = await PcControl.setAppSettings({ settings: next });
          const merged = normalizeSettings({ ...result.settings, ...next });
          applySettings(merged);
          return;
        }

        // The web preview has no native settings store, so persist locally there only.
        window.localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(next));
      } catch (error) {
        applySettings(previous);
        setError(error instanceof Error ? error.message : 'settings.saveFailed');
        throw error;
      }
    },
    [applySettings],
  );

  return { settings, config, loaded, error, save, reload: load };
}
