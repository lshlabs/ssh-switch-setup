import { describe, expect, it } from 'vitest';
import {
  defaultAppSettings,
  isPcConnectionConfigured,
  isPowerOnConfigured,
  validateAppSettings,
} from './settings';

describe('validateAppSettings', () => {
  it('product defaults are intentionally incomplete', () => {
    const s = defaultAppSettings();
    expect(s.pcHost).toBe('');
    expect(s.pcMac).toBe('');
    expect(validateAppSettings(s).some((e) => e.field === 'pcHost')).toBe(true);
  });

  it('uses stable display preference defaults', () => {
    const settings = defaultAppSettings();
    expect(settings.languagePreference).toBe('system');
    expect(settings.copyMode).toBe('simple');
  });

  it('returns translation keys for validation errors', () => {
    const error = validateAppSettings(defaultAppSettings()).find((item) => item.field === 'pcHost');
    expect(error?.key).toBe('validation.pcHost');
  });

  it('invalid PC host', () => {
    const s = { ...defaultAppSettings(), pcHost: '' };
    const errs = validateAppSettings(s);
    expect(errs.some((e) => e.field === 'pcHost')).toBe(true);
  });

  it('invalid router host', () => {
    const s = { ...completeSettings(), routerHost: '///' };
    expect(validateAppSettings(s).some((e) => e.field === 'routerHost')).toBe(true);
  });

  it('invalid PC port', () => {
    const s = { ...completeSettings(), pcPort: 99999 };
    expect(validateAppSettings(s).some((e) => e.field === 'pcPort')).toBe(true);
  });

  it('invalid router port', () => {
    const s = { ...completeSettings(), routerPort: 0 };
    expect(validateAppSettings(s).some((e) => e.field === 'routerPort')).toBe(true);
  });

  it('invalid MAC', () => {
    const s = { ...completeSettings(), pcMac: 'not-a-mac' };
    expect(validateAppSettings(s).some((e) => e.field === 'pcMac')).toBe(true);
  });

  it('allows an empty optional interface but rejects invalid values', () => {
    const empty = { ...completeSettings(), wolInterface: '' };
    expect(validateAppSettings(empty).some((e) => e.field === 'wolInterface')).toBe(false);
    const invalid = { ...completeSettings(), wolInterface: 'br-0' };
    expect(validateAppSettings(invalid).some((e) => e.field === 'wolInterface')).toBe(true);
  });

  it('invalid refresh interval', () => {
    const s = { ...completeSettings(), refreshIntervalSec: 99 as never };
    expect(validateAppSettings(s).some((e) => e.field === 'refreshIntervalSec')).toBe(true);
  });

  it('keeps power-on capability independent from PC connection capability', () => {
    const s = { ...defaultAppSettings(), ...completeSettings() };
    expect(isPcConnectionConfigured(s)).toBe(true);
    expect(isPowerOnConfigured(s)).toBe(true);
    expect(isPcConnectionConfigured({ ...s, pcHost: '' })).toBe(false);
    expect(isPowerOnConfigured({ ...s, routerHost: '' })).toBe(false);
  });

  it('does not consider invalid ports or refresh intervals configured', () => {
    expect(isPcConnectionConfigured({ ...completeSettings(), pcPort: 0 })).toBe(false);
    expect(validateAppSettings({ ...completeSettings(), refreshIntervalSec: 99 })).not.toEqual([]);
  });
});

function completeSettings() {
  return {
    ...defaultAppSettings(),
    pcHost: '192.168.1.100',
    pcUsername: 'windows-user',
    pcMac: 'AA:BB:CC:DD:EE:FF',
    routerHost: '192.168.1.1',
    routerUsername: 'router-user',
    wolInterface: 'lan0',
  };
}
