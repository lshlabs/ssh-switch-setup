export type PcVerificationState =
  'idle' | 'checking' | 'offline' | 'host-key-unverified' | 'auth-failed' | 'verified' | 'error';

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code === 'string') return candidate.code;
  const data = candidate.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const dataCode = (data as Record<string, unknown>).code;
  return typeof dataCode === 'string' ? dataCode : undefined;
}

/** A failed SSH socket probe does not prove the PC is powered off. */
export function isPcUnavailableError(error: unknown) {
  const code = getErrorCode(error);
  return code === 'HOST_UNREACHABLE' || code === 'CONNECTION_TIMEOUT';
}

export function isSshAuthError(error: unknown) {
  return getErrorCode(error) === 'AUTH_FAILED';
}
