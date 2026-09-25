package com.pccontrol.capacitor

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.jcraft.jsch.Identity
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.RSAPublicKey

class SshIdentityManager {
    private val lock = Any()

    fun getIdentity(): SshIdentityInfo? = synchronized(lock) {
        val keyStore = loadKeyStore()
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            return null
        }

        return identityInfo(keyStore, created = false)
    }

    fun ensureIdentity(): SshIdentityInfo = synchronized(lock) {
        val keyStore = loadKeyStore()
        val created = !keyStore.containsAlias(KEY_ALIAS)
        if (created) {
            generateKeyPair()
            keyStore.load(null)
        }

        verifyKeyPair(keyStore)
        return identityInfo(keyStore, created)
    }

    fun jschIdentity(): Identity {
        val keyStore = loadKeyStore()
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "앱 전용 SSH 키가 없습니다. 먼저 SSH identity를 생성하세요.",
            )
        }

        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "Android Keystore에서 SSH 개인키를 열 수 없습니다.",
            )
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey as? RSAPublicKey
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "Android Keystore에서 SSH 공개키를 열 수 없습니다.",
            )

        return AndroidKeystoreRsaIdentity(
            privateKey,
            SshEncoding.rsaPublicKeyBlob(publicKey.publicExponent, publicKey.modulus),
        )
    }

    private fun identityInfo(keyStore: KeyStore, created: Boolean): SshIdentityInfo {
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey as? RSAPublicKey
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "Android Keystore의 SSH 공개키 형식이 올바르지 않습니다.",
            )
        val blob = SshEncoding.rsaPublicKeyBlob(publicKey.publicExponent, publicKey.modulus)
        return SshIdentityInfo(
            algorithm = SshEncoding.ALGORITHM,
            publicKey = SshEncoding.openSshPublicKey(blob),
            fingerprint = SshEncoding.sha256Fingerprint(blob),
            created = created,
        )
    }

    private fun generateKeyPair() {
        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA,
            ANDROID_KEYSTORE,
        )
        generator.initialize(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                .setKeySize(KEY_SIZE_BITS)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA512)
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun verifyKeyPair(keyStore: KeyStore) {
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "생성한 SSH 개인키를 Android Keystore에서 열 수 없습니다.",
            )
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "생성한 SSH 공개키를 Android Keystore에서 열 수 없습니다.",
            )
        val challenge = ByteArray(SELF_TEST_BYTES).also(SecureRandom()::nextBytes)
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(privateKey)
            update(challenge)
            sign()
        }
        val verified = Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey)
            update(challenge)
            verify(signature)
        }
        if (!verified) {
            throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "Android Keystore SSH identity 자체 검증에 실패했습니다.",
            )
        }
    }

    private fun loadKeyStore(): KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private class AndroidKeystoreRsaIdentity(
        private val privateKey: PrivateKey,
        private val publicKeyBlob: ByteArray,
    ) : Identity {
        override fun setPassphrase(passphrase: ByteArray?): Boolean = true

        override fun getPublicKeyBlob(): ByteArray = publicKeyBlob.copyOf()

        override fun getSignature(data: ByteArray): ByteArray? =
            getSignature(data, "rsa-sha2-256")

        override fun getSignature(data: ByteArray, algorithm: String): ByteArray? {
            val javaAlgorithm = when (algorithm) {
                "rsa-sha2-256" -> "SHA256withRSA"
                "rsa-sha2-512" -> "SHA512withRSA"
                else -> return null
            }
            return try {
                val rawSignature = Signature.getInstance(javaAlgorithm).run {
                    initSign(privateKey)
                    update(data)
                    sign()
                }
                SshEncoding.signatureBlob(algorithm, rawSignature)
            } catch (_: Exception) {
                null
            }
        }

        override fun getAlgName(): String = SshEncoding.ALGORITHM

        override fun getName(): String = KEY_ALIAS

        override fun isEncrypted(): Boolean = false

        override fun clear() {
            // The non-exportable private key remains owned by Android Keystore.
        }
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        // DO NOT RENAME — changing this alias invalidates all registered authorized_keys
        const val KEY_ALIAS = "pc-control.ssh.identity.v1"
        const val KEY_SIZE_BITS = 3072
        const val SELF_TEST_BYTES = 32
    }
}
