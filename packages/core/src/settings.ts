import type {
  CopyMode,
  LanguagePreference,
  PcControlConfig,
  ThemePreference,
} from './types';
import { DEFAULT_PC_CONTROL_CONFIG } from './config';

export interface AppSettings {
  pcName: string;
  pcHostId: string;
  pcHostname: string;
  pcHostFingerprint: string;
  pcLanPrefix: number;
  pcHost: string;
  pcPort: number;
  pcUsername: string;
  pcMac: string;
  routerHost: string;
  routerPort: number;
  routerUsername: string;
  wolInterface: string;
  autoDisconnectVpn: boolean;
  refreshIntervalSec: number;
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  copyMode: CopyMode;
  onboardingStep: number;
  onboardingCompleted: boolean;
}

export const DEFAULT_REFRESH_INTERVAL_SEC = 20;

export const REFRESH_INTERVAL_OPTIONS = [0, 10, 15, 20, 30, 60] as const;

export function defaultAppSettings(): AppSettings {
  return {
    pcName: '내 PC',
    pcHostId: '',
    pcHostname: '',
    pcHostFingerprint: '',
    pcLanPrefix: 24,
    pcHost: '',
    pcPort: DEFAULT_PC_CONTROL_CONFIG.pc.sshPort,
    pcUsername: '',
    pcMac: '',
    routerHost: '',
    routerPort: DEFAULT_PC_CONTROL_CONFIG.router.sshPort,
    routerUsername: '',
    wolInterface: '',
    autoDisconnectVpn: false,
    refreshIntervalSec: DEFAULT_REFRESH_INTERVAL_SEC,
    themePreference: 'system',
    languagePreference: 'system',
    copyMode: 'simple',
    onboardingStep: 0,
    onboardingCompleted: false,
  };
}

export function toPcControlConfig(settings: AppSettings): PcControlConfig {
  return {
    pc: {
      host: settings.pcHost,
      macAddress: settings.pcMac,
      sshPort: settings.pcPort,
      sshUser: settings.pcUsername,
    },
    router: {
      host: settings.routerHost,
      sshPort: settings.routerPort,
      ...(settings.routerUsername ? { sshUser: settings.routerUsername } : {}),
      wolInterface: settings.wolInterface,
    },
    networks: { ...DEFAULT_PC_CONTROL_CONFIG.networks },
    openVpnPackage: DEFAULT_PC_CONTROL_CONFIG.openVpnPackage,
  };
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const INTERFACE_RE = /^[a-zA-Z0-9]+$/;

export type SettingsValidationError = { field: keyof AppSettings; key: string };

export function validatePcConnectionSettings(settings: AppSettings): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  if (!isValidHost(settings.pcHost)) errors.push({ field: 'pcHost', key: 'validation.pcHost' });
  if (!isValidPort(settings.pcPort)) errors.push({ field: 'pcPort', key: 'validation.pcPort' });
  if (!settings.pcUsername.trim())
    errors.push({ field: 'pcUsername', key: 'validation.pcUsername' });
  return errors;
}

/** Optional WOL settings are valid while empty; completeness is derived separately. */
export function validatePowerOnSettings(settings: AppSettings): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  if (!MAC_RE.test(settings.pcMac))
    if (settings.pcMac.trim()) errors.push({ field: 'pcMac', key: 'validation.pcMac' });
  if (settings.routerHost.trim() && !isValidHost(settings.routerHost))
    errors.push({ field: 'routerHost', key: 'validation.routerHost' });
  if (!isValidPort(settings.routerPort))
    errors.push({ field: 'routerPort', key: 'validation.routerPort' });
  if (settings.wolInterface.trim() && !INTERFACE_RE.test(settings.wolInterface))
    errors.push({ field: 'wolInterface', key: 'validation.wolInterface' });
  return errors;
}

export function validateAppSettings(settings: AppSettings): SettingsValidationError[] {
  const errors = [...validatePcConnectionSettings(settings), ...validatePowerOnSettings(settings)];
  if (
    !REFRESH_INTERVAL_OPTIONS.includes(
      settings.refreshIntervalSec as (typeof REFRESH_INTERVAL_OPTIONS)[number],
    )
  ) {
    errors.push({
      field: 'refreshIntervalSec',
      key: 'validation.refreshInterval',
    });
  }
  return errors;
}

export function isPcConnectionConfigured(settings: AppSettings): boolean {
  return validatePcConnectionSettings(settings).length === 0;
}

export function isPowerOnConfigured(settings: AppSettings): boolean {
  return (
    Boolean(settings.pcMac.trim()) &&
    Boolean(settings.routerHost.trim()) &&
    Boolean(settings.routerUsername.trim()) &&
    Boolean(settings.wolInterface.trim()) &&
    isValidPort(settings.routerPort) &&
    validatePowerOnSettings(settings).length === 0
  );
}

export function isRefreshIntervalValid(value: number): boolean {
  return REFRESH_INTERVAL_OPTIONS.includes(
    value as (typeof REFRESH_INTERVAL_OPTIONS)[number],
  );
}

export function validateSettingField(
  settings: AppSettings,
  field: keyof AppSettings,
): SettingsValidationError[] {
  if (field === 'pcHost' || field === 'pcPort' || field === 'pcUsername') {
    return validatePcConnectionSettings(settings).filter((error) => error.field === field);
  }
  if (field === 'pcMac' || field === 'routerHost' || field === 'routerPort' || field === 'routerUsername' || field === 'wolInterface') {
    return validatePowerOnSettings(settings).filter((error) => error.field === field);
  }
  if (field === 'refreshIntervalSec' && !isRefreshIntervalValid(settings.refreshIntervalSec)) {
    return [{ field, key: 'validation.refreshInterval' }];
  }
  return [];
}

function isValidHost(value: string): boolean {
  if (!value.trim()) return false;
  if (IPV4_RE.test(value)) return value.split('.').every((p) => Number(p) <= 255);
  return HOSTNAME_RE.test(value) && value.length <= 253;
}

function isValidPort(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= 65535;
}

export function isValidSettings(settings: unknown): settings is AppSettings {
  if (typeof settings !== 'object' || settings === null) return false;
  const s = settings as Record<string, unknown>;
  return (
    typeof s.pcName === 'string' &&
    typeof s.pcHostId === 'string' &&
    typeof s.pcHostname === 'string' &&
    typeof s.pcHostFingerprint === 'string' &&
    typeof s.pcLanPrefix === 'number' &&
    typeof s.pcHost === 'string' &&
    typeof s.pcPort === 'number' &&
    typeof s.pcUsername === 'string' &&
    typeof s.pcMac === 'string' &&
    typeof s.routerHost === 'string' &&
    typeof s.routerPort === 'number' &&
    typeof s.routerUsername === 'string' &&
    typeof s.wolInterface === 'string' &&
    typeof s.autoDisconnectVpn === 'boolean' &&
    typeof s.refreshIntervalSec === 'number' &&
    (s.themePreference === 'system' ||
      s.themePreference === 'light' ||
      s.themePreference === 'dark') &&
    (s.languagePreference === 'system' ||
      s.languagePreference === 'ko' ||
      s.languagePreference === 'en') &&
    (s.copyMode === 'simple' || s.copyMode === 'technical') &&
    typeof s.onboardingStep === 'number' &&
    typeof s.onboardingCompleted === 'boolean'
  );
}
