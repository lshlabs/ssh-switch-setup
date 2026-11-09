package com.pccontrol.capacitor

import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate

class PairingCertificateTrustTest {
    @Test fun acceptsOnlyExactPinnedCertificate() {
        val certificate = mock<X509Certificate>()
        val bytes = "test certificate DER".toByteArray()
        whenever(certificate.encoded).thenReturn(bytes)
        val pin = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        PairingCertificateTrust(pin).checkServerTrusted(arrayOf(certificate), "RSA")
    }
    @Test(expected = CertificateException::class) fun rejectsDifferentCertificate() {
        val certificate = mock<X509Certificate>()
        whenever(certificate.encoded).thenReturn(byteArrayOf(1, 2, 3))
        PairingCertificateTrust("0".repeat(64)).checkServerTrusted(arrayOf(certificate), "RSA")
    }
    @Test(expected = CertificateException::class) fun rejectsMissingCertificate() {
        PairingCertificateTrust("0".repeat(64)).checkServerTrusted(emptyArray(), "RSA")
    }
}
