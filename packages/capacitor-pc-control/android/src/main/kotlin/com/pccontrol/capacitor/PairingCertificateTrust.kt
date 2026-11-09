package com.pccontrol.capacitor

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

/** Trust only the exact short-lived certificate scanned from the Windows screen. */
class PairingCertificateTrust(private val expectedHex: String) : X509TrustManager {
    init { require(expectedHex.matches(Regex("^[0-9a-f]{64}$"))) }
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not accepted")
    }
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("Missing TLS certificate")
        leaf.checkValidity()
        val expected = expectedHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val actual = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
        if (!MessageDigest.isEqual(expected, actual)) throw CertificateException("QR TLS certificate mismatch")
    }
}
