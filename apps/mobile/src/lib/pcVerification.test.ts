import { describe, expect, it } from 'vitest';
import { isPcUnavailableError, isSshAuthError } from './pcVerification';

describe('pc verification error helpers', () => {
  it('treats SSH socket non-response as PC unavailable', () => {
    expect(isPcUnavailableError({ code: 'HOST_UNREACHABLE' })).toBe(true);
    expect(isPcUnavailableError({ code: 'CONNECTION_TIMEOUT' })).toBe(true);
    expect(isPcUnavailableError({ code: 'AUTH_FAILED' })).toBe(false);
  });

  it('keeps SSH authentication failure distinct from reachability', () => {
    expect(isSshAuthError({ code: 'AUTH_FAILED' })).toBe(true);
    expect(isSshAuthError({ code: 'HOST_UNREACHABLE' })).toBe(false);
  });
});
