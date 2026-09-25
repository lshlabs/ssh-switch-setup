package com.pccontrol.capacitor

import android.content.Context
import android.content.SharedPreferences
import com.getcapacitor.JSObject
import org.json.JSONObject

class AppSettingsStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun get(): Map<String, Any?> {
        // Return stored values only. Product defaults are supplied by the JS layer and contain no device data.
        val map = mutableMapOf<String, Any?>()
        ALL_KEYS.forEach { key ->
            when (key) {
                KEY_AUTO_DISCONNECT -> map[key] = prefs.getBoolean(key, false)
                KEY_REFRESH_INTERVAL -> map[key] = prefs.getInt(key, 20)
                KEY_ONBOARDING_STEP -> map[key] = prefs.getInt(key, 0)
                KEY_ONBOARDING_COMPLETED -> {
                    map[key] = if (prefs.contains(KEY_ONBOARDING_COMPLETED)) {
                        prefs.getBoolean(KEY_ONBOARDING_COMPLETED, false)
                    } else {
                        prefs.getBoolean(KEY_LEGACY_SETUP_COMPLETED, false)
                    }
                }
                KEY_PC_PORT, KEY_ROUTER_PORT -> {
                    if (prefs.contains(key)) map[key] = prefs.getInt(key, if (key == KEY_PC_PORT) 22 else 22)
                }
                else -> {
                    if (prefs.contains(key)) map[key] = prefs.getString(key, null)
                }
            }
        }
        return map
    }

    fun set(settings: Map<String, Any?>) {
        val editor = prefs.edit()
        // Validation is done in TS + native before calling, but also guard here
        settings[KEY_PC_NAME]?.let { editor.putString(KEY_PC_NAME, it as String) }
        settings[KEY_PC_HOST]?.let { editor.putString(KEY_PC_HOST, it as String) }
        settings[KEY_PC_PORT]?.let { editor.putInt(KEY_PC_PORT, (it as Number).toInt()) }
        settings[KEY_PC_USERNAME]?.let { editor.putString(KEY_PC_USERNAME, it as String) }
        settings[KEY_PC_MAC]?.let { editor.putString(KEY_PC_MAC, it as String) }
        settings[KEY_ROUTER_HOST]?.let { editor.putString(KEY_ROUTER_HOST, it as String) }
        settings[KEY_ROUTER_PORT]?.let { editor.putInt(KEY_ROUTER_PORT, (it as Number).toInt()) }
        settings[KEY_ROUTER_USERNAME]?.let { editor.putString(KEY_ROUTER_USERNAME, it as String) }
        settings[KEY_WOL_INTERFACE]?.let { editor.putString(KEY_WOL_INTERFACE, it as String) }
        settings[KEY_AUTO_DISCONNECT]?.let { editor.putBoolean(KEY_AUTO_DISCONNECT, it as Boolean) }
        settings[KEY_REFRESH_INTERVAL]?.let { editor.putInt(KEY_REFRESH_INTERVAL, (it as Number).toInt()) }
        settings[KEY_THEME_PREFERENCE]?.let { editor.putString(KEY_THEME_PREFERENCE, it as String) }
        settings[KEY_LANGUAGE_PREFERENCE]?.let { editor.putString(KEY_LANGUAGE_PREFERENCE, it as String) }
        settings[KEY_COPY_MODE]?.let { editor.putString(KEY_COPY_MODE, it as String) }
        settings[KEY_ONBOARDING_STEP]?.let { editor.putInt(KEY_ONBOARDING_STEP, (it as Number).toInt()) }
        settings[KEY_ONBOARDING_COMPLETED]?.let {
            editor.putBoolean(KEY_ONBOARDING_COMPLETED, it as Boolean)
            editor.remove(KEY_LEGACY_SETUP_COMPLETED)
        }
        editor.apply()
    }

    fun toJSObject(): JSObject {
        val stored = get()
        val obj = JSObject()
        // Only put existing values; missing keys will be filled by JS defaultAppSettings()
        stored.forEach { (k, v) ->
            if (v != null) obj.put(k, v)
        }
        return obj
    }

    companion object {
        const val PREFS_NAME = "pc-control-app-settings"
        const val KEY_PC_NAME = "pcName"
        const val KEY_PC_HOST = "pcHost"
        const val KEY_PC_PORT = "pcPort"
        const val KEY_PC_USERNAME = "pcUsername"
        const val KEY_PC_MAC = "pcMac"
        const val KEY_ROUTER_HOST = "routerHost"
        const val KEY_ROUTER_PORT = "routerPort"
        const val KEY_ROUTER_USERNAME = "routerUsername"
        const val KEY_WOL_INTERFACE = "wolInterface"
        const val KEY_AUTO_DISCONNECT = "autoDisconnectVpn"
        const val KEY_REFRESH_INTERVAL = "refreshIntervalSec"
        const val KEY_THEME_PREFERENCE = "themePreference"
        const val KEY_LANGUAGE_PREFERENCE = "languagePreference"
        const val KEY_COPY_MODE = "copyMode"
        const val KEY_ONBOARDING_STEP = "onboardingStep"
        const val KEY_ONBOARDING_COMPLETED = "onboardingCompleted"
        const val KEY_LEGACY_SETUP_COMPLETED = "setupCompleted"
        val ALL_KEYS = listOf(
            KEY_PC_NAME, KEY_PC_HOST, KEY_PC_PORT, KEY_PC_USERNAME, KEY_PC_MAC,
            KEY_ROUTER_HOST, KEY_ROUTER_PORT, KEY_ROUTER_USERNAME, KEY_WOL_INTERFACE,
            KEY_AUTO_DISCONNECT, KEY_REFRESH_INTERVAL,
            KEY_THEME_PREFERENCE, KEY_LANGUAGE_PREFERENCE, KEY_COPY_MODE,
            KEY_ONBOARDING_STEP, KEY_ONBOARDING_COMPLETED,
        )
    }
}
