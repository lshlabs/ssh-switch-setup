package com.pccontrol.capacitor

/**
 * Determines PC status using TCP SSH reachability.
 * Does NOT trigger VPN. When home-network availability is provided,
 * unreachable home network is reported as `unknown` rather than `offline`
 * to avoid misinterpreting "cannot reach LAN" as "PC powered off".
 */
class PcStatusChecker(
    private val reachabilityChecker: HostReachabilityChecker,
) {
    fun check(host: String, port: Int, timeoutMs: Int): PcStatusResult {
        val result = reachabilityChecker.check(host, port, timeoutMs)
        val status = if (result.reachable) "online" else "offline"
        return PcStatusResult(
            status = status,
            reachable = result.reachable,
            latencyMs = result.latencyMs,
            reason = if (result.reachable) REASON_REACHABLE else REASON_PC_UNREACHABLE,
        )
    }

    fun checkAfterVpn(
        host: String,
        port: Int,
        timeoutMs: Int,
        maxWaitMs: Int,
        routerHost: String? = null,
        routerPort: Int? = null,
    ): PcStatusResult {
        if (!routerHost.isNullOrBlank() && routerPort != null) {
            val home = reachabilityChecker.checkUntilReachable(
                routerHost,
                routerPort,
                timeoutMs,
                maxWaitMs,
            )
            if (!home.reachable) {
                return PcStatusResult(
                    status = "unknown",
                    reachable = false,
                    latencyMs = null,
                    reason = REASON_NETWORK_UNAVAILABLE,
                )
            }
        }
        val result = reachabilityChecker.checkUntilReachable(host, port, timeoutMs, maxWaitMs)
        val status = if (result.reachable) "online" else "offline"
        return PcStatusResult(
            status = status,
            reachable = result.reachable,
            latencyMs = result.latencyMs,
            reason = if (result.reachable) REASON_REACHABLE else REASON_PC_UNREACHABLE,
        )
    }

    fun checkWithHomeNetwork(
        pcHost: String,
        pcPort: Int,
        pcTimeoutMs: Int,
        routerHost: String?,
        routerPort: Int?,
        routerTimeoutMs: Int = 2_000,
    ): PcStatusResult {
        if (routerHost.isNullOrBlank() || routerPort == null) {
            return check(pcHost, pcPort, pcTimeoutMs)
        }
        val homeAvailable = reachabilityChecker.check(routerHost, routerPort, routerTimeoutMs).reachable
        if (!homeAvailable) {
            return PcStatusResult(
                status = "unknown",
                reachable = false,
                latencyMs = null,
                reason = REASON_NETWORK_UNAVAILABLE,
            )
        }
        val result = reachabilityChecker.check(pcHost, pcPort, pcTimeoutMs)
        val status = if (result.reachable) "online" else "offline"
        return PcStatusResult(
            status = status,
            reachable = result.reachable,
            latencyMs = result.latencyMs,
            reason = if (result.reachable) REASON_REACHABLE else REASON_PC_UNREACHABLE,
        )
    }

    private companion object {
        const val REASON_REACHABLE = "reachable"
        const val REASON_PC_UNREACHABLE = "pc-unreachable"
        const val REASON_NETWORK_UNAVAILABLE = "network-unavailable"
    }
}

data class PcStatusResult(
    val status: String,
    val reachable: Boolean,
    val latencyMs: Long?,
    val reason: String = "pc-unreachable",
)
