type ErrorParams = Record<string, string | number>;

export type UserError = {
  key: string;
  params?: ErrorParams;
};

export type DescribedError = UserError & {
  code?: string;
  causeCode?: string;
};

/** Maps native/domain error codes to presentation-neutral translation keys. */
export const ERROR_MESSAGES: Record<string, string> = {
  IDENTITY_NOT_AVAILABLE: 'errors.identityNotAvailable',
  HOST_UNREACHABLE: 'errors.hostUnreachable',
  CONNECTION_TIMEOUT: 'errors.connectionTimeout',
  HOST_KEY_UNKNOWN: 'errors.hostKeyUnknown',
  HOST_KEY_MISMATCH: 'errors.hostKeyMismatch',
  AUTH_FAILED: 'errors.authFailed',
  COMMAND_TIMEOUT: 'errors.commandTimeout',
  COMMAND_FAILED: 'errors.commandFailed',
  IO_ERROR: 'errors.ioError',
  OPENVPN_APP_NOT_INSTALLED: 'errors.openVpnAppNotInstalled',
  OPENVPN_SERVICE_BIND_FAILED: 'errors.openVpnServiceBindFailed',
  OPENVPN_CONTROL_PERMISSION_REQUIRED: 'errors.openVpnPermissionRequired',
  OPENVPN_CONTROL_PERMISSION_DENIED: 'errors.openVpnPermissionDenied',
  OPENVPN_PROFILE_NOT_SELECTED: 'errors.openVpnProfileNotSelected',
  OPENVPN_PROFILE_NOT_FOUND: 'errors.openVpnProfileNotFound',
  OPENVPN_CONNECT_FAILED: 'errors.openVpnConnectFailed',
  OPENVPN_CONNECT_TIMEOUT: 'errors.openVpnConnectTimeout',
  OPENVPN_DISCONNECT_FAILED: 'errors.openVpnDisconnectFailed',
  OPENVPN_STATUS_UNAVAILABLE: 'errors.openVpnStatusUnavailable',
  HOST_UNREACHABLE_NETWORK: 'errors.hostUnreachableNetwork',
  REACHABILITY_TIMEOUT: 'errors.reachabilityTimeout',
  HOME_NETWORK_UNAVAILABLE: 'errors.homeNetworkUnavailable',
  PC_STATUS_CHECK_FAILED: 'errors.pcStatusCheckFailed',
  PC_WAKE_TIMEOUT: 'errors.pcWakeTimeout',
  PC_SHUTDOWN_TIMEOUT: 'errors.pcShutdownTimeout',
  PC_REBOOT_OFFLINE_TIMEOUT: 'errors.pcRebootOfflineTimeout',
  PC_REBOOT_ONLINE_TIMEOUT: 'errors.pcRebootOnlineTimeout',
  POWER_ACTION_IN_PROGRESS: 'errors.powerActionInProgress',
  POWER_COMMAND_FAILED: 'errors.powerCommandFailed',
  ROUTER_WOL_FAILED: 'errors.routerWolFailed',
  UNKNOWN: 'errors.unknown',
};

export function mapErrorMessage(code?: string, fallback?: string): UserError {
  void fallback;
  return {
    key: ERROR_MESSAGES[code ?? 'UNKNOWN'] ?? ERROR_MESSAGES.UNKNOWN ?? 'errors.unknown',
  };
}

function extractCauseCode(error: Record<string, unknown>): string | undefined {
  const direct = error.causeCode;
  if (typeof direct === 'string') return direct;
  const data = error.data as Record<string, unknown> | undefined;
  if (data && typeof data.causeCode === 'string') return data.causeCode;
  const details = error.details as Record<string, unknown> | undefined;
  if (details && typeof details.causeCode === 'string') return details.causeCode;
  const nested = (data?.details as Record<string, unknown> | undefined)?.causeCode;
  if (typeof nested === 'string') return nested;
  return undefined;
}

function extractTarget(error: Record<string, unknown>): string | undefined {
  const direct = error.target;
  if (typeof direct === 'string') return direct;
  const data = error.data as Record<string, unknown> | undefined;
  if (data && typeof data.target === 'string') return data.target;
  const details = error.details as Record<string, unknown> | undefined;
  if (details && typeof details.target === 'string') return details.target;
  return undefined;
}

function withMetadata(key: string, code?: string, causeCode?: string): DescribedError {
  const result: DescribedError = { key };
  if (code !== undefined) result.code = code;
  if (causeCode !== undefined) result.causeCode = causeCode;
  return result;
}

export function describeError(error: unknown): DescribedError {
  if (typeof error !== 'object' || error === null) return mapErrorMessage('UNKNOWN');

  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const causeCode = extractCauseCode(candidate);
  const target = extractTarget(candidate);

  if (causeCode === 'AUTH_FAILED') {
    if (code === 'ROUTER_WOL_FAILED' || target === 'router') {
      return withMetadata('errors.routerSshAuthFailed', code, causeCode);
    }
    if (code === 'POWER_COMMAND_FAILED' || target === 'windows') {
      return withMetadata('errors.windowsSshAuthFailed', code, causeCode);
    }
    return withMetadata('errors.authFailed', causeCode, causeCode);
  }

  if (target === 'router' && causeCode === 'HOST_KEY_UNKNOWN') {
    return withMetadata('errors.routerHostKeyUnknown', code, causeCode);
  }
  if (target === 'router' && causeCode === 'HOST_KEY_MISMATCH') {
    return withMetadata('errors.routerHostKeyMismatch', code, causeCode);
  }

  if (causeCode && causeCode !== code && ERROR_MESSAGES[causeCode]) {
    return withMetadata(ERROR_MESSAGES[causeCode], code, causeCode);
  }

  const mapped = mapErrorMessage(code);
  return withMetadata(mapped.key, code, causeCode);
}
