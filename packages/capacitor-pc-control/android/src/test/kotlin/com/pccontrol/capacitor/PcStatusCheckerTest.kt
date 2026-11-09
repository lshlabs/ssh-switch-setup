package com.pccontrol.capacitor

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito
import org.mockito.kotlin.any
import org.mockito.kotlin.whenever

class PcStatusCheckerTest {

    private lateinit var reachabilityChecker: HostReachabilityChecker
    private lateinit var checker: PcStatusChecker

    @Before
    fun setUp() {
        reachabilityChecker = Mockito.mock(HostReachabilityChecker::class.java)
        checker = PcStatusChecker(reachabilityChecker)
    }

    @Test
    fun check_withoutRouter_returnsOfflineWhenUnreachable() {
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        val result = checker.check("192.168.60.177", 22, 2000)
        assertEquals("offline", result.status)
        assertFalse(result.reachable)
        assertEquals("pc-unreachable", result.reason)
    }

    @Test
    fun check_withoutRouter_returnsOnlineWhenReachable() {
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(true, 15))
        val result = checker.check("192.168.60.177", 22, 2000)
        assertEquals("online", result.status)
        assertTrue(result.reachable)
        assertEquals(15L, result.latencyMs)
        assertEquals("reachable", result.reason)
    }

    @Test
    fun checkWithHomeNetwork_unknownWhenRouterUnreachable() {
        whenever(reachabilityChecker.check("192.168.60.1", 22, 2000)).thenReturn(HostReachabilityResult(false, null))
        val result = checker.checkWithHomeNetwork(
            pcHost = "192.168.60.177", pcPort = 22, pcTimeoutMs = 2000,
            routerHost = "192.168.60.1", routerPort = 22, routerTimeoutMs = 2000,
        )
        assertEquals("unknown", result.status)
        assertFalse(result.reachable)
        assertNull(result.latencyMs)
        assertEquals("network-unavailable", result.reason)
    }

    @Test
    fun checkWithHomeNetwork_onlineWhenBothReachable() {
        whenever(reachabilityChecker.check("192.168.60.1", 22, 2000)).thenReturn(HostReachabilityResult(true, 5))
        whenever(reachabilityChecker.check("192.168.60.177", 22, 2000)).thenReturn(HostReachabilityResult(true, 12))
        val result = checker.checkWithHomeNetwork(
            pcHost = "192.168.60.177", pcPort = 22, pcTimeoutMs = 2000,
            routerHost = "192.168.60.1", routerPort = 22, routerTimeoutMs = 2000,
        )
        assertEquals("online", result.status)
        assertTrue(result.reachable)
    }

    @Test
    fun checkWithHomeNetwork_offlineWhenRouterReachableButPcNot() {
        whenever(reachabilityChecker.check("192.168.60.1", 22, 2000)).thenReturn(HostReachabilityResult(true, 3))
        whenever(reachabilityChecker.check("192.168.60.177", 22, 2000)).thenReturn(HostReachabilityResult(false, null))
        val result = checker.checkWithHomeNetwork(
            pcHost = "192.168.60.177", pcPort = 22, pcTimeoutMs = 2000,
            routerHost = "192.168.60.1", routerPort = 22, routerTimeoutMs = 2000,
        )
        assertEquals("offline", result.status)
        assertFalse(result.reachable)
        assertEquals("pc-unreachable", result.reason)
    }

    @Test
    fun checkWithHomeNetwork_noRouterFallsBackToOffline() {
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        val result = checker.checkWithHomeNetwork(
            pcHost = "192.168.60.177", pcPort = 22, pcTimeoutMs = 2000,
            routerHost = null, routerPort = null,
        )
        assertEquals("offline", result.status)
        assertEquals("pc-unreachable", result.reason)
    }

    @Test
    fun checkAfterVpn_unknownWhenRouterIsUnavailable() {
        whenever(reachabilityChecker.checkUntilReachable("192.168.60.1", 22, 2500, 4000))
            .thenReturn(HostReachabilityResult(false, null))
        val result = checker.checkAfterVpn(
            host = "192.168.60.177",
            port = 22,
            timeoutMs = 2500,
            maxWaitMs = 4000,
            routerHost = "192.168.60.1",
            routerPort = 22,
        )
        assertEquals("unknown", result.status)
        assertFalse(result.reachable)
        assertEquals("network-unavailable", result.reason)
    }

    @Test
    fun checkAfterVpn_offlineWhenRouterIsReachableButPcIsNot() {
        whenever(reachabilityChecker.checkUntilReachable("192.168.60.1", 22, 2500, 4000))
            .thenReturn(HostReachabilityResult(true, 5))
        whenever(reachabilityChecker.checkUntilReachable("192.168.60.177", 22, 2500, 4000))
            .thenReturn(HostReachabilityResult(false, null))
        val result = checker.checkAfterVpn(
            host = "192.168.60.177",
            port = 22,
            timeoutMs = 2500,
            maxWaitMs = 4000,
            routerHost = "192.168.60.1",
            routerPort = 22,
        )
        assertEquals("offline", result.status)
        assertEquals("pc-unreachable", result.reason)
    }
}
