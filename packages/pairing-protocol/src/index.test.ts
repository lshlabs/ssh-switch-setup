import { describe, expect, it } from 'vitest';
import { confirmationCode, parsePairingBootstrap, parsePairingStatus } from './index';

describe('pairing protocol', () => {
  it('derives the same six digit code as the Windows SHA-256 first-word implementation', async () => {
    expect(await confirmationCode('token', 'key', 'fingerprint')).toBe('315649');
  });

  it('rejects expired bootstrap data and malformed approved PC data', () => {
    expect(() => parsePairingBootstrap({ protocolVersion: 1, expiresAt: 1 })).toThrow();
    expect(() => parsePairingStatus({ state: 'approved', requestId: 'x', pc: {} })).toThrow();
  });

  it('keeps registration, verification, and finalization separate', () => {
    expect(parsePairingStatus({ state: 'registering', requestId: 'x' }).state).toBe('registering');
    expect(parsePairingStatus({ state: 'verified', requestId: 'x' }).state).toBe('verified');
    expect(() => parsePairingStatus({ state: 'verifying', requestId: 'x' })).toThrow();
  });
});
