package com.pccontrol.capacitor

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchChangedHostKeyException
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.JSchUnknownHostKeyException
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class NativeSshClient(
    private val identityManager: SshIdentityManager,
    private val trustStore: SshHostTrustStore,
) {
    private val pendingScans = ConcurrentHashMap<String, SshHostKeyInfo>()

    fun getTrustedHostKey(host: String, port: Int): TrustedSshHostKey? =
        trustStore.get(host, port)

    fun scanHostKey(host: String, port: Int, connectTimeoutMs: Int): SshHostKeyInfo {
        val repository = CapturingHostKeyRepository()
        val jsch = JSch().apply { setHostKeyRepository(repository) }
        val session = jsch.getSession(SCAN_USERNAME, host, port)
        configureSession(session)

        try {
            session.connect(connectTimeoutMs)
        } catch (error: JSchException) {
            val observed = repository.observed
            if (observed != null) {
                val trusted = trustStore.get(host, port)
                val result = SshHostKeyInfo(
                    host = host,
                    port = port,
                    algorithm = observed.algorithm,
                    fingerprint = observed.fingerprint,
                    trusted = trusted != null &&
                        trusted.algorithm == observed.algorithm &&
                        SshEncoding.fingerprintsEqual(
                            trusted.fingerprint,
                            observed.fingerprint,
                        ),
                )
                pendingScans[hostKey(host, port)] = result
                return result
            }
            throw mapConnectionError(error, host, port)
        } finally {
            session.disconnect()
        }

        throw NativeSshException(
            SshErrorCode.UNKNOWN,
            "SSH 호스트 키 스캔이 예상과 다르게 인증 단계까지 진행되었습니다.",
            details = hostDetails(host, port),
        )
    }

    fun trustScannedHostKey(
        host: String,
        port: Int,
        algorithm: String,
        fingerprint: String,
    ): SshHostKeyInfo {
        val pending = pendingScans[hostKey(host, port)]
            ?: throw NativeSshException(
                SshErrorCode.HOST_KEY_UNKNOWN,
                "먼저 이 호스트의 키를 다시 스캔하세요.",
                details = hostDetails(host, port),
            )

        if (
            pending.algorithm != algorithm ||
            !SshEncoding.fingerprintsEqual(pending.fingerprint, fingerprint)
        ) {
            throw NativeSshException(
                SshErrorCode.HOST_KEY_MISMATCH,
                "신뢰하려는 지문이 방금 스캔한 호스트 키와 다릅니다.",
                details = hostDetails(host, port) + mapOf(
                    "expectedFingerprint" to pending.fingerprint,
                    "actualFingerprint" to fingerprint,
                ),
            )
        }

        trustStore.put(host, port, algorithm, fingerprint)
        val trusted = pending.copy(trusted = true)
        pendingScans[hostKey(host, port)] = trusted
        return trusted
    }

    fun execute(request: SshCommandRequest): SshCommandResult {
        validateCommand(request.target, request.command)
        val trusted = trustStore.get(request.host, request.port)
            ?: throw NativeSshException(
                SshErrorCode.HOST_KEY_UNKNOWN,
                "저장된 SSH 호스트 키가 없습니다. 먼저 지문을 스캔하고 확인하세요.",
                details = hostDetails(request.host, request.port),
            )

        request.expectedHostFingerprint?.let { expected ->
            if (!SshEncoding.fingerprintsEqual(trusted.fingerprint, expected)) {
                throw NativeSshException(
                    SshErrorCode.HOST_KEY_MISMATCH,
                    "요청한 호스트 지문이 저장된 지문과 다릅니다.",
                    details = hostDetails(request.host, request.port) + mapOf(
                        "expectedFingerprint" to expected,
                        "actualFingerprint" to trusted.fingerprint,
                    ),
                )
            }
        }

        val repository = VerifyingHostKeyRepository(trusted)
        val jsch = JSch().apply {
            setHostKeyRepository(repository)
            addIdentity(identityManager.jschIdentity(), null)
        }
        val session = jsch.getSession(request.username, request.host, request.port)
        configureSession(session)

        try {
            session.connect(request.connectTimeoutMs)
            return executeChannel(session, request)
        } catch (error: NativeSshException) {
            throw error
        } catch (error: JSchChangedHostKeyException) {
            throw hostKeyMismatch(request, trusted.fingerprint, repository.actualFingerprint, error)
        } catch (error: JSchUnknownHostKeyException) {
            throw NativeSshException(
                SshErrorCode.HOST_KEY_UNKNOWN,
                "SSH 서버의 호스트 키를 확인할 수 없습니다.",
                error,
                hostDetails(request.host, request.port),
            )
        } catch (error: JSchException) {
            if (repository.mismatch) {
                throw hostKeyMismatch(
                    request,
                    trusted.fingerprint,
                    repository.actualFingerprint,
                    error,
                )
            }
            throw mapConnectionError(error, request.host, request.port)
        } catch (error: IOException) {
            throw NativeSshException(
                SshErrorCode.IO_ERROR,
                "SSH 명령 결과를 읽는 중 I/O 오류가 발생했습니다.",
                error,
                hostDetails(request.host, request.port),
            )
        } finally {
            session.disconnect()
        }
    }

    private fun executeChannel(session: Session, request: SshCommandRequest): SshCommandResult {
        val stdout = LimitedOutputStream(MAX_OUTPUT_BYTES)
        val stderr = LimitedOutputStream(MAX_OUTPUT_BYTES)
        val channel = session.openChannel("exec") as ChannelExec
        channel.setCommand(request.command)
        channel.setInputStream(null)
        channel.setOutputStream(stdout)
        channel.setErrStream(stderr)

        try {
            channel.connect(request.connectTimeoutMs)
            val deadline = System.nanoTime() +
                TimeUnit.MILLISECONDS.toNanos(request.commandTimeoutMs.toLong())
            while (!channel.isClosed) {
                if (System.nanoTime() >= deadline) {
                    throw NativeSshException(
                        SshErrorCode.COMMAND_TIMEOUT,
                        "SSH 명령 실행 시간이 ${request.commandTimeoutMs}ms를 초과했습니다.",
                        details = hostDetails(request.host, request.port) +
                            mapOf("command" to request.command),
                    )
                }
                Thread.sleep(POLL_INTERVAL_MS)
            }

            val result = SshCommandResult(
                exitCode = channel.exitStatus,
                stdout = stdout.asUtf8(),
                stderr = stderr.asUtf8(),
            )
            if (result.exitCode != 0) {
                throw NativeSshException(
                    SshErrorCode.COMMAND_FAILED,
                    "SSH 명령이 종료 코드 ${result.exitCode}로 실패했습니다.",
                    details = hostDetails(request.host, request.port) + mapOf(
                        "command" to request.command,
                        "exitCode" to result.exitCode,
                        "stdout" to result.stdout,
                        "stderr" to result.stderr,
                    ),
                )
            }
            return result
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw NativeSshException(
                SshErrorCode.COMMAND_TIMEOUT,
                "SSH 명령 실행이 중단되었습니다.",
                error,
                hostDetails(request.host, request.port),
            )
        } finally {
            channel.disconnect()
        }
    }

    private fun configureSession(session: Session) {
        session.setConfig("StrictHostKeyChecking", "yes")
        session.setConfig("PreferredAuthentications", "publickey")
        session.setConfig("server_host_key", SERVER_HOST_KEY_ALGORITHMS)
        session.setConfig("kex", KEY_EXCHANGE_ALGORITHMS)
    }

    private fun validateCommand(target: String, command: String) {
        val allowed = when (target) {
            "windows" -> WINDOWS_COMMANDS
            "router" -> ROUTER_COMMANDS
            else -> emptySet()
        }
        if (command in allowed) return
        if (target == "router" && WOL_COMMAND_PATTERN.matches(command)) return
        throw NativeSshException(
            SshErrorCode.COMMAND_FAILED,
            "현재 단계에서 허용되지 않은 SSH 명령입니다.",
            details = mapOf("target" to target, "command" to command),
        )
    }

    private fun mapConnectionError(error: JSchException, host: String, port: Int): NativeSshException {
        val root = generateSequence<Throwable>(error) { it.cause }.last()
        val message = error.message.orEmpty().lowercase()
        val details = hostDetails(host, port)
        return when {
            root is SocketTimeoutException || message.contains("timeout") -> NativeSshException(
                SshErrorCode.CONNECTION_TIMEOUT,
                "SSH 연결 시간이 초과되었습니다.",
                error,
                details,
            )
            root is ConnectException || root is NoRouteToHostException ||
                root is UnknownHostException || message.contains("connection refused") ->
                NativeSshException(
                    SshErrorCode.HOST_UNREACHABLE,
                    "SSH 호스트에 연결할 수 없습니다.",
                    error,
                    details,
                )
            message.contains("auth fail") || message.contains("userauth fail") ->
                NativeSshException(
                    SshErrorCode.AUTH_FAILED,
                    "SSH 공개키 인증에 실패했습니다.",
                    error,
                    details,
                )
            root is IOException -> NativeSshException(
                SshErrorCode.IO_ERROR,
                "SSH 연결 중 I/O 오류가 발생했습니다.",
                error,
                details,
            )
            else -> NativeSshException(
                SshErrorCode.UNKNOWN,
                "SSH 연결 중 알 수 없는 오류가 발생했습니다.",
                error,
                details,
            )
        }
    }

    private fun hostKeyMismatch(
        request: SshCommandRequest,
        expectedFingerprint: String,
        actualFingerprint: String?,
        cause: Throwable,
    ): NativeSshException = NativeSshException(
        SshErrorCode.HOST_KEY_MISMATCH,
        "SSH 서버의 호스트 키가 저장된 지문과 다릅니다. 연결을 차단했습니다.",
        cause,
        hostDetails(request.host, request.port) + mapOf(
            "expectedFingerprint" to expectedFingerprint,
            "actualFingerprint" to actualFingerprint,
        ),
    )

    private class CapturingHostKeyRepository : EmptyHostKeyRepository() {
        @Volatile
        var observed: ObservedHostKey? = null

        override fun check(host: String, key: ByteArray): Int {
            val hostKey = HostKey(host, key)
            observed = ObservedHostKey(
                algorithm = hostKey.type,
                fingerprint = SshEncoding.sha256Fingerprint(key),
            )
            return HostKeyRepository.NOT_INCLUDED
        }
    }

    private class VerifyingHostKeyRepository(
        private val trusted: TrustedSshHostKey,
    ) : EmptyHostKeyRepository() {
        @Volatile
        var actualFingerprint: String? = null

        @Volatile
        var mismatch = false

        override fun check(host: String, key: ByteArray): Int {
            val hostKey = HostKey(host, key)
            val fingerprint = SshEncoding.sha256Fingerprint(key)
            actualFingerprint = fingerprint
            val matches = hostKey.type == trusted.algorithm &&
                SshEncoding.fingerprintsEqual(fingerprint, trusted.fingerprint)
            mismatch = !matches
            return if (matches) HostKeyRepository.OK else HostKeyRepository.CHANGED
        }
    }

    private open class EmptyHostKeyRepository : HostKeyRepository {
        override fun check(host: String, key: ByteArray): Int = HostKeyRepository.NOT_INCLUDED

        override fun add(hostkey: HostKey, userInfo: UserInfo?) = Unit

        override fun remove(host: String?, type: String?) = Unit

        override fun remove(host: String?, type: String?, key: ByteArray?) = Unit

        override fun getKnownHostsRepositoryID(): String = "pc-control pinned host keys"

        override fun getHostKey(): Array<HostKey> = emptyArray()

        override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
    }

    private class LimitedOutputStream(private val limit: Int) : ByteArrayOutputStream() {
        override fun write(value: Int) {
            if (count < limit) super.write(value)
        }

        override fun write(buffer: ByteArray, offset: Int, length: Int) {
            val remaining = limit - count
            if (remaining > 0) {
                super.write(buffer, offset, minOf(length, remaining))
            }
        }

        fun asUtf8(): String = toString(StandardCharsets.UTF_8.name())
    }

    private data class ObservedHostKey(
        val algorithm: String,
        val fingerprint: String,
    )

    private fun hostKey(host: String, port: Int): String = "${host.trim().lowercase()}:$port"

    private fun hostDetails(host: String, port: Int): Map<String, Any> =
        mapOf("host" to host, "port" to port)

    private companion object {
        const val SCAN_USERNAME = "pc-control-host-key-scan"
        const val MAX_OUTPUT_BYTES = 64 * 1024
        const val POLL_INTERVAL_MS = 50L
        const val SERVER_HOST_KEY_ALGORITHMS =
            "ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256"
        const val KEY_EXCHANGE_ALGORITHMS =
            "ecdh-sha2-nistp256,diffie-hellman-group14-sha256"
        val WINDOWS_COMMANDS = setOf(
            "hostname",
            "whoami",
            "shutdown /s /t 0",
            "shutdown /r /t 0",
        )
        val ROUTER_COMMANDS = setOf(
            "uname -n",
            "printf \"%s\\n\" \"\$USER\"",
            "uname -a",
        )
        private val WOL_COMMAND_PATTERN = Regex(
            """^/usr/sbin/ether-wake -i [a-zA-Z0-9]+ ([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$""",
        )
    }
}
