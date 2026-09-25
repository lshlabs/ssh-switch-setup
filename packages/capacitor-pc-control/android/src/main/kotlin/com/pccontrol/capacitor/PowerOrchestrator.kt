package com.pccontrol.capacitor

import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class PowerActionRequest(
    val action: String,
    val pcHost: String,
    val pcPort: Int,
    val pcUsername: String,
    val pcHostFingerprint: String?,
    val routerHost: String?,
    val routerPort: Int?,
    val routerUsername: String,
    val routerHostFingerprint: String?,
    val macAddress: String,
    val wolInterface: String,
    val autoDisconnectVpn: Boolean,
    val initialStatusTimeoutMs: Int,
    val pollIntervalMs: Int,
    val wakeTimeoutMs: Int,
    val shutdownTimeoutMs: Int,
    val rebootOfflineTimeoutMs: Int,
    val rebootOnlineTimeoutMs: Int,
    val connectTimeoutMs: Int,
    val commandTimeoutMs: Int,
    val reachabilityTimeoutMs: Int,
    val postConnectReachabilityTimeoutMs: Int,
    val vpnDisconnectTimeoutMs: Int,
)

data class PowerActionResult(
    val action: String,
    val previousStatus: String,
    val finalStatus: String,
    val networkPath: String,
    val vpnWasStartedByApp: Boolean,
    val vpnDisconnectFailed: Boolean,
    val commandExecuted: Boolean,
    val durationMs: Long,
)

fun interface Sleeper {
    fun sleep(ms: Long)
}

fun interface MonotonicClock {
    fun nanoTime(): Long
}

class ThreadSleeper : Sleeper {
    override fun sleep(ms: Long) = Thread.sleep(ms)
}

class SystemClock : MonotonicClock {
    override fun nanoTime(): Long = System.nanoTime()
}

class PowerOrchestrator(
    private val reachabilityChecker: HostReachabilityChecker,
    private val homeNetworkOrchestrator: HomeNetworkOrchestrator,
    private val sshClient: NativeSshClient,
    private val openVpnClient: OpenVpnExternalApiClient,
    private val pcStatusChecker: PcStatusChecker,
    private val sleeper: Sleeper = ThreadSleeper(),
    private val clock: MonotonicClock = SystemClock(),
) {
    private val lock = Any()
    private val inProgress = AtomicBoolean(false)

    fun run(request: PowerActionRequest): PowerActionResult {
        synchronized(lock) {
            if (inProgress.get()) {
                throw NativeNetworkException(
                    NetworkErrorCode.POWER_ACTION_IN_PROGRESS,
                    "다른 전원 작업이 이미 진행 중입니다.",
                )
            }
            inProgress.set(true)
        }
        // Reset per-run state so a previous exception does not leak stale values.
        lastCommandExecuted = false

        val startedAt = clock.nanoTime()
        var networkPath = "local"
        var vpnWasStartedByApp = false
        var previousStatus = "unknown"
        var commandExecuted = false

        // Track whether we performed ensureHomeNetwork so we know vpn ownership.
        // Ensure cleanup in finally.
        var actionResult: PowerActionResult? = null
        try {
            val network = if (request.routerHost != null && request.routerPort != null) {
                homeNetworkOrchestrator.ensure(
                    HomeNetworkRequest(
                        routerHost = request.routerHost,
                        routerPort = request.routerPort,
                        reachabilityTimeoutMs = request.reachabilityTimeoutMs,
                        connectTimeoutMs = request.connectTimeoutMs,
                        postConnectReachabilityTimeoutMs = request.postConnectReachabilityTimeoutMs,
                    ),
                )
            } else {
                EnsureHomeNetworkResult(path = "local", vpnWasStartedByApp = false)
            }
            networkPath = network.path
            vpnWasStartedByApp = network.vpnWasStartedByApp

            val initial = pcStatusChecker.check(
                request.pcHost,
                request.pcPort,
                request.initialStatusTimeoutMs,
            )
            previousStatus = initial.status

            val finalStatus: String = when (request.action) {
                "power-on" -> handlePowerOn(request, initial)
                "shutdown" -> handleShutdown(request, initial)
                "reboot" -> handleReboot(request, initial)
                else -> throw NativeNetworkException(
                    NetworkErrorCode.POWER_COMMAND_FAILED,
                    "지원하지 않는 power action입니다: ${request.action}",
                    details = mapOf("action" to request.action),
                )
            }

            // commandExecuted is determined inside handlers; for no-op cases we keep false
            // Derive from handler return via mutable flag set inside handlers
            commandExecuted = lastCommandExecuted

            val durationMs = TimeUnit.NANOSECONDS.toMillis(clock.nanoTime() - startedAt)
            actionResult = PowerActionResult(
                action = request.action,
                previousStatus = previousStatus,
                finalStatus = finalStatus,
                networkPath = networkPath,
                vpnWasStartedByApp = vpnWasStartedByApp,
                vpnDisconnectFailed = false,
                commandExecuted = commandExecuted,
                durationMs = durationMs,
            )
        } finally {
            var vpnDisconnectFailed = false
            if (request.autoDisconnectVpn && vpnWasStartedByApp) {
                try {
                    openVpnClient.disconnect(true, request.vpnDisconnectTimeoutMs)
                } catch (_: Exception) {
                    vpnDisconnectFailed = true
                }
            }
            if (vpnDisconnectFailed && actionResult != null) {
                actionResult = actionResult?.copy(vpnDisconnectFailed = true)
            }
            synchronized(lock) {
                inProgress.set(false)
            }
        }
        return actionResult ?: throw IllegalStateException("Power action did not produce a result")
    }

    // Used to communicate commandExecuted from handlers to run()
    @Volatile
    private var lastCommandExecuted: Boolean = false

    private fun handlePowerOn(request: PowerActionRequest, initial: PcStatusResult): String {
        if (initial.reachable) {
            lastCommandExecuted = false
            return "online"
        }
        val routerHost = request.routerHost
            ?: throw NativeNetworkException(
                NetworkErrorCode.POWER_COMMAND_FAILED,
                "Power On에는 공유기 주소가 필요합니다.",
            )
        val routerPort = request.routerPort
            ?: throw NativeNetworkException(
                NetworkErrorCode.POWER_COMMAND_FAILED,
                "Power On에는 공유기 포트가 필요합니다.",
            )
        val wolCommand = "/usr/sbin/ether-wake -i ${request.wolInterface} ${request.macAddress}"
        try {
            sshClient.execute(
                SshCommandRequest(
                    target = "router",
                    host = routerHost,
                    port = routerPort,
                    username = request.routerUsername,
                    command = wolCommand,
                    connectTimeoutMs = request.connectTimeoutMs,
                    commandTimeoutMs = request.commandTimeoutMs,
                    expectedHostFingerprint = request.routerHostFingerprint,
                ),
            )
        } catch (error: NativeSshException) {
            throw NativeNetworkException(
                NetworkErrorCode.ROUTER_WOL_FAILED,
                "WOL 명령 전송에 실패했습니다.",
                error,
                mapOf(
                    "host" to routerHost,
                    "port" to routerPort,
                    "target" to "router",
                    "causeCode" to error.errorCode.name,
                    "causeMessage" to error.message,
                ),
            )
        }
        lastCommandExecuted = true
        val reached = pollUntilReachable(request.pcHost, request.pcPort, request.wakeTimeoutMs, request.pollIntervalMs)
        if (!reached) {
            throw NativeNetworkException(
                NetworkErrorCode.PC_WAKE_TIMEOUT,
                "WOL 전송 후 PC가 온라인이 되지 않았습니다.",
                details = mapOf("host" to request.pcHost, "port" to request.pcPort),
            )
        }
        return "online"
    }

    private fun handleShutdown(request: PowerActionRequest, initial: PcStatusResult): String {
        if (!initial.reachable) {
            lastCommandExecuted = false
            return "offline"
        }
        try {
            sshClient.execute(
                SshCommandRequest(
                    target = "windows",
                    host = request.pcHost,
                    port = request.pcPort,
                    username = request.pcUsername,
                    command = "shutdown /s /t 0",
                    connectTimeoutMs = request.connectTimeoutMs,
                    commandTimeoutMs = request.commandTimeoutMs,
                    expectedHostFingerprint = request.pcHostFingerprint,
                ),
            )
        } catch (error: NativeSshException) {
            throw NativeNetworkException(
                NetworkErrorCode.POWER_COMMAND_FAILED,
                "Shutdown 명령 전송에 실패했습니다.",
                error,
                mapOf(
                    "host" to request.pcHost,
                    "port" to request.pcPort,
                    "target" to "windows",
                    "causeCode" to error.errorCode.name,
                    "causeMessage" to error.message,
                ),
            )
        }
        lastCommandExecuted = true
        val offline = pollUntilUnreachable(request.pcHost, request.pcPort, request.shutdownTimeoutMs, request.pollIntervalMs)
        if (!offline) {
            throw NativeNetworkException(
                NetworkErrorCode.PC_SHUTDOWN_TIMEOUT,
                "Shutdown 명령 후에도 PC가 오프라인이 되지 않았습니다.",
                details = mapOf("host" to request.pcHost, "port" to request.pcPort),
            )
        }
        return "offline"
    }

    private fun handleReboot(request: PowerActionRequest, initial: PcStatusResult): String {
        if (!initial.reachable) {
            throw NativeNetworkException(
                NetworkErrorCode.POWER_COMMAND_FAILED,
                "PC가 오프라인 상태에서 재부팅할 수 없습니다.",
                details = mapOf("host" to request.pcHost, "port" to request.pcPort),
            )
        }
        try {
            sshClient.execute(
                SshCommandRequest(
                    target = "windows",
                    host = request.pcHost,
                    port = request.pcPort,
                    username = request.pcUsername,
                    command = "shutdown /r /t 0",
                    connectTimeoutMs = request.connectTimeoutMs,
                    commandTimeoutMs = request.commandTimeoutMs,
                    expectedHostFingerprint = request.pcHostFingerprint,
                ),
            )
        } catch (error: NativeSshException) {
            throw NativeNetworkException(
                NetworkErrorCode.POWER_COMMAND_FAILED,
                "Reboot 명령 전송에 실패했습니다.",
                error,
                mapOf(
                    "host" to request.pcHost,
                    "port" to request.pcPort,
                    "target" to "windows",
                    "causeCode" to error.errorCode.name,
                    "causeMessage" to error.message,
                ),
            )
        }
        lastCommandExecuted = true
        val wentOffline = pollUntilUnreachable(request.pcHost, request.pcPort, request.rebootOfflineTimeoutMs, request.pollIntervalMs)
        if (!wentOffline) {
            throw NativeNetworkException(
                NetworkErrorCode.PC_REBOOT_OFFLINE_TIMEOUT,
                "Reboot 후 PC가 오프라인 전환되지 않았습니다.",
                details = mapOf("host" to request.pcHost, "port" to request.pcPort),
            )
        }
        val backOnline = pollUntilReachable(request.pcHost, request.pcPort, request.rebootOnlineTimeoutMs, request.pollIntervalMs)
        if (!backOnline) {
            throw NativeNetworkException(
                NetworkErrorCode.PC_REBOOT_ONLINE_TIMEOUT,
                "Reboot 후 PC가 다시 온라인이 되지 않았습니다.",
                details = mapOf("host" to request.pcHost, "port" to request.pcPort),
            )
        }
        return "online"
    }

    private fun pollUntilReachable(host: String, port: Int, totalTimeoutMs: Int, pollIntervalMs: Int): Boolean {
        val deadline = clock.nanoTime() + TimeUnit.MILLISECONDS.toNanos(totalTimeoutMs.toLong())
        while (clock.nanoTime() < deadline) {
            val reachable = reachabilityChecker.check(host, port, POLL_CHECK_TIMEOUT_MS).reachable
            if (reachable) return true
            val remainingNanos = deadline - clock.nanoTime()
            if (remainingNanos <= 0) break
            val sleepMs = minOf(pollIntervalMs.toLong(), TimeUnit.NANOSECONDS.toMillis(remainingNanos).coerceAtLeast(1))
            try {
                sleeper.sleep(sleepMs)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    private fun pollUntilUnreachable(host: String, port: Int, totalTimeoutMs: Int, pollIntervalMs: Int): Boolean {
        val deadline = clock.nanoTime() + TimeUnit.MILLISECONDS.toNanos(totalTimeoutMs.toLong())
        while (clock.nanoTime() < deadline) {
            val reachable = reachabilityChecker.check(host, port, POLL_CHECK_TIMEOUT_MS).reachable
            if (!reachable) return true
            val remainingNanos = deadline - clock.nanoTime()
            if (remainingNanos <= 0) break
            val sleepMs = minOf(pollIntervalMs.toLong(), TimeUnit.NANOSECONDS.toMillis(remainingNanos).coerceAtLeast(1))
            try {
                sleeper.sleep(sleepMs)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    private companion object {
        const val POLL_CHECK_TIMEOUT_MS = 2_000
    }
}
