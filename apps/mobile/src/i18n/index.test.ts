import { describe, expect, it } from 'vitest';
import { copyText, resolveLocale, translate } from './index';
import en from './locales/en.json';
import ko from './locales/ko.json';

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringValues);
}

describe('i18n', () => {
  it('resolves explicit and system language preferences', () => {
    expect(resolveLocale('ko', 'en-US')).toBe('ko');
    expect(resolveLocale('en', 'ko-KR')).toBe('en');
    expect(resolveLocale('system', 'ko-KR')).toBe('ko');
    expect(resolveLocale('system', 'ja-JP')).toBe('en');
  });

  it('translates interpolation values from both locales', () => {
    expect(translate('ko', 'settings.display.refreshSeconds', { value: 20 })).toBe('20초');
    expect(translate('en', 'settings.display.refreshSeconds', { value: 20 })).toBe('20s');
    expect(translate('en', 'diagnostics.connection.success.simple')).toContain('securely');
  });

  it('resolves the remote settings section in every locale and mode', () => {
    expect(translate('ko', 'settings.remote.section')).toBe('원격 연결 정보');
    expect(translate('en', 'settings.remote.section')).toBe('Remote connection information');
    expect(copyText('ko', 'simple', 'settings.remote.section')).toBe('원격 연결 정보');
    expect(copyText('en', 'technical', 'settings.remote.section')).toBe(
      'Remote connection information',
    );
  });

  it('resolves every mode-aware settings field label without fallback copy', () => {
    const labels = ['settings.pc.username', 'settings.power.mac', 'settings.power.interface'];
    for (const locale of ['ko', 'en'] as const) {
      for (const mode of ['simple', 'technical'] as const) {
        for (const key of labels) {
          expect(copyText(locale, mode, key)).not.toBe(
            locale === 'ko' ? '표시할 수 없음' : 'Unavailable',
          );
        }
      }
    }
  });

  it('does not expose a missing translation key as user-facing copy', () => {
    expect(translate('ko', 'settings.missingKey')).not.toBe('settings.missingKey');
    expect(copyText('en', 'technical', 'diagnostics.missingKey')).not.toBe(
      'diagnostics.missingKey',
    );
  });

  it('falls back to common copy when a key has no mode-specific value', () => {
    expect(copyText('en', 'technical', 'home.offline')).toBe('The PC is not responding.');
    expect(copyText('ko', 'technical', 'diagnostics.connection.success')).toBe(
      'SSH 연결 및 Public Key 인증 정상',
    );
  });

  it('uses neutral, target-specific copy in both modes and locales', () => {
    expect(copyText('ko', 'simple', 'settings.power.local')).toBe('같은 네트워크에서만 사용');
    expect(copyText('ko', 'technical', 'settings.power.localDescription')).toBe(
      'Same-LAN Wake-on-LAN',
    );
    expect(copyText('en', 'simple', 'settings.power.router')).toBe('Wake the PC remotely');
    expect(copyText('en', 'technical', 'diagnostics.security.pcTrustDescription')).toBe(
      'Host Key verification',
    );
    expect(copyText('ko', 'simple', 'diagnostics.security.routerTrustDescription')).toBe(
      '직접 확인한 공유기만 신뢰하세요.',
    );
  });

  it('keeps locale shapes aligned and removes home-network assumptions', () => {
    expect(leafPaths(ko)).toEqual(leafPaths(en));
    expect(
      stringValues(ko).some((value) =>
        /집 네트워크|집 밖|집 안|같은 집|홈 네트워크|집 Wi-Fi/.test(value),
      ),
    ).toBe(false);
    expect(
      stringValues(en).some((value) => /home network|outside home|at home|home wi-fi/i.test(value)),
    ).toBe(false);
  });
});
