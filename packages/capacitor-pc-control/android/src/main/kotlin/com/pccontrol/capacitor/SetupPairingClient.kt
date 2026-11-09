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
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager

data class SetupDevice(val name: String, val endpoint: String)

/** Pairing-only LAN transport. Normal power operations continue to use SSH. */
class SetupPairingClient(private val context: Context) {
    private val pins = ConcurrentHashMap<String, String>()
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

    fun bootstrap(endpoint: String): JSONObject = throw IllegalStateException("PC 화면의 QR 또는 전체 페어링 JSON으로 서버 인증서를 확인하세요.")

    fun start(endpoint: String, token: String, deviceName: String, publicKey: String, pin: String): JSONObject {
        require(pin.matches(Regex("^[0-9a-f]{64}$"))) { "TLS 인증서 지문이 올바르지 않습니다." }
        require(token.matches(Regex("^[0-9a-f]{64}$"))) { "페어링 토큰이 올바르지 않습니다." }
        pins.clear()
        pins[endpoint] = pin
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
        require(base.protocol == "https" && address is Inet4Address && address.isSiteLocalAddress && base.host == address.hostAddress) {
            "페어링 서버는 현재 네트워크 또는 연결된 VPN에서 접근할 수 있는 사설 주소여야 합니다."
        }
        require(base.port in 1..65535 && base.path.isNullOrEmpty() && base.query == null && base.ref == null && base.userInfo == null) { "페어링 주소가 올바르지 않습니다." }
        val pin = pins[endpoint] ?: throw IllegalStateException("QR 인증서 지문이 없습니다. 다시 페어링하세요.")
        val tls = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(PairingCertificateTrust(pin)), SecureRandom())
        }
        val connection = URL("$endpoint$path").openConnection() as HttpsURLConnection
        connection.sslSocketFactory = tls.socketFactory
        // Keep the platform hostname verifier: IP SAN must match the QR endpoint.
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
            val bytes = connection.inputStream.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(2048)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 32768) { "페어링 응답이 너무 큽니다." }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }
}
