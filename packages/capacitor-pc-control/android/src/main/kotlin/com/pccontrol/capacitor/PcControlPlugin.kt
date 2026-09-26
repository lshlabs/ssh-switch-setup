package com.pccontrol.capacitor

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import android.widget.Toast
import android.app.Activity
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(
    name = "PcControl",
    permissions = [
        Permission(
            alias = "wifiSsid",
            strings = [Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION],
        ),
    ],
)
class PcControlPlugin : Plugin() {
    private lateinit var identityManager: SshIdentityManager
    private lateinit var sshClient: NativeSshClient
    private lateinit var openVpnClient: OpenVpnExternalApiClient
    private lateinit var reachabilityChecker: HostReachabilityChecker
    private lateinit var homeNetworkOrchestrator: HomeNetworkOrchestrator
    private lateinit var pcStatusChecker: PcStatusChecker
    private lateinit var powerOrchestrator: PowerOrchestrator
    private lateinit var endpointResolver: PcEndpointResolver
    private lateinit var appSettingsStore: AppSettingsStore
    private lateinit var setupPairingClient: SetupPairingClient
    private lateinit var executor: ExecutorService
    private val pendingOpenVpnOperations = ConcurrentHashMap<String, () -> JSObject>()
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun load() {
        val appContext = context.applicationContext
        identityManager = SshIdentityManager()
        sshClient = NativeSshClient(identityManager, SshHostTrustStore(appContext))
        openVpnClient = OpenVpnExternalApiClient(appContext)
        reachabilityChecker = HostReachabilityChecker()
        homeNetworkOrchestrator = HomeNetworkOrchestrator(reachabilityChecker, openVpnClient)
        pcStatusChecker = PcStatusChecker(reachabilityChecker)
        appSettingsStore = AppSettingsStore(appContext)
        connectivityManager = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        endpointResolver = PcEndpointResolver(reachabilityChecker, sshClient, appSettingsStore, connectivityManager)
        powerOrchestrator = PowerOrchestrator(
            reachabilityChecker = reachabilityChecker,
            homeNetworkOrchestrator = homeNetworkOrchestrator,
            sshClient = sshClient,
            openVpnClient = openVpnClient,
            pcStatusChecker = pcStatusChecker,
            endpointResolver = endpointResolver,
        )
        setupPairingClient = SetupPairingClient(appContext)
        executor = Executors.newFixedThreadPool(3)
        registerNetworkCallback()
    }

    override fun handleOnDestroy() {
        unregisterNetworkCallback()
        if (::openVpnClient.isInitialized) {
            openVpnClient.close()
        }
        pendingOpenVpnOperations.clear()
        if (::executor.isInitialized) {
            executor.shutdownNow()
        }
        super.handleOnDestroy()
    }

    private fun registerNetworkCallback() {
        val manager = connectivityManager ?: return
        if (networkCallback != null) return

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                notifyNetworkChange("available")
            }

            override fun onLost(network: Network) {
                notifyNetworkChange("lost")
            }

            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                notifyNetworkChange("capabilities-changed")
            }

            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
                notifyNetworkChange("link-properties-changed")
            }
        }

        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (error: RuntimeException) {
            Log.w(TAG, "Unable to register the network callback", error)
        }
    }

    private fun unregisterNetworkCallback() {
        val manager = connectivityManager
        val callback = networkCallback ?: return
        networkCallback = null
        if (manager == null) return

        try {
            manager.unregisterNetworkCallback(callback)
        } catch (error: RuntimeException) {
            Log.w(TAG, "Unable to unregister the network callback", error)
        }
    }

    private fun notifyNetworkChange(reason: String) {
        notifyListeners("networkChange", JSObject().apply { put("reason", reason) })
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
    fun getNetworkState(call: PluginCall) {
        val options = parseHomeNetworkRequest(call) ?: return
        runAsync(call) {
            val vpnConnected = openVpnClient.isInstalled() &&
                openVpnClient.getStatus().status == NativeVpnStatus.CONNECTED
            val reachable = if (vpnConnected) {
                reachabilityChecker.checkUntilReachable(
                    options.routerHost,
                    options.routerPort,
                    options.reachabilityTimeoutMs,
                    DEFAULT_POST_CONNECT_REACHABILITY_TIMEOUT_MS,
                ).reachable
            } else {
                reachabilityChecker.check(
                    options.routerHost,
                    options.routerPort,
                    options.reachabilityTimeoutMs,
                ).reachable
            }
            val wifiSsid = if (reachable && !vpnConnected) readWifiSsid() else null
            JSObject().apply {
                put("state", when {
                    !reachable -> "unavailable"
                    vpnConnected -> "vpn"
                    else -> "local"
                })
                wifiSsid?.let { put("ssid", it) }
            }
        }
    }

    @PluginMethod
    fun requestNetworkSsidPermission(call: PluginCall) {
        if (hasWifiSsidPermission()) {
            call.resolve(networkSsidPermissionResult())
            return
        }
        requestPermissionForAlias("wifiSsid", call, "networkSsidPermissionCallback")
    }

    @PermissionCallback
    fun networkSsidPermissionCallback(call: PluginCall) {
        call.resolve(networkSsidPermissionResult())
    }

    private fun networkSsidPermissionResult(): JSObject = JSObject().apply {
        put("granted", hasWifiSsidPermission())
    }

    private fun hasWifiSsidPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun readWifiSsid(): String? {
        if (!hasWifiSsidPermission()) return null
        val wifiManager = context.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
        val rawSsid = wifiManager.connectionInfo?.ssid ?: return null
        val ssid = rawSsid.trim().removeSurrounding("\"")
        return ssid.takeUnless { it.isBlank() || it == WifiManager.UNKNOWN_SSID || it == "<unknown ssid>" }
    }

    @PluginMethod
    fun checkHost(call: PluginCall) {
        val host = requireString(call, "host") ?: return
        val port = parsePort(call) ?: return
        val timeout = parseTimeout(call, "timeoutMs", DEFAULT_REACHABILITY_TIMEOUT_MS) ?: return
        runAsync(call) {
            val result = reachabilityChecker.check(host, port, timeout)
            JSObject().apply {
                put("reachable", result.reachable)
                result.latencyMs?.let { put("latencyMs", it) }
            }
        }
    }

    @PluginMethod
    fun discoverSetupDevices(call: PluginCall) = runAsync(call) {
        JSObject().apply {
            put("devices", JSArray().apply {
                setupPairingClient.discover().forEach { device ->
                    put(JSObject().apply {
                        put("name", device.name)
                        put("endpoint", device.endpoint)
                    })
                }
            })
        }
    }

    @PluginMethod
    fun getSetupBootstrap(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        runAsync(call) { JSObject().apply { put("bootstrap", setupPairingClient.bootstrap(endpoint)) } }
    }

    @PluginMethod
    fun startSetupPairing(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        val token = requireString(call, "oneTimeToken") ?: return
        val deviceName = requireString(call, "deviceName") ?: return
        runAsync(call) {
            val publicKey = identityManager.ensureIdentity().publicKey
            val result = setupPairingClient.start(endpoint, token, deviceName, publicKey)
            JSObject().apply {
                put("started", result.getJSONObject("started"))
                put("requestSecret", result.getString("requestSecret"))
            }
        }
    }

    @PluginMethod
    fun getSetupPairingStatus(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        val requestId = requireString(call, "requestId") ?: return
        val requestSecret = requireString(call, "requestSecret") ?: return
        runAsync(call) { JSObject().apply { put("status", setupPairingClient.status(endpoint, requestId, requestSecret)) } }
    }

    @PluginMethod
    fun completeSetupPairing(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        val requestId = requireString(call, "requestId") ?: return
        val requestSecret = requireString(call, "requestSecret") ?: return
        val challenge = requireString(call, "challenge") ?: return
        runAsync(call) {
            val signature = identityManager.signPairingCompletion(requestId, challenge)
            JSObject().apply {
                put("result", setupPairingClient.complete(endpoint, requestId, requestSecret, signature))
            }
        }
    }

    @PluginMethod
    fun finalizeSetupPairing(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        val requestId = requireString(call, "requestId") ?: return
        val requestSecret = requireString(call, "requestSecret") ?: return
        runAsync(call) { JSObject().apply {
            put("result", setupPairingClient.finalize(endpoint, requestId, requestSecret))
        } }
    }

    @PluginMethod
    fun cancelSetupPairing(call: PluginCall) {
        val endpoint = requireString(call, "endpoint") ?: return
        val requestId = requireString(call, "requestId") ?: return
        val requestSecret = requireString(call, "requestSecret") ?: return
        runAsync(call) { JSObject().apply {
            put("result", setupPairingClient.cancel(endpoint, requestId, requestSecret))
        } }
    }

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
    fun copySshFingerprint(call: PluginCall) = runAsync(call) {
        val identity = identityManager.getIdentity()
            ?: throw NativeSshException(
                SshErrorCode.IDENTITY_NOT_AVAILABLE,
                "복사할 SSH 공개키 지문이 없습니다. 먼저 identity를 생성하세요.",
            )
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(
            ClipData.newPlainText("PC Control SSH public key fingerprint", identity.fingerprint),
        )
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
        val temporaryAlgorithm = call.getString("temporaryHostKeyAlgorithm")
        val temporaryFingerprint = call.getString("temporaryHostKeyFingerprint")

        runAsync(call) {
            val resolvedHost = if (target == "windows" && temporaryAlgorithm == null) {
                endpointResolver.connectToPC(host, port, expectedHostFingerprint) ?: host
            } else host
            val result = sshClient.execute(
                SshCommandRequest(
                    target = target,
                    host = resolvedHost,
                    port = port,
                    username = username,
                    command = command,
                    connectTimeoutMs = connectTimeout,
                    commandTimeoutMs = commandTimeout,
                    expectedHostFingerprint = expectedHostFingerprint,
                    temporaryHostKey = if (temporaryAlgorithm != null && temporaryFingerprint != null)
                        TrustedSshHostKey(temporaryAlgorithm, temporaryFingerprint) else null,
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
    fun executeEnsuredSshCommand(call: PluginCall) {
        val target = requireString(call, "target") ?: return
        val host = requireString(call, "host") ?: return
        val username = requireString(call, "username") ?: return
        val command = requireString(call, "command") ?: return
        val port = parsePort(call) ?: return
        val connectTimeout = parseTimeout(call, "connectTimeoutMs", DEFAULT_CONNECT_TIMEOUT_MS)
            ?: return
        val commandTimeout = parseTimeout(call, "commandTimeoutMs", DEFAULT_COMMAND_TIMEOUT_MS)
            ?: return
        val homeRequest = parseHomeNetworkRequest(call) ?: return
        val expectedHostFingerprint = call.getString("expectedHostFingerprint")

        runOpenVpnOperation(call) {
            val network = homeNetworkOrchestrator.ensure(homeRequest)
            val resolvedHost = if (target == "windows") {
                endpointResolver.connectToPC(host, port, expectedHostFingerprint) ?: host
            } else host
            val result = sshClient.execute(
                SshCommandRequest(
                    target = target,
                    host = resolvedHost,
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
                put("networkPath", network.path)
                put("vpnWasStartedByApp", network.vpnWasStartedByApp)
            }
        }
    }

    @PluginMethod
    fun isOpenVpnInstalled(call: PluginCall) {
        call.resolve(JSObject().apply { put("installed", openVpnClient.isInstalled()) })
    }

    @PluginMethod
    fun openOpenVpnApp(call: PluginCall) {
        val installed = openVpnClient.isInstalled()
        bridge.executeOnMainThread {
            try {
                val appIntent = if (installed) openVpnClient.appLaunchIntent() else null
                val intent = appIntent ?: openVpnClient.playStoreIntent()
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val destination = if (appIntent != null) "app" else "play-store"
                try {
                    context.startActivity(intent)
                } catch (_: Exception) {
                    if (appIntent != null) throw IllegalStateException("OpenVPN for Android 앱을 열 수 없습니다.")
                    val webIntent = openVpnClient.playStoreWebIntent().apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(webIntent)
                }
                call.resolve(JSObject().apply { put("destination", destination) })
            } catch (error: Exception) {
                call.reject(
                    "OpenVPN for Android 또는 Play Store를 열 수 없습니다.",
                    NetworkErrorCode.UNKNOWN.name,
                    error,
                )
            }
        }
    }

    @PluginMethod
    fun prepareOpenVpnControl(call: PluginCall) {
        runOpenVpnOperation(call) {
            JSObject().apply { put("installed", true) }
        }
    }

    @PluginMethod
    fun getOpenVpnProfiles(call: PluginCall) {
        runAsync(call) {
            openVpnProfilesResult()
        }
    }

    @PluginMethod
    fun selectOpenVpnProfile(call: PluginCall) {
        val profileId = requireString(call, "profileId") ?: return
        runAsync(call) {
            openVpnClient.selectProfileReadOnly(profileId)
            openVpnProfilesResult()
        }
    }

    @PluginMethod
    fun clearOpenVpnProfileSelection(call: PluginCall) {
        openVpnClient.clearSelectedProfile()
        call.resolve()
    }

    @PluginMethod
    fun getOpenVpnPermissionStatus(call: PluginCall) {
        runAsync(call) {
            if (!openVpnClient.isInstalled()) {
                JSObject().apply {
                    put("installed", false)
                    put("granted", false)
                }
            } else {
                JSObject().apply {
                    put("installed", true)
                    put("granted", openVpnClient.isControlPermissionGranted())
                }
            }
        }
    }

    @PluginMethod
    fun connectOpenVpn(call: PluginCall) {
        val profileId = requireString(call, "profileId") ?: return
        val timeout = parseTimeout(call, "timeoutMs", DEFAULT_VPN_CONNECT_TIMEOUT_MS) ?: return
        runOpenVpnOperation(call) {
            openVpnStatusResult(openVpnClient.connect(profileId, timeout))
        }
    }

    @PluginMethod
    fun disconnectOpenVpn(call: PluginCall) {
        val timeout = parseTimeout(call, "timeoutMs", DEFAULT_VPN_DISCONNECT_TIMEOUT_MS) ?: return
        val onlyIfStartedByApp = call.getBoolean("onlyIfStartedByApp", false) ?: false
        runOpenVpnOperation(call) {
            openVpnStatusResult(openVpnClient.disconnect(onlyIfStartedByApp, timeout))
        }
    }

    @PluginMethod
    fun getOpenVpnStatus(call: PluginCall) = runAsync(call) {
        openVpnStatusResult(openVpnClient.getStatus())
    }

    @PluginMethod
    fun ensureHomeNetwork(call: PluginCall) {
        val request = parseHomeNetworkRequest(call) ?: return
        runOpenVpnOperation(call) {
            val result = homeNetworkOrchestrator.ensure(request)
            JSObject().apply {
                put("path", result.path)
                put("vpnWasStartedByApp", result.vpnWasStartedByApp)
            }
        }
    }

    @PluginMethod
    fun getPcStatus(call: PluginCall) {
        val host = requireString(call, "host") ?: return
        val port = parsePort(call) ?: return
        val timeout = parseTimeout(call, "timeoutMs", DEFAULT_PC_STATUS_TIMEOUT_MS) ?: return
        val routerHost = call.getString("routerHost")?.trim()?.takeIf { it.isNotEmpty() }
        val routerPortRaw = call.getInt("routerPort")
        val routerPort = when {
            routerHost == null -> null
            routerPortRaw == null -> DEFAULT_SSH_PORT
            routerPortRaw !in 1..65535 -> {
                call.reject("routerPort는 1~65535 범위여야 합니다.", SshErrorCode.UNKNOWN.name)
                return
            }
            else -> routerPortRaw
        }
        val routerTimeout = if (routerHost != null) {
            parseTimeout(call, "routerTimeoutMs", DEFAULT_REACHABILITY_TIMEOUT_MS) ?: return
        } else null
        runAsync(call) {
            val vpnConnected = openVpnClient.isInstalled() &&
                openVpnClient.getStatus().status == NativeVpnStatus.CONNECTED
            var result = when {
                vpnConnected -> pcStatusChecker.checkAfterVpn(
                    host,
                    port,
                    timeout,
                    DEFAULT_POST_CONNECT_REACHABILITY_TIMEOUT_MS,
                    routerHost,
                    routerPort,
                )
                routerHost != null && routerPort != null && routerTimeout != null ->
                pcStatusChecker.checkWithHomeNetwork(
                    pcHost = host,
                    pcPort = port,
                    pcTimeoutMs = timeout,
                    routerHost = routerHost,
                    routerPort = routerPort,
                    routerTimeoutMs = routerTimeout,
                )
                else -> pcStatusChecker.check(host, port, timeout)
            }
            var resolvedHost = host
            val expectedFingerprint = appSettingsStore.get()[AppSettingsStore.KEY_PC_HOST_FINGERPRINT]?.toString()
            if (result.reachable && !expectedFingerprint.isNullOrBlank()) {
                endpointResolver.connectToPC(host, port, expectedFingerprint, allowScan = false)
            }
            if (result.status == "offline") {
                val recovered = endpointResolver.connectToPC(host, port, expectedFingerprint)
                if (recovered != null) {
                    resolvedHost = recovered
                    result = pcStatusChecker.check(recovered, port, timeout)
                }
            }
            JSObject().apply {
                put("status", result.status)
                put("reachable", result.reachable)
                put("reason", result.reason)
                result.latencyMs?.let { put("latencyMs", it) }
                put("resolvedHost", resolvedHost)
            }
        }
    }

    @PluginMethod
    fun runPowerAction(call: PluginCall) {
        val request = parsePowerActionRequest(call) ?: return
        runLazyOpenVpnOperation(call) {
            val result = powerOrchestrator.run(request)
            JSObject().apply {
                put("action", result.action)
                put("previousStatus", result.previousStatus)
                put("finalStatus", result.finalStatus)
                put("networkPath", result.networkPath)
                put("vpnWasStartedByApp", result.vpnWasStartedByApp)
                put("vpnDisconnectFailed", result.vpnDisconnectFailed)
                put("commandExecuted", result.commandExecuted)
                put("durationMs", result.durationMs)
                put("resolvedPcHost", result.resolvedPcHost)
            }
        }
    }

    @PluginMethod
    fun getAppSettings(call: PluginCall) {
        val settings = appSettingsStore.toJSObject()
        call.resolve(JSObject().apply { put("settings", settings) })
    }

    @PluginMethod
    fun setAppSettings(call: PluginCall) {
        val settingsObj = call.getObject("settings")
            ?: run {
                call.reject("settings 객체가 필요합니다.", NetworkErrorCode.UNKNOWN.name)
                return
            }
        // Validate basic fields before persisting (detailed validation is in TS)
        val map = mutableMapOf<String, Any?>()
        fun stringKey(key: String) { settingsObj.optString(key)?.let { if (it.isNotEmpty()) map[key] = it } }
        fun intKey(key: String) { if (settingsObj.has(key)) map[key] = settingsObj.optInt(key) }
        fun boolKey(key: String) { if (settingsObj.has(key)) map[key] = settingsObj.optBoolean(key) }
        // Allow empty routerUsername
        if (settingsObj.has("pcName")) map["pcName"] = settingsObj.optString("pcName") ?: ""
        if (settingsObj.has("pcHostId")) map["pcHostId"] = settingsObj.optString("pcHostId") ?: ""
        if (settingsObj.has("pcHostname")) map["pcHostname"] = settingsObj.optString("pcHostname") ?: ""
        if (settingsObj.has("pcHostFingerprint")) map["pcHostFingerprint"] = settingsObj.optString("pcHostFingerprint") ?: ""
        if (settingsObj.has("pcLanPrefix")) map["pcLanPrefix"] = settingsObj.optInt("pcLanPrefix")
        if (settingsObj.has("pcHost")) map["pcHost"] = settingsObj.optString("pcHost") ?: ""
        if (settingsObj.has("pcPort")) map["pcPort"] = settingsObj.optInt("pcPort")
        if (settingsObj.has("pcUsername")) map["pcUsername"] = settingsObj.optString("pcUsername") ?: ""
        if (settingsObj.has("pcMac")) map["pcMac"] = settingsObj.optString("pcMac") ?: ""
        if (settingsObj.has("routerHost")) map["routerHost"] = settingsObj.optString("routerHost") ?: ""
        if (settingsObj.has("routerPort")) map["routerPort"] = settingsObj.optInt("routerPort")
        if (settingsObj.has("routerUsername")) map["routerUsername"] = settingsObj.optString("routerUsername") ?: ""
        if (settingsObj.has("wolInterface")) map["wolInterface"] = settingsObj.optString("wolInterface") ?: ""
        if (settingsObj.has("autoDisconnectVpn")) map["autoDisconnectVpn"] = settingsObj.optBoolean("autoDisconnectVpn")
        if (settingsObj.has("refreshIntervalSec")) map["refreshIntervalSec"] = settingsObj.optInt("refreshIntervalSec")
        if (settingsObj.has("themePreference")) map["themePreference"] = settingsObj.optString("themePreference") ?: "system"
        if (settingsObj.has("languagePreference")) map["languagePreference"] = settingsObj.optString("languagePreference") ?: "system"
        if (settingsObj.has("copyMode")) map["copyMode"] = settingsObj.optString("copyMode") ?: "simple"
        if (settingsObj.has("onboardingStep")) map["onboardingStep"] = settingsObj.optInt("onboardingStep")
        if (settingsObj.has("onboardingCompleted")) map["onboardingCompleted"] = settingsObj.optBoolean("onboardingCompleted")

        // Minimal native validation (port, MAC, interface)
        (map["pcPort"] as? Int)?.let { if (it !in 1..65535) { call.reject("pcPort 1~65535", NetworkErrorCode.POWER_COMMAND_FAILED.name); return } }
        (map["pcLanPrefix"] as? Int)?.let { if (it !in 0..32) { call.reject("pcLanPrefix 0~32", NetworkErrorCode.POWER_COMMAND_FAILED.name); return } }
        (map["routerPort"] as? Int)?.let { if (it !in 1..65535) { call.reject("routerPort 1~65535", NetworkErrorCode.POWER_COMMAND_FAILED.name); return } }
        (map["pcHost"] as? String)?.let {
            if (!isValidHostValue(it)) {
                call.reject("pcHost 형식 오류", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }
        (map["routerHost"] as? String)?.let {
            if (!isValidHostValue(it)) {
                call.reject("routerHost 형식 오류", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }
        (map["pcMac"] as? String)?.let { if (it.isNotEmpty() && !it.matches(Regex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$"))) { call.reject("MAC 형식 오류", NetworkErrorCode.POWER_COMMAND_FAILED.name); return } }
        (map["wolInterface"] as? String)?.let { if (it.isNotEmpty() && !it.matches(Regex("^[a-zA-Z0-9]+$"))) { call.reject("Interface 형식 오류", NetworkErrorCode.POWER_COMMAND_FAILED.name); return } }
        (map["refreshIntervalSec"] as? Int)?.let {
            if (it !in setOf(0, 10, 15, 20, 30, 60)) {
                call.reject("refreshIntervalSec 값이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }
        (map["themePreference"] as? String)?.let {
            if (it !in setOf("system", "light", "dark")) {
                call.reject("themePreference 값이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }
        (map["languagePreference"] as? String)?.let {
            if (it !in setOf("system", "ko", "en")) {
                call.reject("languagePreference 값이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }
        (map["copyMode"] as? String)?.let {
            if (it !in setOf("simple", "technical")) {
                call.reject("copyMode 값이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
                return
            }
        }

        appSettingsStore.set(map)
        call.resolve(JSObject().apply { put("settings", appSettingsStore.toJSObject()) })
    }

    @PluginMethod
    fun commitOnboarding(call: PluginCall) {
        val settings = call.getObject("settings") ?: run {
            call.reject("설정이 필요합니다.")
            return
        }
        val pc = call.getObject("pcKey") ?: run {
            call.reject("PC 호스트 키가 필요합니다.")
            return
        }
        val router = call.getObject("routerKey")
        val vpnId = call.getString("selectedVpnProfileId")?.takeIf { it.isNotBlank() }
        fun readKey(value: JSObject) = SshHostKeyInfo(
            host = value.optString("host"),
            port = value.optInt("port"),
            algorithm = value.optString("algorithm"),
            fingerprint = value.optString("fingerprint"),
            trusted = false,
        )
        runAsync(call) {
            val pcKey = readKey(pc)
            val routerKey = router?.let(::readKey)
            if (!sshClient.validateScannedHostKey(pcKey.host, pcKey.port,
                    pcKey.algorithm, pcKey.fingerprint) ||
                (routerKey != null && !sshClient.validateScannedHostKey(routerKey.host,
                    routerKey.port, routerKey.algorithm, routerKey.fingerprint))) {
                throw NativeSshException(SshErrorCode.HOST_KEY_MISMATCH,
                    "온보딩 중 확인한 호스트 키가 현재 스캔과 다릅니다.")
            }
            if (vpnId != null && openVpnClient.getProfilesReadOnly().none { it.id == vpnId }) {
                throw NativeNetworkException(NetworkErrorCode.OPENVPN_PROFILE_NOT_FOUND,
                    "선택한 OpenVPN 프로필을 찾을 수 없습니다.")
            }
            appSettingsStore.commitOnboarding(settings, pcKey, routerKey, vpnId)
            JSObject().apply { put("settings", appSettingsStore.toJSObject()) }
        }
    }

    @PluginMethod
    fun getAppVersion(call: PluginCall) {
        try {
            val pm = context.packageManager
            val info = pm.getPackageInfo(context.packageName, 0)
            @Suppress("DEPRECATION")
            val versionCode = if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
            call.resolve(JSObject().apply {
                put("versionName", info.versionName ?: "0.1.0")
                put("versionCode", versionCode)
            })
        } catch (e: Exception) {
            call.resolve(JSObject().apply {
                put("versionName", "0.1.0")
                put("versionCode", 1)
            })
        }
    }

    @PluginMethod
    fun showSystemToast(call: PluginCall) {
        val message = call.getString("message")?.trim()
        if (message.isNullOrEmpty()) {
            call.reject("Toast 메시지가 필요합니다.", NetworkErrorCode.UNKNOWN.name)
            return
        }
        if (
            call.getBoolean("skipWhenClipboardConfirmationAvailable", false) == true &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
        ) {
            call.resolve()
            return
        }
        val duration = if (call.getString("duration") == "long") Toast.LENGTH_LONG else Toast.LENGTH_SHORT
        bridge.executeOnMainThread {
            Toast.makeText(context, message, duration).show()
            call.resolve()
        }
    }

    @ActivityCallback
    fun openVpnControlPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val operation = pendingOpenVpnOperations.remove(call.callbackId) ?: return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject(
                "OpenVPN for Android 외부 제어 권한이 거부되었습니다.",
                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_DENIED.name,
            )
            return
        }
        runOpenVpnOperation(call, operation)
    }

    private fun runAsync(call: PluginCall, operation: () -> JSObject) {
        executor.execute {
            try {
                call.resolve(operation())
            } catch (error: NativeSshException) {
                rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
            } catch (error: NativeNetworkException) {
                rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
            } catch (error: Exception) {
                call.reject(
                    "네이티브 처리 중 알 수 없는 오류가 발생했습니다.",
                    NetworkErrorCode.UNKNOWN.name,
                    error,
                )
            }
        }
    }

    private fun runOpenVpnOperation(call: PluginCall, operation: () -> JSObject) {
        executor.execute {
            try {
                val permissionIntent = openVpnClient.permissionIntentOrNull()
                if (permissionIntent != null) {
                    pendingOpenVpnOperations[call.callbackId] = operation
                    bridge.executeOnMainThread {
                        try {
                            startActivityForResult(call, permissionIntent, "openVpnControlPermissionResult")
                        } catch (error: Exception) {
                            pendingOpenVpnOperations.remove(call.callbackId)
                            rejectWithDetails(
                                call,
                                "OpenVPN for Android 권한 화면을 열 수 없습니다.",
                                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED.name,
                                error,
                            )
                        }
                    }
                    return@execute
                }
                call.resolve(operation())
            } catch (error: NativeSshException) {
                rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
            } catch (error: NativeNetworkException) {
                rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
            } catch (error: Exception) {
                rejectWithDetails(
                    call,
                    "OpenVPN 처리 중 알 수 없는 오류가 발생했습니다.",
                    NetworkErrorCode.UNKNOWN.name,
                    error,
                )
            }
        }
    }

    /**
     * Runs local-capable actions without prompting for VPN control up front. If the
     * operation discovers that VPN control is required, resume it after approval.
     */
    private fun runLazyOpenVpnOperation(call: PluginCall, operation: () -> JSObject) {
        executor.execute {
            try {
                call.resolve(operation())
            } catch (error: NativeNetworkException) {
                if (error.errorCode != NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED) {
                    rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
                    return@execute
                }
                try {
                    val permissionIntent = openVpnClient.permissionIntentOrNull()
                    if (permissionIntent == null) {
                        rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
                        return@execute
                    }
                    pendingOpenVpnOperations[call.callbackId] = operation
                    bridge.executeOnMainThread {
                        try {
                            startActivityForResult(call, permissionIntent, "openVpnControlPermissionResult")
                        } catch (activityError: Exception) {
                            pendingOpenVpnOperations.remove(call.callbackId)
                            rejectWithDetails(
                                call,
                                "OpenVPN for Android 권한 화면을 열 수 없습니다.",
                                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED.name,
                                activityError,
                            )
                        }
                    }
                } catch (permissionError: NativeNetworkException) {
                    rejectWithDetails(
                        call,
                        permissionError.message,
                        permissionError.errorCode.name,
                        permissionError,
                        permissionError.details,
                    )
                }
            } catch (error: NativeSshException) {
                rejectWithDetails(call, error.message, error.errorCode.name, error, error.details)
            } catch (error: Exception) {
                rejectWithDetails(
                    call,
                    "네이티브 처리 중 알 수 없는 오류가 발생했습니다.",
                    NetworkErrorCode.UNKNOWN.name,
                    error,
                )
            }
        }
    }

    private fun rejectWithDetails(
        call: PluginCall,
        message: String,
        code: String,
        error: Exception,
        values: Map<String, Any?> = emptyMap(),
    ) {
        val details = JSObject()
        values.forEach { (key, value) ->
            if (value != null) details.put(key, value)
        }
        call.reject(message, code, error, details)
    }

    private fun putIdentity(target: JSObject, identity: SshIdentityInfo) {
        target.put("algorithm", identity.algorithm)
        target.put("publicKey", identity.publicKey)
        target.put("fingerprint", identity.fingerprint)
        target.put("created", identity.created)
    }

    private fun isValidHostValue(value: String): Boolean {
        if (value.isEmpty()) return true
        if (value.length > 253 || !HOST_PATTERN.matches(value)) return false
        if (value.all { it.isDigit() || it == '.' }) {
            val parts = value.split('.')
            return parts.size == 4 && parts.all { part ->
                part.isNotEmpty() && part.toIntOrNull()?.let { it in 0..255 } == true
            }
        }
        return true
    }

    private fun hostKeyResult(hostKey: SshHostKeyInfo): JSObject = JSObject().apply {
        put("host", hostKey.host)
        put("port", hostKey.port)
        put("algorithm", hostKey.algorithm)
        put("fingerprint", hostKey.fingerprint)
        put("trusted", hostKey.trusted)
    }

    private fun openVpnProfilesResult(): JSObject = JSObject().apply {
        val profiles = com.getcapacitor.JSArray()
        openVpnClient.getProfilesReadOnly().forEach { profile ->
            profiles.put(JSObject().apply {
                put("id", profile.id)
                put("name", profile.name)
            })
        }
        put("profiles", profiles)
        openVpnClient.getSelectedProfileId()?.let { put("selectedProfileId", it) }
    }

    private fun openVpnStatusResult(status: NativeOpenVpnStatus): JSObject = JSObject().apply {
        put("status", status.status.name.lowercase())
        status.profileId?.let { put("profileId", it) }
        put("vpnWasStartedByApp", status.vpnWasStartedByApp)
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

    private fun parsePowerTimeout(call: PluginCall, name: String, defaultValue: Int): Int? {
        val value = call.getInt(name, defaultValue)
        if (value == null || value !in MIN_POWER_TIMEOUT_MS..MAX_POWER_TIMEOUT_MS) {
            call.reject(
                "$name 값은 ${MIN_POWER_TIMEOUT_MS}~${MAX_POWER_TIMEOUT_MS}ms 범위여야 합니다.",
                NetworkErrorCode.POWER_COMMAND_FAILED.name,
            )
            return null
        }
        return value
    }

    private fun parsePowerPollTimeout(call: PluginCall, name: String, defaultValue: Int): Int? {
        val value = call.getInt(name, defaultValue)
        if (value == null || value !in MIN_POLL_INTERVAL_MS..MAX_POLL_INTERVAL_MS) {
            call.reject(
                "$name 값은 ${MIN_POLL_INTERVAL_MS}~${MAX_POLL_INTERVAL_MS}ms 범위여야 합니다.",
                NetworkErrorCode.POWER_COMMAND_FAILED.name,
            )
            return null
        }
        return value
    }

    private fun parseHomeNetworkRequest(call: PluginCall): HomeNetworkRequest? {
        val routerHost = requireString(call, "routerHost") ?: return null
        val routerPort = call.getInt("routerPort", DEFAULT_SSH_PORT)
        if (routerPort == null || routerPort !in 1..65535) {
            call.reject("routerPort는 1~65535 범위여야 합니다.", NetworkErrorCode.UNKNOWN.name)
            return null
        }
        val reachabilityTimeout = parseTimeout(
            call,
            "reachabilityTimeoutMs",
            DEFAULT_REACHABILITY_TIMEOUT_MS,
        ) ?: return null
        val connectTimeout = parseTimeout(call, "connectTimeoutMs", DEFAULT_VPN_CONNECT_TIMEOUT_MS)
            ?: return null
        val postConnectTimeout = parseTimeout(
            call,
            "postConnectReachabilityTimeoutMs",
            DEFAULT_POST_CONNECT_REACHABILITY_TIMEOUT_MS,
        ) ?: return null
        return HomeNetworkRequest(
            routerHost = routerHost,
            routerPort = routerPort,
            reachabilityTimeoutMs = reachabilityTimeout,
            connectTimeoutMs = connectTimeout,
            postConnectReachabilityTimeoutMs = postConnectTimeout,
        )
    }

    private fun parsePowerActionRequest(call: PluginCall): PowerActionRequest? {
        val action = requireString(call, "action") ?: return null
        if (action !in setOf("power-on", "shutdown", "reboot")) {
            call.reject("action은 power-on, shutdown, reboot 중 하나여야 합니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        val pcHost = requireString(call, "pcHost") ?: return null
        val pcPort = call.getInt("pcPort", DEFAULT_SSH_PORT)
        if (pcPort == null || pcPort !in 1..65535) {
            call.reject("pcPort는 1~65535 범위여야 합니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        val pcUsername = requireString(call, "pcUsername") ?: return null
        val routerHostInput = call.getString("routerHost")?.trim().orEmpty()
        val routerHost = routerHostInput.takeIf { it.isNotEmpty() }
        if (action == "power-on" && routerHost == null) {
            call.reject("Power On에는 공유기 주소가 필요합니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        val routerPort = if (routerHost == null) {
            null
        } else {
            call.getInt("routerPort", DEFAULT_SSH_PORT)
        }
        if (routerHost != null && (routerPort == null || routerPort !in 1..65535)) {
            call.reject("routerPort는 1~65535 범위여야 합니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        // routerUsername is required only for Power On (WOL via router SSH). For shutdown/reboot it may be empty.
        val routerUsernameRaw = call.getString("routerUsername")?.trim() ?: ""
        val macAddress = call.getString("macAddress")?.trim() ?: ""
        if (action == "power-on" && !MAC_ADDRESS_PATTERN.matches(macAddress)) {
            call.reject("macAddress 형식이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        val wolInterface = call.getString("wolInterface")?.trim() ?: ""
        if (action == "power-on" && !WOL_INTERFACE_PATTERN.matches(wolInterface)) {
            call.reject("wolInterface 형식이 올바르지 않습니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }

        val autoDisconnectVpn = call.getBoolean("autoDisconnectVpn", false) ?: false
        val pcHostFingerprint = call.getString("pcHostFingerprint")
        val routerHostFingerprint = call.getString("routerHostFingerprint")

        val initialStatusTimeout = parseTimeout(call, "initialStatusTimeoutMs", DEFAULT_PC_STATUS_TIMEOUT_MS) ?: return null
        val pollInterval = parsePowerPollTimeout(call, "pollIntervalMs", DEFAULT_POWER_POLL_INTERVAL_MS) ?: return null
        val wakeTimeout = parsePowerTimeout(call, "wakeTimeoutMs", DEFAULT_WAKE_TIMEOUT_MS) ?: return null
        val shutdownTimeout = parsePowerTimeout(call, "shutdownTimeoutMs", DEFAULT_SHUTDOWN_TIMEOUT_MS) ?: return null
        val rebootOfflineTimeout = parsePowerTimeout(call, "rebootOfflineTimeoutMs", DEFAULT_REBOOT_OFFLINE_TIMEOUT_MS) ?: return null
        val rebootOnlineTimeout = parsePowerTimeout(call, "rebootOnlineTimeoutMs", DEFAULT_REBOOT_ONLINE_TIMEOUT_MS) ?: return null
        val connectTimeout = parseTimeout(call, "connectTimeoutMs", DEFAULT_CONNECT_TIMEOUT_MS) ?: return null
        val commandTimeout = parseTimeout(call, "commandTimeoutMs", DEFAULT_COMMAND_TIMEOUT_MS) ?: return null
        val reachabilityTimeout = parseTimeout(call, "reachabilityTimeoutMs", DEFAULT_REACHABILITY_TIMEOUT_MS) ?: return null
        val postConnectReachabilityTimeout = parseTimeout(
            call,
            "postConnectReachabilityTimeoutMs",
            DEFAULT_POST_CONNECT_REACHABILITY_TIMEOUT_MS,
        ) ?: return null
        val vpnDisconnectTimeout = parseTimeout(call, "vpnDisconnectTimeoutMs", DEFAULT_VPN_DISCONNECT_TIMEOUT_MS) ?: return null

        if (action == "power-on" && routerUsernameRaw.isEmpty()) {
            call.reject("공유기 SSH 사용자 이름이 필요합니다. Power On은 공유기 SSH를 사용합니다.", NetworkErrorCode.POWER_COMMAND_FAILED.name)
            return null
        }
        return PowerActionRequest(
            action = action,
            pcHost = pcHost,
            pcPort = pcPort,
            pcUsername = pcUsername,
            pcHostFingerprint = pcHostFingerprint,
            routerHost = routerHost,
            routerPort = routerPort,
            routerUsername = routerUsernameRaw,
            routerHostFingerprint = routerHostFingerprint,
            macAddress = macAddress,
            wolInterface = wolInterface,
            autoDisconnectVpn = autoDisconnectVpn,
            initialStatusTimeoutMs = initialStatusTimeout,
            pollIntervalMs = pollInterval,
            wakeTimeoutMs = wakeTimeout,
            shutdownTimeoutMs = shutdownTimeout,
            rebootOfflineTimeoutMs = rebootOfflineTimeout,
            rebootOnlineTimeoutMs = rebootOnlineTimeout,
            connectTimeoutMs = connectTimeout,
            commandTimeoutMs = commandTimeout,
            reachabilityTimeoutMs = reachabilityTimeout,
            postConnectReachabilityTimeoutMs = postConnectReachabilityTimeout,
            vpnDisconnectTimeoutMs = vpnDisconnectTimeout,
        )
    }

    private data class ParsedHostOptions(
        val host: String,
        val port: Int,
        val connectTimeoutMs: Int,
    )

    private companion object {
        const val TAG = "PcControlPlugin"
        const val DEFAULT_SSH_PORT = 22
        const val DEFAULT_CONNECT_TIMEOUT_MS = 8_000
        const val DEFAULT_COMMAND_TIMEOUT_MS = 8_000
        const val DEFAULT_REACHABILITY_TIMEOUT_MS = 2_000
        const val DEFAULT_VPN_CONNECT_TIMEOUT_MS = 20_000
        const val DEFAULT_VPN_DISCONNECT_TIMEOUT_MS = 15_000
        const val DEFAULT_POST_CONNECT_REACHABILITY_TIMEOUT_MS = 4_000
        const val DEFAULT_PC_STATUS_TIMEOUT_MS = 2_500
        const val DEFAULT_POWER_POLL_INTERVAL_MS = 1_500
        const val DEFAULT_WAKE_TIMEOUT_MS = 90_000
        const val DEFAULT_SHUTDOWN_TIMEOUT_MS = 45_000
        const val DEFAULT_REBOOT_OFFLINE_TIMEOUT_MS = 45_000
        const val DEFAULT_REBOOT_ONLINE_TIMEOUT_MS = 90_000
        const val MIN_TIMEOUT_MS = 1_000
        const val MAX_TIMEOUT_MS = 30_000
        const val MIN_POWER_TIMEOUT_MS = 5_000
        const val MAX_POWER_TIMEOUT_MS = 120_000
        const val MIN_POLL_INTERVAL_MS = 500
        const val MAX_POLL_INTERVAL_MS = 5_000
        val HOST_PATTERN = Regex("^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$")
        val MAC_ADDRESS_PATTERN = Regex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
        val WOL_INTERFACE_PATTERN = Regex("^[a-zA-Z0-9]+$")
    }
}
