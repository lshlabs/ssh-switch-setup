import { describe, expect, it } from 'vitest';
import { confirmationCode, parsePairingBootstrap, parsePairingStatus } from './index';

describe('pairing protocol', () => {
  const bootstrap = {
    protocolVersion: 1, hostId: 'pc', displayName: 'PC', pairingEndpoint: 'https://192.168.1.10:4433',
    oneTimeToken: 'a'.repeat(64), tlsCertificateFingerprint: 'b'.repeat(64),
    pairingIdentityFingerprint: 'SHA256:key', expiresAt: 10000,
  };
  it('requires an out-of-band TLS pin and private HTTPS endpoint', () => {
    expect(parsePairingBootstrap(bootstrap, 0).hostId).toBe('pc');
    for (const endpoint of ['http://192.168.1.10:4433', 'https://example.com:4433', 'https://8.8.8.8:4433', 'https://user@192.168.1.10:4433', 'https://192.168.1.10:4433/?secret=x']) {
      expect(() => parsePairingBootstrap({ ...bootstrap, pairingEndpoint: endpoint }, 0)).toThrow();
    }
    expect(() => parsePairingBootstrap({ ...bootstrap, tlsCertificateFingerprint: undefined }, 0)).toThrow();
    expect(() => parsePairingBootstrap({ ...bootstrap, oneTimeToken: 'short' }, 0)).toThrow();
    expect(() => parsePairingBootstrap(bootstrap, 10000)).toThrow();
  });
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
