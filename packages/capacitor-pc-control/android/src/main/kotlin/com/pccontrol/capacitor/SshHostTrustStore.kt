package com.pccontrol.capacitor

import android.content.Context

class SshHostTrustStore(context: Context) {
    private val preferences = context.getSharedPreferences(AppSettingsStore.PREFS_NAME, Context.MODE_PRIVATE)
    private val legacyPreferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun get(host: String, port: Int): TrustedSshHostKey? {
        val base = preferenceBase(host, port)
        val source = if (preferences.contains("$base.fingerprint")) preferences else legacyPreferences
        val fingerprint = source.getString("$base.fingerprint", null) ?: return null
        val algorithm = source.getString("$base.algorithm", null) ?: return null
        return TrustedSshHostKey(algorithm, fingerprint)
    }

    fun put(host: String, port: Int, algorithm: String, fingerprint: String) {
        val base = preferenceBase(host, port)
        preferences.edit()
            .putString("$base.algorithm", algorithm)
            .putString("$base.fingerprint", fingerprint)
            .apply()
    }

    companion object {
        fun preferenceBase(host: String, port: Int): String = "${host.trim().lowercase()}:$port"
        const val PREFERENCES_NAME = "pc_control_trusted_ssh_hosts_v1"
    }
}
