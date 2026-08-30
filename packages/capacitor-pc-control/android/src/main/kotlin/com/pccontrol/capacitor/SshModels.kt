package com.pccontrol.capacitor

internal enum class SshErrorCode {
    IDENTITY_NOT_AVAILABLE,
    HOST_UNREACHABLE,
    CONNECTION_TIMEOUT,
    HOST_KEY_UNKNOWN,
    HOST_KEY_MISMATCH,
    AUTH_FAILED,
    COMMAND_TIMEOUT,
    COMMAND_FAILED,
    IO_ERROR,
    UNKNOWN,
}

internal class NativeSshException(
    val errorCode: SshErrorCode,
    override val message: String,
    cause: Throwable? = null,
    val details: Map<String, Any?> = emptyMap(),
) : Exception(message, cause)

internal data class SshIdentityInfo(
    val algorithm: String,
    val publicKey: String,
    val fingerprint: String,
    val created: Boolean,
)

internal data class SshHostKeyInfo(
    val host: String,
    val port: Int,
    val algorithm: String,
    val fingerprint: String,
    val trusted: Boolean,
)

internal data class TrustedSshHostKey(
    val algorithm: String,
    val fingerprint: String,
)

internal data class SshCommandRequest(
    val target: String,
    val host: String,
    val port: Int,
    val username: String,
    val command: String,
    val connectTimeoutMs: Int,
    val commandTimeoutMs: Int,
    val expectedHostFingerprint: String?,
)

internal data class SshCommandResult(
    val exitCode: Int,
    val stdout: String,
    val stderr: String,
)
