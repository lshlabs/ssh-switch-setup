package com.pccontrol.capacitor

import android.content.Context

internal class SshHostTrustStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun get(host: String, port: Int): TrustedSshHostKey? {
        val base = key(host, port)
        val fingerprint = preferences.getString("$base.fingerprint", null) ?: return null
        val algorithm = preferences.getString("$base.algorithm", null) ?: return null
        return TrustedSshHostKey(algorithm, fingerprint)
    }

    fun put(host: String, port: Int, algorithm: String, fingerprint: String) {
        val base = key(host, port)
        preferences.edit()
            .putString("$base.algorithm", algorithm)
            .putString("$base.fingerprint", fingerprint)
            .apply()
    }

    private fun key(host: String, port: Int): String = "${host.trim().lowercase()}:$port"

    private companion object {
        const val PREFERENCES_NAME = "pc_control_trusted_ssh_hosts_v1"
    }
}
