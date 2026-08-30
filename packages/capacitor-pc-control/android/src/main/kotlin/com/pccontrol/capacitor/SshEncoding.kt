package com.pccontrol.capacitor

import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.math.BigInteger
import java.security.MessageDigest

internal object SshEncoding {
    fun rsaPublicKeyBlob(exponent: BigInteger, modulus: BigInteger): ByteArray =
        ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { output ->
                output.writeSshString(ALGORITHM.toByteArray(Charsets.US_ASCII))
                output.writeSshString(exponent.toByteArray())
                output.writeSshString(modulus.toByteArray())
            }
            bytes.toByteArray()
        }

    fun signatureBlob(algorithm: String, signature: ByteArray): ByteArray =
        ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { output ->
                output.writeSshString(algorithm.toByteArray(Charsets.US_ASCII))
                output.writeSshString(signature)
            }
            bytes.toByteArray()
        }

    fun openSshPublicKey(blob: ByteArray): String =
        "$ALGORITHM ${Base64.encodeToString(blob, Base64.NO_WRAP)} $COMMENT"

    fun sha256Fingerprint(blob: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(blob)
        return "SHA256:${Base64.encodeToString(digest, Base64.NO_WRAP or Base64.NO_PADDING)}"
    }

    fun fingerprintsEqual(first: String, second: String): Boolean =
        MessageDigest.isEqual(
            first.trim().toByteArray(Charsets.US_ASCII),
            second.trim().toByteArray(Charsets.US_ASCII),
        )

    private fun DataOutputStream.writeSshString(value: ByteArray) {
        writeInt(value.size)
        write(value)
    }

    const val ALGORITHM = "ssh-rsa"
    private const val COMMENT = "pc-control@android"
}
