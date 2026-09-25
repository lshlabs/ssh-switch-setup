package com.pccontrol.capacitor

enum class NetworkErrorCode {
    OPENVPN_APP_NOT_INSTALLED,
    OPENVPN_SERVICE_BIND_FAILED,
    OPENVPN_CONTROL_PERMISSION_REQUIRED,
    OPENVPN_CONTROL_PERMISSION_DENIED,
    OPENVPN_PROFILE_NOT_SELECTED,
    OPENVPN_PROFILE_NOT_FOUND,
    OPENVPN_CONNECT_FAILED,
    OPENVPN_CONNECT_TIMEOUT,
    OPENVPN_DISCONNECT_FAILED,
    OPENVPN_STATUS_UNAVAILABLE,
    HOST_UNREACHABLE,
    REACHABILITY_TIMEOUT,
    HOME_NETWORK_UNAVAILABLE,
    PC_STATUS_CHECK_FAILED,
    PC_WAKE_TIMEOUT,
    PC_SHUTDOWN_TIMEOUT,
    PC_REBOOT_OFFLINE_TIMEOUT,
    PC_REBOOT_ONLINE_TIMEOUT,
    POWER_ACTION_IN_PROGRESS,
    POWER_COMMAND_FAILED,
    ROUTER_WOL_FAILED,
    UNKNOWN,
}

class NativeNetworkException(
    val errorCode: NetworkErrorCode,
    override val message: String,
    cause: Throwable? = null,
    val details: Map<String, Any?> = emptyMap(),
) : Exception(message, cause)

enum class NativeVpnStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    DISCONNECTING,
    ERROR,
}

data class NativeOpenVpnProfile(
    val id: String,
    val name: String,
)

data class NativeOpenVpnStatus(
    val status: NativeVpnStatus,
    val profileId: String?,
    val vpnWasStartedByApp: Boolean,
)

data class HostReachabilityResult(
    val reachable: Boolean,
    val latencyMs: Long?,
)

data class HomeNetworkRequest(
    val routerHost: String,
    val routerPort: Int,
    val reachabilityTimeoutMs: Int,
    val connectTimeoutMs: Int,
    val postConnectReachabilityTimeoutMs: Int,
)

data class EnsureHomeNetworkResult(
    val path: String,
    val vpnWasStartedByApp: Boolean,
)
