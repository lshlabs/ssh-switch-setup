package com.pccontrol.capacitor

import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

class HostReachabilityChecker {
    fun check(host: String, port: Int, timeoutMs: Int): HostReachabilityResult {
        val startedAt = System.nanoTime()
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
            }
            HostReachabilityResult(
                reachable = true,
                latencyMs = (System.nanoTime() - startedAt) / NANOS_PER_MILLISECOND,
            )
        } catch (_: SocketTimeoutException) {
            HostReachabilityResult(reachable = false, latencyMs = null)
        } catch (_: Exception) {
            HostReachabilityResult(reachable = false, latencyMs = null)
        }
    }

    fun checkUntilReachable(
        host: String,
        port: Int,
        attemptTimeoutMs: Int,
        maxWaitMs: Int,
    ): HostReachabilityResult {
        val deadline = System.nanoTime() + maxWaitMs * NANOS_PER_MILLISECOND
        var lastResult = HostReachabilityResult(reachable = false, latencyMs = null)
        do {
            val remainingMs = ((deadline - System.nanoTime()) / NANOS_PER_MILLISECOND)
                .coerceAtLeast(1)
                .toInt()
            lastResult = check(host, port, minOf(attemptTimeoutMs, remainingMs))
            if (lastResult.reachable) return lastResult

            val sleepMs = minOf(RETRY_DELAY_MS, (deadline - System.nanoTime()) / NANOS_PER_MILLISECOND)
            if (sleepMs > 0) {
                try {
                    Thread.sleep(sleepMs)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return lastResult
                }
            }
        } while (System.nanoTime() < deadline)
        return lastResult
    }

    private companion object {
        const val NANOS_PER_MILLISECOND = 1_000_000L
        const val RETRY_DELAY_MS = 200L
    }
}
