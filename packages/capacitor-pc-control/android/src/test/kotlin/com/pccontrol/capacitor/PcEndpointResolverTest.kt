package com.pccontrol.capacitor

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.mockito.Mockito
import org.mockito.kotlin.any
import org.mockito.kotlin.eq
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

class PcEndpointResolverTest {
    private val reachability = Mockito.mock(HostReachabilityChecker::class.java)
    private val ssh = Mockito.mock(NativeSshClient::class.java)
    private val settings = Mockito.mock(AppSettingsStore::class.java)

    @Test
    fun rediscoversOnlyTheHostWithThePinnedKeyAndPersistsItsAddress() {
        whenever(settings.get()).thenReturn(mapOf(AppSettingsStore.KEY_PC_LAN_PREFIX to 24))
        whenever(reachability.check(any(), any(), any())).thenAnswer { call ->
            HostReachabilityResult(call.getArgument<String>(0) in setOf("192.168.8.20", "192.168.8.30"), null)
        }
        whenever(ssh.scanHostKey(eq("192.168.8.20"), eq(22), any())).thenReturn(
            SshHostKeyInfo("192.168.8.20", 22, "ecdsa-sha2-nistp256", "SHA256:other", false),
        )
        whenever(ssh.scanHostKey(eq("192.168.8.30"), eq(22), any())).thenReturn(
            SshHostKeyInfo("192.168.8.30", 22, "ecdsa-sha2-nistp256", "SHA256:known", false),
        )
        val resolved = PcEndpointResolver(reachability, ssh, settings, null, { true })
            .connectToPC("192.168.8.10", 22, "SHA256:known")
        assertEquals("192.168.8.30", resolved)
        verify(ssh).trustScannedHostKey("192.168.8.30", 22, "ecdsa-sha2-nistp256", "SHA256:known")
        verify(settings).set(mapOf(AppSettingsStore.KEY_PC_HOST to "192.168.8.30"))
    }

    @Test
    fun rejectsAReachableAddressWhoseHostKeyChanged() {
        whenever(reachability.check(eq("192.168.8.10"), eq(22), any())).thenReturn(HostReachabilityResult(true, 1))
        whenever(ssh.scanHostKey(eq("192.168.8.10"), eq(22), any())).thenReturn(
            SshHostKeyInfo("192.168.8.10", 22, "ecdsa-sha2-nistp256", "SHA256:other", false),
        )
        try {
            PcEndpointResolver(reachability, ssh, settings, null, { true })
                .connectToPC("192.168.8.10", 22, "SHA256:known")
            fail("A changed SSH identity must stop the connection")
        } catch (error: NativeSshException) {
            assertEquals(SshErrorCode.HOST_KEY_MISMATCH, error.errorCode)
        }
    }

    @Test
    fun samplesBeyondTheLastOctetWhenSavedPrefixIsSixteen() {
        whenever(settings.get()).thenReturn(mapOf(AppSettingsStore.KEY_PC_LAN_PREFIX to 16))
        whenever(reachability.check(any(), any(), any())).thenAnswer { call ->
            HostReachabilityResult(call.getArgument<String>(0) == "192.168.10.10", null)
        }
        whenever(ssh.scanHostKey(eq("192.168.10.10"), eq(22), any())).thenReturn(
            SshHostKeyInfo("192.168.10.10", 22, "ecdsa-sha2-nistp256", "SHA256:known", false),
        )
        val resolved = PcEndpointResolver(reachability, ssh, settings, null, { true })
            .connectToPC("192.168.8.10", 22, "SHA256:known")
        assertEquals("192.168.10.10", resolved)
    }
}
