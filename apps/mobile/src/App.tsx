/* eslint-disable react-hooks/set-state-in-effect -- initial route follows persisted setup state */
import { useCallback, useEffect, useRef, useState } from 'react';

import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { PcControl } from '@pc-control/capacitor-pc-control';
import { useAppSettings } from './hooks/useAppSettings';
import { ActionHistoryPage } from './components/ActionHistoryPage';
import { MainScreen } from './components/MainScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { useHomeSession } from './hooks/useHomeSession';
import type { ThemePreference } from '@pc-control/core';
import { I18nProvider, useAppCopy } from './i18n';

type Screen = 'main' | 'settings' | 'settings-sample' | 'history' | 'onboarding';
type BackHandler = () => boolean;

export default function App() {
  const { settings, config, loaded, save } = useAppSettings();
  const homeSession = useHomeSession(config.pc.host);
  const [screen, setScreen] = useState<Screen>('main');
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [themePreview, setThemePreview] = useState<ThemePreference>();
  const backHandlerRef = useRef<BackHandler | null>(null);
  const screenRef = useRef(screen);

  const registerBack = useCallback((handler: BackHandler | null) => {
    backHandlerRef.current = handler;
  }, []);

  const showToast = useCallback((message: string) => {
    void PcControl.showSystemToast({ message }).catch(() => {});
  }, []);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (!loaded) return;
    if (!settings.onboardingCompleted && !onboardingDismissed) {
      setScreen('onboarding');
    }
  }, [loaded, onboardingDismissed, settings]);

  useEffect(() => {
    let disposed = false;
    let showListener: { remove: () => Promise<void> } | undefined;
    let hideListener: { remove: () => Promise<void> } | undefined;

    const setKeyboardHeight = (keyboardHeight: number) => {
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${Math.max(0, keyboardHeight)}px`,
      );
      document.documentElement.dataset.keyboardOpen = keyboardHeight > 0 ? 'true' : 'false';
    };

    setKeyboardHeight(0);
    if (!Capacitor.isNativePlatform()) return;

    void Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
      setKeyboardHeight(keyboardHeight);
    })
      .then((handle) => {
        if (disposed) void handle.remove();
        else showListener = handle;
      })
      .catch(() => {});

    void Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    })
      .then((handle) => {
        if (disposed) void handle.remove();
        else hideListener = handle;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (showListener) void showListener.remove();
      if (hideListener) void hideListener.remove();
      setKeyboardHeight(0);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener('backButton', () => {
      if (backHandlerRef.current?.()) return;
      if (screenRef.current === 'history') {
        setScreen('main');
        return;
      }
      if (screenRef.current === 'settings') {
        setScreen('main');
        return;
      }
      if (screenRef.current === 'settings-sample') {
        setScreen('settings');
        return;
      }
      if (screenRef.current === 'onboarding') {
        setOnboardingDismissed(true);
        setScreen('main');
        return;
      }
      void CapApp.exitApp().catch(() => {});
    })
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const preference = themePreview ?? settings.themePreference;
      const dark =
        preference === 'dark' ||
        (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    applyTheme();
    const preference = themePreview ?? settings.themePreference;
    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.themePreference, themePreview]);

  if (!loaded)
    return (
      <I18nProvider languagePreference={settings.languagePreference} copyMode={settings.copyMode}>
        <LoadingScreen />
      </I18nProvider>
    );

  const content =
    screen === 'onboarding' ? (
      <main className="app-shell">
        <OnboardingScreen
          settings={settings}
          onSave={save}
          onComplete={() => setScreen('main')}
          onSkip={() => {
            setOnboardingDismissed(true);
            setScreen('main');
          }}
          registerBack={registerBack}
        />
      </main>
    ) : (
      <main
        className={`app-shell ${screen === 'main' ? 'home-shell' : 'page-shell'}${
          screen === 'settings'
            ? ' page-shell-settings'
            : screen === 'settings-sample'
              ? ' page-shell-settings-sample'
              : ''
        }`}
      >
        <div
          className={
            screen === 'main'
              ? 'home-content'
              : `page-content${screen === 'settings' ? ' page-content-settings' : screen === 'settings-sample' ? ' page-content-settings-sample' : ''}`
          }
        >
          {screen === 'main' && (
            <MainScreen
              config={config}
              settings={settings}
              onSave={save}
              refreshIntervalSec={settings.refreshIntervalSec}
              autoDisconnect={settings.autoDisconnectVpn}
              session={homeSession}
              onOpenSettings={() => setScreen('settings')}
              onOpenHistory={() => setScreen('history')}
              onToast={showToast}
              registerBack={registerBack}
            />
          )}
          {screen === 'settings' && (
            <SettingsScreen
              settings={settings}
              onSave={save}
              onThemePreview={setThemePreview}
              onOpenOnboarding={() => {
                setOnboardingDismissed(false);
                setScreen('onboarding');
              }}
              onOpenSettingsSample={() => setScreen('settings-sample')}
              onBack={() => setScreen('main')}
              config={config}
              onToast={showToast}
              registerBack={registerBack}
            />
          )}
          {screen === 'history' && (
            <ActionHistoryPage
              history={homeSession.actionHistory}
              onBack={() => setScreen('main')}
              registerBack={registerBack}
            />
          )}
        </div>
      </main>
    );

  return (
    <I18nProvider languagePreference={settings.languagePreference} copyMode={settings.copyMode}>
      {content}
    </I18nProvider>
  );
}

function LoadingScreen() {
  const { t } = useAppCopy();
  return (
    <main className="app-shell grid min-h-dvh place-items-center px-5">
      <p className="text-sm text-muted">{t('common.loading')}</p>
    </main>
  );
}
