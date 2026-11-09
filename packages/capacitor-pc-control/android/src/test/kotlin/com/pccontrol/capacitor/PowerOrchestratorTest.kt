package com.pccontrol.capacitor

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito
import org.mockito.kotlin.any
import org.mockito.kotlin.whenever
import org.mockito.kotlin.verify
import org.mockito.kotlin.never
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class PowerOrchestratorTest {

    private lateinit var reachabilityChecker: HostReachabilityChecker
    private lateinit var homeNetworkOrchestrator: HomeNetworkOrchestrator
    private lateinit var sshClient: NativeSshClient
    private lateinit var openVpnClient: OpenVpnExternalApiClient
    private lateinit var pcStatusChecker: PcStatusChecker

    private val noOpSleeper = Sleeper { _ -> /* no delay */ }

    private class FakeClock : MonotonicClock {
        var time: Long = 0L
        override fun nanoTime(): Long = time.also { time += TimeUnit.MILLISECONDS.toNanos(10) }
    }

    @Before
    fun setUp() {
        reachabilityChecker = Mockito.mock(HostReachabilityChecker::class.java)
        homeNetworkOrchestrator = Mockito.mock(HomeNetworkOrchestrator::class.java)
        sshClient = Mockito.mock(NativeSshClient::class.java)
        openVpnClient = Mockito.mock(OpenVpnExternalApiClient::class.java)
        pcStatusChecker = Mockito.mock(PcStatusChecker::class.java)
    }

    private fun baseRequest(
        action: String = "power-on",
        autoDisconnect: Boolean = false,
        wakeTimeout: Int = 200,
        shutdownTimeout: Int = 200,
        rebootOfflineTimeout: Int = 200,
        rebootOnlineTimeout: Int = 200,
        pollInterval: Int = 20,
    ) = PowerActionRequest(
        action = action,
        pcHost = "192.168.60.177",
        pcPort = 22,
        pcUsername = "admin",
        pcHostFingerprint = null,
        routerHost = "192.168.60.1",
        routerPort = 22,
        routerUsername = "testuser",
        routerHostFingerprint = null,
        macAddress = "2C:F0:5D:83:5B:07",
        wolInterface = "br0",
        autoDisconnectVpn = autoDisconnect,
        initialStatusTimeoutMs = 100,
        pollIntervalMs = pollInterval,
        wakeTimeoutMs = wakeTimeout,
        shutdownTimeoutMs = shutdownTimeout,
        rebootOfflineTimeoutMs = rebootOfflineTimeout,
        rebootOnlineTimeoutMs = rebootOnlineTimeout,
        connectTimeoutMs = 100,
        commandTimeoutMs = 100,
        reachabilityTimeoutMs = 100,
        postConnectReachabilityTimeoutMs = 100,
        vpnDisconnectTimeoutMs = 100,
    )

    private fun orchestrator(
        sleeper: Sleeper = noOpSleeper,
        clock: MonotonicClock = FakeClock(),
    ) = PowerOrchestrator(
        reachabilityChecker = reachabilityChecker,
        homeNetworkOrchestrator = homeNetworkOrchestrator,
        sshClient = sshClient,
        openVpnClient = openVpnClient,
        pcStatusChecker = pcStatusChecker,
        sleeper = sleeper,
        clock = clock,
    )

    private fun mockHomeNetwork(path: String = "local", vpnStarted: Boolean = false) {
        whenever(homeNetworkOrchestrator.ensure(any())).thenReturn(
            EnsureHomeNetworkResult(path = path, vpnWasStartedByApp = vpnStarted)
        )
    }

    // Power On

    @Test
    fun powerOn_offline_to_online_success() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(true, 10))
        val result = orchestrator().run(baseRequest("power-on"))
        assertEquals("online", result.finalStatus)
        assertEquals("offline", result.previousStatus)
        assertTrue(result.commandExecuted)
        assertEquals("vpn", result.networkPath)
        verify(sshClient).execute(any())
    }

    @Test
    fun powerOn_already_online_noOp() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 5))
        val result = orchestrator().run(baseRequest("power-on"))
        assertEquals("online", result.finalStatus)
        assertFalse(result.commandExecuted)
        verify(sshClient, never()).execute(any())
    }

    @Test
    fun powerOn_wakeTimeout_throws() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        val clock = FakeClock()
        // Make clock advance very slowly so deadline expires quickly with no reachable
        // Using fake clock that increments 10ms per nanoTime, wakeTimeout 50ms will expire after ~5 checks
        try {
            orchestrator(sleeper = noOpSleeper, clock = clock).run(baseRequest("power-on", wakeTimeout = 50, pollInterval = 10))
            fail("expected PC_WAKE_TIMEOUT")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.PC_WAKE_TIMEOUT, e.errorCode)
        }
    }

    // Shutdown

    @Test
    fun shutdown_online_to_offline_success() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        val result = orchestrator().run(baseRequest("shutdown"))
        assertEquals("offline", result.finalStatus)
        assertTrue(result.commandExecuted)
    }

    @Test
    fun shutdown_already_offline_noOp() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        val result = orchestrator().run(baseRequest("shutdown"))
        assertEquals("offline", result.finalStatus)
        assertFalse(result.commandExecuted)
        verify(sshClient, never()).execute(any())
    }

    @Test
    fun shutdown_pcOnly_doesNotRequireHomeNetworkOrVpnProfile() {
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        val result = orchestrator().run(baseRequest("shutdown").copy(routerHost = null, routerPort = null))
        assertEquals("offline", result.finalStatus)
        verify(homeNetworkOrchestrator, never()).ensure(any())
    }

    @Test
    fun shutdown_timeout_throws() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(true, 10))
        try {
            orchestrator().run(baseRequest("shutdown", shutdownTimeout = 50, pollInterval = 10))
            fail("expected PC_SHUTDOWN_TIMEOUT")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.PC_SHUTDOWN_TIMEOUT, e.errorCode)
        }
    }

    // Reboot

    @Test
    fun reboot_online_offline_online_success() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        // First pollUntilUnreachable: need false->true? Actually pollUntilUnreachable returns true when unreachable.
        // We make reachabilityChecker return false (unreachable) immediately, then true (reachable) for second phase.
        // Use sequential answers: first call unreachable, second call reachable.
        whenever(reachabilityChecker.check(any(), any(), any()))
            .thenReturn(HostReachabilityResult(false, null)) // for offline wait: immediate success
            .thenReturn(HostReachabilityResult(true, 10)) // for online wait: immediate success
        val result = orchestrator().run(baseRequest("reboot"))
        assertEquals("online", result.finalStatus)
        assertTrue(result.commandExecuted)
    }

    @Test
    fun reboot_initial_offline_fails() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        try {
            orchestrator().run(baseRequest("reboot"))
            fail("expected POWER_COMMAND_FAILED")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.POWER_COMMAND_FAILED, e.errorCode)
        }
    }

    @Test
    fun reboot_offlineTimeout_throws() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(true, 10))
        try {
            orchestrator().run(baseRequest("reboot", rebootOfflineTimeout = 50, pollInterval = 10))
            fail("expected PC_REBOOT_OFFLINE_TIMEOUT")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.PC_REBOOT_OFFLINE_TIMEOUT, e.errorCode)
        }
    }

    @Test
    fun reboot_onlineReturnTimeout_throws() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any()))
            .thenReturn(HostReachabilityResult(false, null)) // offline wait succeeds
            .thenReturn(HostReachabilityResult(false, null)) // online wait: never reachable
            .thenReturn(HostReachabilityResult(false, null))
        try {
            orchestrator().run(baseRequest("reboot", rebootOnlineTimeout = 50, pollInterval = 10))
            fail("expected PC_REBOOT_ONLINE_TIMEOUT")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.PC_REBOOT_ONLINE_TIMEOUT, e.errorCode)
        }
    }

    // Concurrency

    @Test
    fun concurrency_secondActionWhileInProgress_throws() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        // Make reachability never reachable so power-on will poll for full timeout (200ms)
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        val blockingSleeper = Sleeper { ms -> Thread.sleep(20) }
        val orch = orchestrator(sleeper = blockingSleeper, clock = SystemClock())
        val latch = CountDownLatch(1)
        val errorRef = AtomicReference<Throwable>()
        val t = Thread {
            try {
                orch.run(baseRequest("power-on", wakeTimeout = 400, pollInterval = 20))
            } catch (e: Throwable) {
                errorRef.set(e)
            } finally {
                latch.countDown()
            }
        }
        t.start()
        Thread.sleep(60) // let first acquire lock
        try {
            orch.run(baseRequest("shutdown"))
            fail("expected POWER_ACTION_IN_PROGRESS")
        } catch (e: NativeNetworkException) {
            assertEquals(NetworkErrorCode.POWER_ACTION_IN_PROGRESS, e.errorCode)
        } finally {
            latch.await(2, TimeUnit.SECONDS)
        }
    }

    // VPN ownership

    @Test
    fun vpnOwnership_true_autoDisconnect_callsDisconnect() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        whenever(openVpnClient.disconnect(any(), any())).thenReturn(NativeOpenVpnStatus(NativeVpnStatus.DISCONNECTED, null, false))
        orchestrator().run(baseRequest("shutdown", autoDisconnect = true))
        verify(openVpnClient).disconnect(true, 100)
    }

    @Test
    fun vpnOwnership_disconnectFailure_isReportedOnSuccessfulAction() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("offline", false, null))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(true, 10))
        whenever(openVpnClient.disconnect(any(), any())).thenThrow(RuntimeException("disconnect failed"))
        val result = orchestrator().run(baseRequest("power-on", autoDisconnect = true))
        assertTrue(result.vpnDisconnectFailed)
    }

    @Test
    fun vpnOwnership_false_noDisconnect() {
        mockHomeNetwork("local", false)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        orchestrator().run(baseRequest("shutdown", autoDisconnect = true))
        verify(openVpnClient, never()).disconnect(any(), any())
    }

    @Test
    fun vpnOwnership_true_autoDisconnectFalse_noDisconnect() {
        mockHomeNetwork("vpn", true)
        whenever(pcStatusChecker.check(any(), any(), any())).thenReturn(PcStatusResult("online", true, 10))
        whenever(reachabilityChecker.check(any(), any(), any())).thenReturn(HostReachabilityResult(false, null))
        orchestrator().run(baseRequest("shutdown", autoDisconnect = false))
        verify(openVpnClient, never()).disconnect(any(), any())
    }
}
