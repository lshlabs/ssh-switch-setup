package com.pccontrol.capacitor

class HomeNetworkOrchestrator(
    private val reachabilityChecker: HostReachabilityChecker,
    private val openVpnClient: OpenVpnExternalApiClient,
) {
    private val ensureLock = Any()

    fun ensure(request: HomeNetworkRequest): EnsureHomeNetworkResult = synchronized(ensureLock) {
        val initial = reachabilityChecker.check(
            request.routerHost,
            request.routerPort,
            request.reachabilityTimeoutMs,
        )
        if (initial.reachable) {
            // A local path must remain usable even when OpenVPN control permission has
            // not been granted. Status is only needed for ownership reporting here.
            val vpnStatus = if (openVpnClient.isInstalled()) {
                try {
                    openVpnClient.getStatus()
                } catch (_: NativeNetworkException) {
                    null
                }
            } else {
                null
            }
            return@synchronized EnsureHomeNetworkResult(
                path = if (vpnStatus?.status == NativeVpnStatus.CONNECTED) {
                    "vpn"
                } else {
                    "local"
                },
                vpnWasStartedByApp = vpnStatus?.vpnWasStartedByApp ?: false,
            )
        }

        val profileId = openVpnClient.getSelectedProfileId()
            ?: throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_PROFILE_NOT_SELECTED,
                "OpenVPN 프로필을 먼저 선택하세요.",
            )
        val vpnStatus = openVpnClient.connect(profileId, request.connectTimeoutMs)
        if (!waitForRouterAfterVpn(request)) {
            throw NativeNetworkException(
                NetworkErrorCode.HOME_NETWORK_UNAVAILABLE,
                "VPN 연결 후에도 집 Router에 접근할 수 없습니다.",
                details = mapOf("host" to request.routerHost, "port" to request.routerPort),
            )
        }
        EnsureHomeNetworkResult(path = "vpn", vpnWasStartedByApp = vpnStatus.vpnWasStartedByApp)
    }

    private fun waitForRouterAfterVpn(request: HomeNetworkRequest): Boolean {
        return reachabilityChecker.checkUntilReachable(
            request.routerHost,
            request.routerPort,
            RETRY_CONNECT_TIMEOUT_MS,
            request.postConnectReachabilityTimeoutMs,
        ).reachable
    }

    private companion object {
        const val RETRY_CONNECT_TIMEOUT_MS = 1_000
    }
}
