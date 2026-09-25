import { type AppSettings, defaultAppSettings } from '@pc-control/core';

export function createOnboardingSession(settings: AppSettings): AppSettings {
  const defaults = defaultAppSettings();
  return {
    ...settings,
    pcHost: '',
    pcPort: defaults.pcPort,
    pcUsername: '',
    pcMac: '',
    routerHost: '',
    routerPort: defaults.routerPort,
    routerUsername: '',
    wolInterface: '',
    onboardingStep: 0,
    onboardingCompleted: false,
  };
}
