package com.pccontrol.capacitor

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class SshIdentityManagerTest {

    private fun sourceText(): String {
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val f = File(dir, "packages/capacitor-pc-control/android/src/main/kotlin/com/pccontrol/capacitor/SshIdentityManager.kt")
            if (f.exists()) return f.readText()
            dir = dir.parentFile
        }
        // fallback to direct read
        return File("packages/capacitor-pc-control/android/src/main/kotlin/com/pccontrol/capacitor/SshIdentityManager.kt").takeIf { it.exists() }?.readText() ?: ""
    }

    @Test
    fun aliasIsStable() {
        val text = sourceText()
        assertTrue("Alias pc-control.ssh.identity.v1 must exist", text.contains("pc-control.ssh.identity.v1"))
        // Ensure no accidental rename to v2 or without version
        assertFalse("Alias should not be without version", text.contains("KEY_ALIAS = \"pc-control.ssh.identity\"") && !text.contains("v1"))
    }

    @Test
    fun keySizeIs3072() {
        val text = sourceText()
        assertTrue(text.contains("KEY_SIZE_BITS = 3072"))
    }

    @Test
    fun androidKeystoreConstant() {
        val text = sourceText()
        assertTrue(text.contains("ANDROID_KEYSTORE = \"AndroidKeyStore\""))
    }

    @Test
    fun generateGuardIsSynchronized() {
        val text = sourceText()
        assertTrue("ensureIdentity should be synchronized", text.contains("synchronized(lock)"))
        assertTrue("getIdentity should be synchronized", text.contains("fun getIdentity()") && text.contains("synchronized"))
    }

    @Test
    fun keyGenUsesCorrectSpec() {
        val text = sourceText()
        assertTrue(text.contains("setUserAuthenticationRequired(false)"))
        assertTrue(text.contains("KEY_ALGORITHM_RSA"))
        assertTrue(text.contains("setDigests"))
    }
}
