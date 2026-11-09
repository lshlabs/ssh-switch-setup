/** Wire contract shared by the Android app and Windows Setup UI. */
export const PAIRING_PROTOCOL_VERSION = 1 as const;
export const PAIRING_SERVICE_TYPE = '_pc-control._tcp.';

export interface PairingBootstrap {
  protocolVersion: typeof PAIRING_PROTOCOL_VERSION;
  hostId: string;
  displayName: string;
  pairingEndpoint: string;
  oneTimeToken: string;
  pairingIdentityFingerprint: string;
  expiresAt: number;
}

export interface PairingRequest {
  protocolVersion: typeof PAIRING_PROTOCOL_VERSION;
  oneTimeToken: string;
  deviceName: string;
  sshPublicKey: string;
  requestSecret: string;
}

export interface PairingStarted {
  requestId: string;
  confirmationCode: string;
  expiresAt: number;
}

/** The code displayed by both peers is derived locally from the same request. */
export async function confirmationCode(
  token: string,
  publicKey: string,
  hostFingerprint: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(token + publicKey + hostFingerprint);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const number =
    (((digest[0]! << 24) >>> 0) + (digest[1]! << 16) + (digest[2]! << 8) + digest[3]!) >>> 0;
  return String(number % 1_000_000).padStart(6, '0');
}

export interface PairedPcInfo {
  hostId: string;
  displayName: string;
  hostname: string;
  currentLanIp: string;
  lanPrefix: number;
  sshPort: number;
  sshUsername: string;
  sshHostKeyFingerprint: string;
  macAddressCandidate?: string;
  defaultGatewayCandidate?: string;
}

export type PairingStatus =
  | { state: 'pending'; requestId: string; confirmationCode: string }
  | { state: 'registering' | 'cancelling'; requestId: string }
  | { state: 'verifying'; requestId: string; pc: PairedPcInfo; challenge: string }
  | { state: 'failed' | 'cancelled' | 'verified' | 'completed'; requestId: string; error?: string }
  | { state: 'rejected' | 'expired'; requestId: string };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const port = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;

export function parsePairingBootstrap(value: unknown, now = Date.now()): PairingBootstrap {
  if (
    !object(value) ||
    value.protocolVersion !== PAIRING_PROTOCOL_VERSION ||
    !nonempty(value.hostId) ||
    !nonempty(value.displayName) ||
    !nonempty(value.pairingEndpoint) ||
    !nonempty(value.oneTimeToken) ||
    !nonempty(value.pairingIdentityFingerprint) ||
    typeof value.expiresAt !== 'number' ||
    value.expiresAt <= now
  ) {
    throw new Error('페어링 QR이 만료되었거나 형식이 올바르지 않습니다.');
  }
  const endpoint = new URL(value.pairingEndpoint);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('페어링 주소 형식이 올바르지 않습니다.');
  }
  return value as unknown as PairingBootstrap;
}

export function parsePairedPcInfo(value: unknown): PairedPcInfo {
  if (
    !object(value) ||
    !nonempty(value.hostId) ||
    !nonempty(value.displayName) ||
    !nonempty(value.hostname) ||
    !nonempty(value.currentLanIp) ||
    typeof value.lanPrefix !== 'number' ||
    value.lanPrefix < 0 ||
    value.lanPrefix > 32 ||
    !port(value.sshPort) ||
    !nonempty(value.sshUsername) ||
    !nonempty(value.sshHostKeyFingerprint)
  ) {
    throw new Error('PC가 보낸 연결 정보가 올바르지 않습니다.');
  }
  return value as unknown as PairedPcInfo;
}

export function parsePairingStatus(value: unknown): PairingStatus {
  if (!object(value) || !nonempty(value.requestId))
    throw new Error('페어링 응답 형식이 올바르지 않습니다.');
  if (value.state === 'verifying' && nonempty(value.challenge)) {
    return {
      state: 'verifying',
      requestId: value.requestId,
      pc: parsePairedPcInfo(value.pc),
      challenge: value.challenge,
    };
  }
  if (value.state === 'pending' && nonempty(value.confirmationCode)) {
    return {
      state: 'pending',
      requestId: value.requestId,
      confirmationCode: value.confirmationCode,
    };
  }
  if (value.state === 'registering' || value.state === 'cancelling') {
    return { state: value.state, requestId: value.requestId };
  }
  if (
    value.state === 'failed' ||
    value.state === 'cancelled' ||
    value.state === 'verified' ||
    value.state === 'completed'
  ) {
    return {
      state: value.state,
      requestId: value.requestId,
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
    };
  }
  if (value.state === 'rejected' || value.state === 'expired') {
    return { state: value.state, requestId: value.requestId };
  }
  throw new Error('페어링 응답 형식이 올바르지 않습니다.');
}
