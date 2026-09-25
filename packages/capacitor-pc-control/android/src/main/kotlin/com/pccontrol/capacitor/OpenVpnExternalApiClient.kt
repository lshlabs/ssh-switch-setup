package com.pccontrol.capacitor

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.net.Uri
import android.content.pm.PackageManager
import android.os.IBinder
import android.os.RemoteException
import de.blinkt.openvpn.api.IOpenVPNAPIService
import de.blinkt.openvpn.api.IOpenVPNStatusCallback
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class OpenVpnExternalApiClient(context: Context) {
    private val appContext = context.applicationContext
    private val preferences: SharedPreferences = appContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )
    private val lock = Object()

    @Volatile
    private var service: IOpenVPNAPIService? = null

    @Volatile
    private var bindFuture: CompletableFuture<IOpenVPNAPIService>? = null

    @Volatile
    private var isBound = false

    @Volatile
    private var callbackRegistered = false

    private var callbackRegistrationInProgress = false
    private var statusCallbackReady = false
    private var currentStatus = NativeVpnStatus.DISCONNECTED
    private var currentProfileId: String? = null
    // Ownership is intentionally process-local. A persisted flag can become stale after
    // the app or the OpenVPN service is restarted and could disconnect a user-owned VPN.
    private var vpnWasStartedByApp = false

    private val statusCallback = object : IOpenVPNStatusCallback.Stub() {
        override fun newStatus(uuid: String?, state: String?, message: String?, level: String?) {
            synchronized(lock) {
                if (!uuid.isNullOrBlank()) currentProfileId = uuid
                currentStatus = mapStatus(state, level)
                if (currentStatus == NativeVpnStatus.DISCONNECTED) {
                    setVpnStartedByApp(false)
                }
                statusCallbackReady = true
                lock.notifyAll()
            }
        }
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val connectedService = IOpenVPNAPIService.Stub.asInterface(binder)
            synchronized(lock) {
                service = connectedService
                bindFuture?.complete(connectedService)
                bindFuture = null
                lock.notifyAll()
            }
        }

        override fun onServiceDisconnected(name: ComponentName) {
            synchronized(lock) {
                service = null
                callbackRegistered = false
                statusCallbackReady = false
                currentStatus = NativeVpnStatus.DISCONNECTED
                lock.notifyAll()
            }
        }

        override fun onBindingDied(name: ComponentName) {
            onServiceDisconnected(name)
        }

        override fun onNullBinding(name: ComponentName) {
            synchronized(lock) {
                bindFuture?.completeExceptionally(
                    NativeNetworkException(
                        NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED,
                        "OpenVPN for Android 제어 서비스를 사용할 수 없습니다.",
                    ),
                )
                bindFuture = null
                isBound = false
                lock.notifyAll()
            }
        }
    }

    fun isInstalled(): Boolean = try {
        appContext.packageManager.getApplicationInfo(OPENVPN_PACKAGE, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    fun appLaunchIntent(): Intent? = appContext.packageManager.getLaunchIntentForPackage(OPENVPN_PACKAGE)

    fun playStoreIntent(): Intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("market://details?id=$OPENVPN_PACKAGE"),
    )

    fun playStoreWebIntent(): Intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("https://play.google.com/store/apps/details?id=$OPENVPN_PACKAGE"),
    )

    fun getProfiles(): List<NativeOpenVpnProfile> = readProfiles(requireAuthorizedService())

    fun getProfilesReadOnly(): List<NativeOpenVpnProfile> = readProfiles(serviceOrBind())

    private fun readProfiles(api: IOpenVPNAPIService): List<NativeOpenVpnProfile> {
        return try {
            api.profiles.orEmpty().mapNotNull { profile ->
                val id = profile.mUUID.trim()
                val name = profile.mName.trim()
                if (id.isEmpty() || name.isEmpty()) null else NativeOpenVpnProfile(id, name)
            }
        } catch (error: RemoteException) {
            throw serviceError("OpenVPN 프로필을 조회할 수 없습니다.", error)
        } catch (error: SecurityException) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
                "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
                error,
            )
        }
    }

    fun getSelectedProfileId(): String? = preferences.getString(SELECTED_PROFILE_KEY, null)

    fun clearSelectedProfile() {
        preferences.edit().remove(SELECTED_PROFILE_KEY).apply()
    }

    fun selectProfile(profileId: String) {
        selectProfile(profileId, getProfiles())
    }

    fun selectProfileReadOnly(profileId: String) {
        selectProfile(profileId, getProfilesReadOnly())
    }

    private fun selectProfile(profileId: String, profiles: List<NativeOpenVpnProfile>) {
        val exists = profiles.any { it.id == profileId }
        if (!exists) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_PROFILE_NOT_FOUND,
                "선택한 OpenVPN 프로필을 찾을 수 없습니다.",
                details = mapOf("profileId" to profileId),
            )
        }
        preferences.edit().putString(SELECTED_PROFILE_KEY, profileId).apply()
    }

    fun getStatus(): NativeOpenVpnStatus {
        if (!isInstalled()) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_APP_NOT_INSTALLED,
                "OpenVPN for Android이 설치되어 있지 않습니다.",
            )
        }
        registerStatusCallback(serviceOrBind())
        return synchronized(lock) {
            NativeOpenVpnStatus(currentStatus, currentProfileId, vpnWasStartedByApp)
        }
    }

    private fun requestControlPermission(): OpenVpnPermissionResult {
        val api = serviceOrBind()
        val intent = controlPermissionIntentOrNull(api)
        if (intent != null) return OpenVpnPermissionResult.Required(intent)
        registerStatusCallback(api)
        return OpenVpnPermissionResult.Granted
    }

    fun isControlPermissionGranted(): Boolean {
        if (!isInstalled()) return false
        return controlPermissionIntentOrNull(serviceOrBind()) == null
    }

    private fun controlPermissionIntentOrNull(api: IOpenVPNAPIService): Intent? = try {
        api.prepare(appContext.packageName) ?: api.prepareVPNService()
    } catch (error: RemoteException) {
        throw serviceError("OpenVPN 제어 권한을 확인할 수 없습니다.", error)
    } catch (error: SecurityException) {
        throw NativeNetworkException(
            NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
            "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
            error,
        )
    }

    fun connect(profileId: String, timeoutMs: Int): NativeOpenVpnStatus {
        val permission = requestControlPermission()
        if (permission is OpenVpnPermissionResult.Required) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
                "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
            )
        }
        val api = serviceOrBind()
        val profiles = try {
            api.profiles.orEmpty()
        } catch (error: RemoteException) {
            throw serviceError("OpenVPN 프로필을 조회할 수 없습니다.", error)
        }
        if (profiles.none { it.mUUID == profileId }) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_PROFILE_NOT_FOUND,
                "선택한 OpenVPN 프로필을 찾을 수 없습니다.",
                details = mapOf("profileId" to profileId),
            )
        }

        synchronized(lock) {
            when (currentStatus) {
                NativeVpnStatus.CONNECTED -> return snapshotLocked()
                NativeVpnStatus.CONNECTING -> return awaitStatusLocked(NativeVpnStatus.CONNECTED, timeoutMs)
                else -> {
                    currentProfileId = profileId
                    currentStatus = NativeVpnStatus.CONNECTING
                    lock.notifyAll()
                }
            }
        }

        try {
            api.startProfile(profileId)
        } catch (error: RemoteException) {
            synchronized(lock) {
                currentStatus = NativeVpnStatus.ERROR
                lock.notifyAll()
            }
            throw serviceError("OpenVPN 연결 요청에 실패했습니다.", error)
        }

        synchronized(lock) {
            setVpnStartedByApp(true)
            return awaitStatusLocked(NativeVpnStatus.CONNECTED, timeoutMs)
        }
    }

    fun disconnect(onlyIfStartedByApp: Boolean, timeoutMs: Int): NativeOpenVpnStatus {
        val permission = requestControlPermission()
        if (permission is OpenVpnPermissionResult.Required) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
                "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
            )
        }
        synchronized(lock) {
            if (currentStatus == NativeVpnStatus.DISCONNECTED ||
                (onlyIfStartedByApp && !vpnWasStartedByApp)
            ) {
                return snapshotLocked()
            }
            currentStatus = NativeVpnStatus.DISCONNECTING
            lock.notifyAll()
        }

        try {
            serviceOrBind().disconnect()
        } catch (error: RemoteException) {
            synchronized(lock) {
                currentStatus = NativeVpnStatus.ERROR
                lock.notifyAll()
            }
            throw serviceError("OpenVPN 연결 해제 요청에 실패했습니다.", error)
        }

        synchronized(lock) {
            return awaitStatusLocked(NativeVpnStatus.DISCONNECTED, timeoutMs)
        }
    }

    fun close() {
        val api: IOpenVPNAPIService?
        val shouldUnregister: Boolean
        synchronized(lock) {
            while (callbackRegistrationInProgress) {
                try {
                    lock.wait(CLOSE_WAIT_TIMEOUT_MS.toLong())
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
            api = service
            shouldUnregister = callbackRegistered
        }
        if (api != null && shouldUnregister) {
            try {
                api.unregisterStatusCallback(statusCallback)
            } catch (_: RemoteException) {
                // The remote process has already gone away; there is nothing left to unregister.
            }
        }
        synchronized(lock) {
            callbackRegistered = false
            statusCallbackReady = false
            service = null
            bindFuture = null
            if (isBound) {
                try {
                    appContext.unbindService(serviceConnection)
                } catch (_: IllegalArgumentException) {
                    // Android has already detached the connection.
                }
                isBound = false
            }
        }
    }

    private fun requireAuthorizedService(): IOpenVPNAPIService {
        val permission = requestControlPermission()
        if (permission is OpenVpnPermissionResult.Required) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
                "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
            )
        }
        return serviceOrBind()
    }

    private fun serviceOrBind(): IOpenVPNAPIService {
        if (!isInstalled()) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_APP_NOT_INSTALLED,
                "OpenVPN for Android이 설치되어 있지 않습니다.",
            )
        }
        synchronized(lock) { service?.let { return it } }

        val future = synchronized(lock) {
            service?.let { return it }
            bindFuture ?: CompletableFuture<IOpenVPNAPIService>().also { created ->
                bindFuture = created
                val intent = Intent(OPENVPN_API_ACTION).setPackage(OPENVPN_PACKAGE)
                isBound = appContext.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
                if (!isBound) {
                    created.completeExceptionally(
                        NativeNetworkException(
                            NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED,
                            "OpenVPN for Android 제어 서비스에 연결할 수 없습니다.",
                        ),
                    )
                    bindFuture = null
                }
            }
        }
        return try {
            future.get(SERVICE_BIND_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        } catch (error: TimeoutException) {
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED,
                "OpenVPN for Android 제어 서비스 연결 시간이 초과되었습니다.",
                error,
            )
        } catch (error: ExecutionException) {
            val cause = error.cause
            if (cause is NativeNetworkException) throw cause
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED,
                "OpenVPN for Android 제어 서비스에 연결할 수 없습니다.",
                cause,
            )
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw NativeNetworkException(
                NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED,
                "OpenVPN for Android 제어 서비스 연결이 중단되었습니다.",
                error,
            )
        }
    }

    private fun registerStatusCallback(api: IOpenVPNAPIService) {
        val deadline = System.nanoTime() +
            TimeUnit.MILLISECONDS.toNanos(STATUS_CALLBACK_TIMEOUT_MS.toLong())
        synchronized(lock) {
            while (callbackRegistrationInProgress) {
                waitForRegistrationToFinishLocked(deadline)
            }
            if (callbackRegistered) {
                waitForStatusCallbackLocked(deadline)
                return
            }
            callbackRegistrationInProgress = true
            statusCallbackReady = false
        }

        var registeredRemotely = false
        try {
            // OpenVPN for Android sends its most recent state during registration.
            // Do not read the initial DISCONNECTED default until that callback has
            // actually been delivered to this process.
            try {
                api.registerStatusCallback(statusCallback)
            } catch (error: RemoteException) {
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 상태 callback을 등록할 수 없습니다.",
                    error,
                )
            } catch (error: SecurityException) {
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_CONTROL_PERMISSION_REQUIRED,
                    "OpenVPN for Android에서 외부 제어 권한을 승인해야 합니다.",
                    error,
                )
            }
            registeredRemotely = true

            synchronized(lock) {
                waitForStatusCallbackLocked(deadline)
                callbackRegistered = true
            }
        } catch (error: NativeNetworkException) {
            if (registeredRemotely) {
                try {
                    api.unregisterStatusCallback(statusCallback)
                } catch (_: RemoteException) {
                    // The remote process may have gone away while the callback was registering.
                }
            }
            synchronized(lock) {
                callbackRegistered = false
                statusCallbackReady = false
            }
            throw error
        } finally {
            synchronized(lock) {
                callbackRegistrationInProgress = false
                lock.notifyAll()
            }
        }
    }

    private fun waitForRegistrationToFinishLocked(deadline: Long) {
        while (callbackRegistrationInProgress) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) {
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 상태 callback 등록이 완료되지 않았습니다.",
                )
            }
            try {
                TimeUnit.NANOSECONDS.timedWait(lock, remaining)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 상태 확인이 중단되었습니다.",
                    error,
                )
            }
        }
    }

    private fun waitForStatusCallbackLocked(deadline: Long) {
        while (!statusCallbackReady) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) {
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 현재 상태를 확인할 수 없습니다.",
                )
            }
            try {
                TimeUnit.NANOSECONDS.timedWait(lock, remaining)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 상태 확인이 중단되었습니다.",
                    error,
                )
            }
        }
    }

    private fun awaitStatusLocked(expected: NativeVpnStatus, timeoutMs: Int): NativeOpenVpnStatus {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
        while (currentStatus != expected) {
            if (currentStatus == NativeVpnStatus.ERROR) {
                throw NativeNetworkException(
                    if (expected == NativeVpnStatus.CONNECTED) {
                        NetworkErrorCode.OPENVPN_CONNECT_FAILED
                    } else {
                        NetworkErrorCode.OPENVPN_DISCONNECT_FAILED
                    },
                    if (expected == NativeVpnStatus.CONNECTED) {
                        "OpenVPN 연결에 실패했습니다."
                    } else {
                        "OpenVPN 연결 해제에 실패했습니다."
                    },
                )
            }
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) {
                throw NativeNetworkException(
                    if (expected == NativeVpnStatus.CONNECTED) {
                        NetworkErrorCode.OPENVPN_CONNECT_TIMEOUT
                    } else {
                        NetworkErrorCode.OPENVPN_DISCONNECT_FAILED
                    },
                    if (expected == NativeVpnStatus.CONNECTED) {
                        "OpenVPN 연결 완료 시간이 초과되었습니다."
                    } else {
                        "OpenVPN 연결 해제 완료 시간이 초과되었습니다."
                    },
                )
            }
            try {
                TimeUnit.NANOSECONDS.timedWait(lock, remaining)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw NativeNetworkException(
                    NetworkErrorCode.OPENVPN_STATUS_UNAVAILABLE,
                    "OpenVPN 상태 대기가 중단되었습니다.",
                    error,
                )
            }
        }
        return snapshotLocked()
    }

    private fun snapshotLocked(): NativeOpenVpnStatus =
        NativeOpenVpnStatus(currentStatus, currentProfileId, vpnWasStartedByApp)

    private fun setVpnStartedByApp(value: Boolean) {
        vpnWasStartedByApp = value
    }

    private fun mapStatus(state: String?, level: String?): NativeVpnStatus {
        val normalizedState = state.orEmpty().uppercase()
        val normalizedLevel = level.orEmpty().uppercase()
        return when {
            normalizedState == "CONNECTED" -> NativeVpnStatus.CONNECTED
            normalizedState == "DISCONNECTED" || normalizedState == "NOPROCESS" ->
                NativeVpnStatus.DISCONNECTED
            normalizedState == "DISCONNECTING" -> NativeVpnStatus.DISCONNECTING
            normalizedLevel == "ERROR" || normalizedState in ERROR_STATES -> NativeVpnStatus.ERROR
            else -> NativeVpnStatus.CONNECTING
        }
    }

    private fun serviceError(message: String, cause: RemoteException): NativeNetworkException =
        NativeNetworkException(NetworkErrorCode.OPENVPN_SERVICE_BIND_FAILED, message, cause)

    private sealed interface OpenVpnPermissionResult {
        data object Granted : OpenVpnPermissionResult

        data class Required(val intent: Intent) : OpenVpnPermissionResult
    }

    fun permissionIntentOrNull(): Intent? = when (val result = requestControlPermission()) {
        OpenVpnPermissionResult.Granted -> null
        is OpenVpnPermissionResult.Required -> result.intent
    }

    private companion object {
        const val OPENVPN_PACKAGE = "de.blinkt.openvpn"
        const val OPENVPN_API_ACTION = "de.blinkt.openvpn.api.IOpenVPNAPIService"
        const val PREFERENCES_NAME = "pc-control-openvpn"
        const val SELECTED_PROFILE_KEY = "selected-profile-id"
        const val SERVICE_BIND_TIMEOUT_MS = 5_000
        const val STATUS_CALLBACK_TIMEOUT_MS = 2_000
        const val CLOSE_WAIT_TIMEOUT_MS = 2_500L
        val ERROR_STATES = setOf("AUTH_FAILED", "USER_VPN_PERMISSION", "EXITING")
    }
}
