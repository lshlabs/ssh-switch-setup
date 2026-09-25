import { describe, expect, it } from 'vitest';
import { describeError, ERROR_MESSAGES, mapErrorMessage } from './errorMapping';

describe('errorMapping', () => {
  it('maps known power codes to translation keys', () => {
    expect(mapErrorMessage('PC_WAKE_TIMEOUT')).toEqual({ key: ERROR_MESSAGES.PC_WAKE_TIMEOUT });
    expect(mapErrorMessage('PC_SHUTDOWN_TIMEOUT')).toEqual({
      key: ERROR_MESSAGES.PC_SHUTDOWN_TIMEOUT,
    });
    expect(mapErrorMessage('PC_REBOOT_OFFLINE_TIMEOUT')).toEqual({
      key: ERROR_MESSAGES.PC_REBOOT_OFFLINE_TIMEOUT,
    });
    expect(mapErrorMessage('PC_REBOOT_ONLINE_TIMEOUT')).toEqual({
      key: ERROR_MESSAGES.PC_REBOOT_ONLINE_TIMEOUT,
    });
    expect(mapErrorMessage('POWER_ACTION_IN_PROGRESS')).toEqual({
      key: ERROR_MESSAGES.POWER_ACTION_IN_PROGRESS,
    });
    expect(mapErrorMessage('POWER_COMMAND_FAILED')).toEqual({
      key: ERROR_MESSAGES.POWER_COMMAND_FAILED,
    });
  });

  it('maps OpenVPN codes', () => {
    expect(mapErrorMessage('OPENVPN_APP_NOT_INSTALLED')).toEqual({
      key: ERROR_MESSAGES.OPENVPN_APP_NOT_INSTALLED,
    });
    expect(mapErrorMessage('OPENVPN_PROFILE_NOT_SELECTED')).toEqual({
      key: ERROR_MESSAGES.OPENVPN_PROFILE_NOT_SELECTED,
    });
    expect(mapErrorMessage('OPENVPN_CONNECT_TIMEOUT')).toEqual({
      key: ERROR_MESSAGES.OPENVPN_CONNECT_TIMEOUT,
    });
  });

  it('maps security codes', () => {
    expect(mapErrorMessage('HOST_KEY_MISMATCH')).toEqual({ key: ERROR_MESSAGES.HOST_KEY_MISMATCH });
    expect(mapErrorMessage('AUTH_FAILED')).toEqual({ key: ERROR_MESSAGES.AUTH_FAILED });
    expect(mapErrorMessage('HOME_NETWORK_UNAVAILABLE')).toEqual({
      key: ERROR_MESSAGES.HOME_NETWORK_UNAVAILABLE,
    });
  });

  it('does not expose raw code as main message', () => {
    const raw = 'PC_WAKE_TIMEOUT';
    const mapped = mapErrorMessage(raw);
    expect(mapped.key).not.toBe(raw);
    expect(mapped.key.length).toBeGreaterThan(5);
    expect(mapped.key).toMatch(/^errors\./);
  });

  it('fallback for unknown code', () => {
    expect(mapErrorMessage('UNKNOWN_CODE_XYZ')).toEqual({ key: ERROR_MESSAGES.UNKNOWN });
    expect(mapErrorMessage(undefined, '커스텀 메시지')).toEqual({ key: ERROR_MESSAGES.UNKNOWN });
    expect(mapErrorMessage(undefined)).toEqual({ key: ERROR_MESSAGES.UNKNOWN });
  });

  it('describeError extracts code and maps message', () => {
    const err = { code: 'POWER_ACTION_IN_PROGRESS', message: 'raw' };
    const { code, key } = describeError(err);
    expect(code).toBe('POWER_ACTION_IN_PROGRESS');
    expect(key).toBe(ERROR_MESSAGES.POWER_ACTION_IN_PROGRESS);
    expect(key).not.toBe('raw');
  });

  it('describeError fallback when code missing', () => {
    const { key } = describeError({ message: 'something' });
    expect(key).toBe(ERROR_MESSAGES.UNKNOWN);
    const { key: key2 } = describeError({});
    expect(key2).toBe(ERROR_MESSAGES.UNKNOWN);
  });

  it('every mapped message is non-empty and not equal to code', () => {
    for (const [code, msg] of Object.entries(ERROR_MESSAGES)) {
      expect(msg).toMatch(/^errors\./);
      if (code !== 'UNKNOWN') expect(msg).not.toBe(code);
    }
  });

  it('preserves AUTH_FAILED cause for router WOL', () => {
    const err = {
      code: 'ROUTER_WOL_FAILED',
      message: 'WOL failed',
      data: { causeCode: 'AUTH_FAILED', target: 'router' },
    };
    const { key, causeCode, code } = describeError(err);
    expect(code).toBe('ROUTER_WOL_FAILED');
    expect(causeCode).toBe('AUTH_FAILED');
    expect(key).toBe('errors.routerSshAuthFailed');
  });

  it('preserves AUTH_FAILED cause for windows power', () => {
    const err = {
      code: 'POWER_COMMAND_FAILED',
      message: 'Shutdown failed',
      data: { causeCode: 'AUTH_FAILED', target: 'windows' },
    };
    const { key, causeCode } = describeError(err);
    expect(causeCode).toBe('AUTH_FAILED');
    expect(key).toBe('errors.windowsSshAuthFailed');
  });

  it('preserves non-auth SSH causes wrapped by power actions', () => {
    const err = {
      code: 'POWER_COMMAND_FAILED',
      details: { causeCode: 'HOST_KEY_MISMATCH', target: 'windows' },
    };
    const { key, causeCode } = describeError(err);
    expect(causeCode).toBe('HOST_KEY_MISMATCH');
    expect(key).toBe('errors.hostKeyMismatch');
  });

  it('uses router-specific security copy for wrapped router failures', () => {
    const err = {
      code: 'ROUTER_WOL_FAILED',
      details: { causeCode: 'HOST_KEY_MISMATCH', target: 'router' },
    };
    expect(describeError(err).key).toBe('errors.routerHostKeyMismatch');
  });

  it('handles causeCode in details field', () => {
    const err = {
      code: 'POWER_COMMAND_FAILED',
      message: 'fail',
      details: { causeCode: 'AUTH_FAILED', target: 'windows' },
    };
    const { causeCode } = describeError(err);
    expect(causeCode).toBe('AUTH_FAILED');
  });
});
