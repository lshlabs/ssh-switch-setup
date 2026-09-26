package com.pccontrol.capacitor

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.Inet4Address
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class SetupDevice(val name: String, val endpoint: String)

/** Pairing-only LAN transport. Normal power operations continue to use SSH. */
class SetupPairingClient(private val context: Context) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    fun discover(timeoutMs: Long = 4_000): List<SetupDevice> {
        val found = CopyOnWriteArrayList<SetupDevice>()
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val multicastLock = wifi.createMulticastLock("pc-control-pairing").apply {
            setReferenceCounted(false)
            acquire()
        }
        val started = CountDownLatch(1)
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) { started.countDown() }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { started.countDown() }
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) = Unit
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val address = (info.host as? Inet4Address)?.hostAddress ?: return
                        if (info.port in 1..65535) {
                            found.addIfAbsent(SetupDevice(info.serviceName, "http://$address:${info.port}"))
                        }
                    }
                })
            }
        }
        try {
            nsd.discoverServices("_pc-control._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
            started.await(1, TimeUnit.SECONDS)
            Thread.sleep(timeoutMs)
        } finally {
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) { /* start may have failed */ }
            if (multicastLock.isHeld) multicastLock.release()
        }
        return found.distinctBy { it.endpoint }
    }

    fun bootstrap(endpoint: String): JSONObject = request(endpoint, "/v1/bootstrap")

    fun start(endpoint: String, token: String, deviceName: String, publicKey: String): JSONObject {
        val secret = ByteArray(32).also(SecureRandom()::nextBytes)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val started = request(endpoint, "/v1/requests", JSONObject().apply {
            put("protocolVersion", 1)
            put("oneTimeToken", token)
            put("deviceName", deviceName)
            put("sshPublicKey", publicKey)
            put("requestSecret", secret)
        })
        return JSONObject().put("started", started).put("requestSecret", secret)
    }

    fun status(endpoint: String, requestId: String, requestSecret: String): JSONObject {
        require(requestId.matches(Regex("^[0-9a-f]{32}$"))) { "잘못된 페어링 요청입니다." }
        return request(endpoint, "/v1/requests/$requestId", requestSecret = requestSecret)
    }

    fun complete(endpoint: String, requestId: String, requestSecret: String, signature: String): JSONObject {
        require(requestId.matches(Regex("^[0-9a-f]{32}$"))) { "잘못된 페어링 요청입니다." }
        return request(endpoint, "/v1/requests/$requestId/complete",
            JSONObject().put("signature", signature), requestSecret)
    }

    fun finalize(endpoint: String, requestId: String, requestSecret: String): JSONObject {
        require(requestId.matches(Regex("^[0-9a-f]{32}$"))) { "잘못된 페어링 요청입니다." }
        return request(endpoint, "/v1/requests/$requestId/finalize", JSONObject(), requestSecret)
    }

    fun cancel(endpoint: String, requestId: String, requestSecret: String): JSONObject {
        require(requestId.matches(Regex("^[0-9a-f]{32}$"))) { "잘못된 페어링 요청입니다." }
        return request(endpoint, "/v1/requests/$requestId/cancel", JSONObject(), requestSecret)
    }

    private fun request(endpoint: String, path: String, body: JSONObject? = null,
                        requestSecret: String? = null): JSONObject {
        val base = URL(endpoint)
        val address = InetAddress.getByName(base.host)
        require(base.protocol == "http" &&
            (address.isSiteLocalAddress || address.isLinkLocalAddress)) {
            "페어링 서버는 같은 네트워크의 사설 주소여야 합니다."
        }
        require(base.port in 1..65535 && base.path.isNullOrEmpty()) { "페어링 주소가 올바르지 않습니다." }
        val connection = URL("$endpoint$path").openConnection() as HttpURLConnection
        connection.connectTimeout = 4_000
        connection.readTimeout = 4_000
        connection.setRequestProperty("Accept", "application/json")
        connection.instanceFollowRedirects = false
        requestSecret?.let { connection.setRequestProperty("X-PC-Control-Request-Secret", it) }
        try {
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("PC 페어링 응답 오류: ${connection.responseCode}")
            }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }
}
