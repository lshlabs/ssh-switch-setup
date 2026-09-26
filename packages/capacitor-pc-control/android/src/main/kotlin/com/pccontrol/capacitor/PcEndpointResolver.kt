package com.pccontrol.capacitor

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Resolves the saved SSH identity only on currently reachable LAN or VPN routes. */
class PcEndpointResolver(
    private val reachability: HostReachabilityChecker,
    private val ssh: NativeSshClient,
    private val settings: AppSettingsStore,
    private val connectivity: ConnectivityManager?,
    private val routeFilter: ((InetAddress) -> Boolean)? = null,
) {
    private val scanLock = Any()
    private var lastScanAtMs: Long? = null

    fun connectToPC(
        lastKnownIp: String,
        port: Int,
        expectedFingerprint: String?,
        allowScan: Boolean = true,
        persist: Boolean = true,
        scanBudgetMs: Long = 6_000,
        scanCooldownMs: Long = 15_000,
    ): String? {
        if (scanBudgetMs <= 0) return null
        val deadline = monotonicMs() + scanBudgetMs.coerceAtMost(10_000)
        val fingerprint = expectedFingerprint?.takeIf { it.isNotBlank() }
            ?: settings.get()[AppSettingsStore.KEY_PC_HOST_FINGERPRINT]?.toString()?.takeIf { it.isNotBlank() }
        if (reachability.check(lastKnownIp, port,
                minOf(1_200L, (deadline - monotonicMs()).coerceAtLeast(1)).toInt()).reachable) {
            if (fingerprint == null || verifyAndTrust(lastKnownIp, port, fingerprint, true, deadline)) return lastKnownIp
            return null
        }
        if (!allowScan || fingerprint == null || monotonicMs() >= deadline) return null
        val stored = settings.get()
        val hostname = stored[AppSettingsStore.KEY_PC_HOSTNAME]?.toString()?.trim().orEmpty()
        if (hostname.isNotEmpty()) {
            for (name in listOf(hostname, if ('.' in hostname) hostname else "$hostname.local").distinct()) {
                try {
                    val remaining = deadline - monotonicMs()
                    if (remaining <= 0) break
                    val addresses = CompletableFuture.supplyAsync { InetAddress.getAllByName(name) }
                        .get(remaining, TimeUnit.MILLISECONDS)
                    for (address in addresses) {
                        val candidate = address.hostAddress ?: continue
                        if (candidate != lastKnownIp && monotonicMs() < deadline &&
                            onAccessibleRoute(address) && reachability.check(candidate, port,
                                minOf(900L, (deadline - monotonicMs()).coerceAtLeast(1)).toInt()).reachable &&
                            verifyAndTrust(candidate, port, fingerprint, false, deadline)) {
                            if (persist) remember(candidate)
                            return candidate
                        }
                    }
                } catch (_: Exception) { /* DNS may not be available. */ }
            }
        }
        val now = monotonicMs()
        synchronized(scanLock) {
            if (scanCooldownMs > 0 && lastScanAtMs?.let { now - it < scanCooldownMs } == true) return null
            lastScanAtMs = now
        }
        val prefix = (stored[AppSettingsStore.KEY_PC_LAN_PREFIX] as? Number)?.toInt() ?: -1
        val candidates = subnetCandidates(lastKnownIp, prefix).filter { candidate ->
            try { onAccessibleRoute(InetAddress.getByName(candidate)) } catch (_: Exception) { false }
        }
        if (candidates.isEmpty()) return null
        val pool = Executors.newFixedThreadPool(16)
        val completions = ExecutorCompletionService<String?>(pool)
        try {
            candidates.forEach { candidate -> completions.submit {
                if (reachability.check(candidate, port, 700).reachable) candidate else null
            } }
            repeat(candidates.size) {
                val remaining = deadline - monotonicMs()
                if (remaining <= 0) return null
                val result = completions.poll(remaining, TimeUnit.MILLISECONDS) ?: return null
                val candidate = try { result.get() } catch (_: Exception) { null }
                if (candidate != null && monotonicMs() < deadline &&
                    verifyAndTrust(candidate, port, fingerprint, false, deadline)) {
                    if (persist) remember(candidate)
                    return candidate
                }
            }
        } finally { pool.shutdownNow() }
        return null
    }

    private fun onAccessibleRoute(address: InetAddress): Boolean {
        routeFilter?.let { return it(address) }
        if (address !is Inet4Address) return false
        val manager = connectivity ?: return false
        return manager.allNetworks.any { network ->
            val capabilities = manager.getNetworkCapabilities(network) ?: return@any false
            if (!(capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN))) return@any false
            manager.getLinkProperties(network)?.routes?.any { route ->
                (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                    route.destination.prefixLength > 0) &&
                    route.destination.contains(address)
            } == true
        }
    }

    private fun verifyAndTrust(host: String, port: Int, fingerprint: String,
                               mismatchIsError: Boolean, deadline: Long): Boolean {
        val remaining = deadline - monotonicMs()
        if (remaining <= 0) return false
        val scanned = try { ssh.scanHostKey(host, port, minOf(1_500L, remaining).toInt()) }
            catch (_: Exception) { return false }
        if (!SshEncoding.fingerprintsEqual(scanned.fingerprint, fingerprint)) {
            if (mismatchIsError) throw NativeSshException(
                SshErrorCode.HOST_KEY_MISMATCH,
                "PC SSH 호스트 키가 등록된 지문과 다릅니다.",
                details = mapOf("host" to host, "expectedFingerprint" to fingerprint,
                    "actualFingerprint" to scanned.fingerprint),
            )
            return false
        }
        if (!scanned.trusted) ssh.trustScannedHostKey(host, port, scanned.algorithm, scanned.fingerprint)
        return true
    }

    private fun remember(address: String) {
        settings.set(mapOf(AppSettingsStore.KEY_PC_HOST to address))
    }

    private fun monotonicMs(): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())

    private fun subnetCandidates(host: String, prefix: Int): List<String> {
        if (prefix !in 8..30) return emptyList()
        val parts = host.split('.').mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
        if (parts.size != 4) return emptyList()
        val ip = parts.fold(0L) { value, octet -> (value shl 8) or octet.toLong() }
        val mask = (0xffffffffL shl (32 - prefix)) and 0xffffffffL
        val network = ip and mask
        val size = 1L shl (32 - prefix)
        if (size <= 256L) return (1L until size - 1).asSequence()
            .filter { network + it != ip }
            .map { number ->
                val candidate = network + number
                "${(candidate shr 24) and 255}.${(candidate shr 16) and 255}.${(candidate shr 8) and 255}.${candidate and 255}"
            }.toList()
        val offsets = LinkedHashSet<Long>()
        for (distance in 1L..64L) {
            offsets.add(ip - network + distance)
            offsets.add(ip - network - distance)
        }
        val stride = maxOf(1L, size / 128L)
        var value = ip - network
        repeat(128) {
            offsets.add(value)
            value = (value + stride) % size
        }
        return offsets.asSequence().filter { it > 0 && it < size - 1 && network + it != ip }
            .take(256).map { number ->
                val candidate = network + number
                "${(candidate shr 24) and 255}.${(candidate shr 16) and 255}.${(candidate shr 8) and 255}.${candidate and 255}"
            }.toList()
    }
}
