package com.pccontrol.capacitor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(name = "PcControl")
class PcControlPlugin : Plugin() {
    private lateinit var identityManager: SshIdentityManager
    private lateinit var sshClient: NativeSshClient
    private lateinit var executor: ExecutorService

    override fun load() {
        val appContext = context.applicationContext
        identityManager = SshIdentityManager()
        sshClient = NativeSshClient(identityManager, SshHostTrustStore(appContext))
        executor = Executors.newFixedThreadPool(2)
    }

    override fun handleOnDestroy() {
        if (::executor.isInitialized) {
            executor.shutdownNow()
        }
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getBridgeStatus(call: PluginCall) {
        val result = JSObject().apply {
            put("native", true)
            put("platform", "android")
        }

        call.resolve(result)
    }

    @PluginMethod
    fun getNetworkState(call: PluginCall) = notImplemented(call, "getNetworkState")

    @PluginMethod
    fun checkHost(call: PluginCall) = notImplemented(call, "checkHost")

    @PluginMethod
    fun getSshIdentity(call: PluginCall) = runAsync(call) {
        val identity = identityManager.getIdentity()
        JSObject().apply {
            put("available", identity != null)
            identity?.let { putIdentity(this, it) }
        }
    }

    @PluginMethod
    fun ensureSshIdentity(call: PluginCall) = runAsync(call) {
        JSObject().apply {
            put("available", true)
            putIdentity(this, identityManager.ensureIdentity())
        }
    }

    @PluginMethod
    fun copySshPublicKey(call: PluginCall) = runAsync(call) {
        val identity = identityManager.getIdentity()
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "복사할 SSH 공개키가 없습니다. 먼저 identity를 생성하세요.",
            )
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("PC Control SSH public key", identity.publicKey))
        JSObject()
    }

    @PluginMethod
    fun scanSshHostKey(call: PluginCall) {
        val options = parseHostOptions(call) ?: return
        runAsync(call) {
            hostKeyResult(
                sshClient.scanHostKey(
                    options.host,
                    options.port,
                    options.connectTimeoutMs,
                ),
            )
        }
    }

    @PluginMethod
    fun trustSshHostKey(call: PluginCall) {
        val options = parseHostOptions(call) ?: return
        val algorithm = requireString(call, "algorithm") ?: return
        val fingerprint = requireString(call, "fingerprint") ?: return
        runAsync(call) {
            hostKeyResult(
                sshClient.trustScannedHostKey(
                    options.host,
                    options.port,
                    algorithm,
                    fingerprint,
                ),
            )
        }
    }

    @PluginMethod
    fun getTrustedSshHostKey(call: PluginCall) {
        val options = parseHostOptions(call) ?: return
        runAsync(call) {
            val trusted = sshClient.getTrustedHostKey(options.host, options.port)
            JSObject().apply {
                put("host", options.host)
                put("port", options.port)
                put("trusted", trusted != null)
                trusted?.let {
                    put("algorithm", it.algorithm)
                    put("fingerprint", it.fingerprint)
                }
            }
        }
    }

    @PluginMethod
    fun executeSshCommand(call: PluginCall) {
        val target = requireString(call, "target") ?: return
        val host = requireString(call, "host") ?: return
        val username = requireString(call, "username") ?: return
        val command = requireString(call, "command") ?: return
        val port = parsePort(call) ?: return
        val connectTimeout = parseTimeout(call, "connectTimeoutMs", DEFAULT_CONNECT_TIMEOUT_MS)
            ?: return
        val commandTimeout = parseTimeout(call, "commandTimeoutMs", DEFAULT_COMMAND_TIMEOUT_MS)
            ?: return
        val expectedHostFingerprint = call.getString("expectedHostFingerprint")

        runAsync(call) {
            val result = sshClient.execute(
                SshCommandRequest(
                    target = target,
                    host = host,
                    port = port,
                    username = username,
                    command = command,
                    connectTimeoutMs = connectTimeout,
                    commandTimeoutMs = commandTimeout,
                    expectedHostFingerprint = expectedHostFingerprint,
                ),
            )
            JSObject().apply {
                put("exitCode", result.exitCode)
                put("stdout", result.stdout)
                put("stderr", result.stderr)
            }
        }
    }

    @PluginMethod
    fun getOpenVpnProfiles(call: PluginCall) = notImplemented(call, "getOpenVpnProfiles")

    @PluginMethod
    fun connectOpenVpn(call: PluginCall) = notImplemented(call, "connectOpenVpn")

    @PluginMethod
    fun disconnectOpenVpn(call: PluginCall) = notImplemented(call, "disconnectOpenVpn")

    @PluginMethod
    fun getOpenVpnStatus(call: PluginCall) = notImplemented(call, "getOpenVpnStatus")

    private fun notImplemented(call: PluginCall, method: String) {
        call.unimplemented("$method is planned for the next native implementation phase.")
    }

    private fun runAsync(call: PluginCall, operation: () -> JSObject) {
        executor.execute {
            try {
                call.resolve(operation())
            } catch (error: NativeSshException) {
                val details = JSObject()
                error.details.forEach { (key, value) ->
                    if (value != null) details.put(key, value)
                }
                call.reject(error.message, error.errorCode.name, error, details)
            } catch (error: Exception) {
                call.reject(
                    "네이티브 SSH 처리 중 알 수 없는 오류가 발생했습니다.",
                    SshErrorCode.UNKNOWN.name,
                    error,
                )
            }
        }
    }

    private fun putIdentity(target: JSObject, identity: SshIdentityInfo) {
        target.put("algorithm", identity.algorithm)
        target.put("publicKey", identity.publicKey)
        target.put("fingerprint", identity.fingerprint)
        target.put("created", identity.created)
    }

    private fun hostKeyResult(hostKey: SshHostKeyInfo): JSObject = JSObject().apply {
        put("host", hostKey.host)
        put("port", hostKey.port)
        put("algorithm", hostKey.algorithm)
        put("fingerprint", hostKey.fingerprint)
        put("trusted", hostKey.trusted)
    }

    private fun parseHostOptions(call: PluginCall): ParsedHostOptions? {
        val host = requireString(call, "host") ?: return null
        val port = parsePort(call) ?: return null
        val connectTimeout = parseTimeout(call, "connectTimeoutMs", DEFAULT_CONNECT_TIMEOUT_MS)
            ?: return null
        return ParsedHostOptions(host, port, connectTimeout)
    }

    private fun requireString(call: PluginCall, name: String): String? {
        val value = call.getString(name)?.trim()
        if (value.isNullOrEmpty()) {
            call.reject("$name 값이 필요합니다.", SshErrorCode.UNKNOWN.name)
            return null
        }
        return value
    }

    private fun parsePort(call: PluginCall): Int? {
        val value = call.getInt("port", DEFAULT_SSH_PORT)
        if (value == null || value !in 1..65535) {
            call.reject("port는 1~65535 범위여야 합니다.", SshErrorCode.UNKNOWN.name)
            return null
        }
        return value
    }

    private fun parseTimeout(call: PluginCall, name: String, defaultValue: Int): Int? {
        val value = call.getInt(name, defaultValue)
        if (value == null || value !in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) {
            call.reject(
                "$name 값은 ${MIN_TIMEOUT_MS}~${MAX_TIMEOUT_MS}ms 범위여야 합니다.",
                SshErrorCode.UNKNOWN.name,
            )
            return null
        }
        return value
    }

    private data class ParsedHostOptions(
        val host: String,
        val port: Int,
        val connectTimeoutMs: Int,
    )

    private companion object {
        const val DEFAULT_SSH_PORT = 22
        const val DEFAULT_CONNECT_TIMEOUT_MS = 8_000
        const val DEFAULT_COMMAND_TIMEOUT_MS = 8_000
        const val MIN_TIMEOUT_MS = 1_000
        const val MAX_TIMEOUT_MS = 30_000
    }
}
