using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Xunit;

namespace PCControlSetup.Tests;
public class PairingTests
{
    private static string PublicKey(RSA rsa)
    {
        var p = rsa.ExportParameters(false);
        using var data = new MemoryStream();
        void Field(byte[] value)
        {
            Span<byte> length = stackalloc byte[4]; BinaryPrimitives.WriteInt32BigEndian(length, value.Length);
            data.Write(length); data.Write(value);
        }
        byte[] Positive(byte[] value) => (value[0] & 128) == 0 ? value : [0, .. value];
        Field(Encoding.ASCII.GetBytes("ssh-rsa")); Field(Positive(p.Exponent!)); Field(Positive(p.Modulus!));
        return "ssh-rsa " + Convert.ToBase64String(data.ToArray()) + " test-device";
    }
    private static HttpClient Client(PairingServer server, string? pin = null)
    {
        var expected = pin ?? server.Bootstrap.TlsCertificateFingerprint;
        return new HttpClient(new HttpClientHandler
        {
            UseProxy = false,
            ServerCertificateCustomValidationCallback = (_, cert, _, _) => cert != null &&
                Protocol.Equal(expected, Convert.ToHexStringLower(SHA256.HashData(cert.RawData)))
        }) { BaseAddress = new Uri(server.Bootstrap.PairingEndpoint) };
    }
    private static PcInfo Pc => new("test", "test", "test", "127.0.0.1", 8, 22, "test", "SHA256:test");
    [Fact] public void CrossLanguageCode() => Assert.Equal("315649", Protocol.Code("token", "key", "fingerprint"));
    [Fact] public async Task EmbeddedPowerShellBridgeStreamsScriptWithoutMutations()
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => new SystemBridge().Run("test-unknown-operation"));
        Assert.Contains("Unknown setup operation", error.Message);
    }
    [Fact] public async Task ExpiredSessionRejectsRequests()
    {
        await using var server = new PairingServer(Pc, _ => Task.CompletedTask, () => Task.CompletedTask, () => Task.CompletedTask, TimeSpan.FromMilliseconds(400));
        await server.Start(); using var client = Client(server);
        await Task.Delay(450);
        Assert.Equal(HttpStatusCode.Gone, (await client.GetAsync("/v1/requests")).StatusCode);
        Assert.Equal("expired", server.State);
    }
    [Theory]
    [InlineData("ssh-rsa AAAA")]
    [InlineData("command=evil ssh-rsa AAAA")]
    [InlineData("ssh-rsa AAAA\nssh-rsa BBBB")]
    public void RejectMalformedKeys(string value) => Assert.ThrowsAny<Exception>(() => Protocol.ParseKey(value));

    [Fact] public async Task ApprovalProofCommitAndReplayProtection()
    {
        var registrations = 0; var rollbacks = 0; var commits = 0;
        await using var server = new PairingServer(Pc, _ => { registrations++; return Task.CompletedTask; }, () => { rollbacks++; return Task.CompletedTask; }, () => { commits++; return Task.CompletedTask; });
        await server.Start();
        using var rsa = RSA.Create(2048); var publicKey = PublicKey(rsa); var secret = Protocol.RandomHex(32);
        using var client = Client(server);
        var payload = new PairRequest(1, server.Bootstrap.OneTimeToken, "phone", publicKey, secret);
        var denied = await client.PostAsJsonAsync("/v1/requests", payload with { OneTimeToken = Protocol.RandomHex(32) });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var response = await client.PostAsJsonAsync("/v1/requests", payload); response.EnsureSuccessStatusCode();
        var started = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = started.GetProperty("requestId").GetString(); var path = $"/v1/requests/{id}";
        Assert.Equal(0, registrations);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/v1/requests", payload)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(path)).StatusCode);
        client.DefaultRequestHeaders.Add("X-PC-Control-Request-Secret", secret);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/finalize", new { })).StatusCode);
        await server.Approve(true); Assert.Equal(1, registrations);
        var status = await client.GetFromJsonAsync<JsonElement>(path);
        var challenge = status.GetProperty("challenge").GetString();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(path + "/complete", new { signature = "bad" })).StatusCode);
        var signature = Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes($"pc-control-pairing-v1:{id}:{challenge}"), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        (await client.PostAsJsonAsync(path + "/complete", new { signature })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync(path + "/finalize", new { })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync(path + "/finalize", new { })).EnsureSuccessStatusCode();
        Assert.Equal(1, commits);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/cancel", new { })).StatusCode);
        Assert.Equal(0, rollbacks);
    }
    [Fact] public async Task WrongTlsPinBlocksConnection()
    {
        await using var server = new PairingServer(Pc, _ => Task.CompletedTask, () => Task.CompletedTask, () => Task.CompletedTask);
        await server.Start(); using var client = Client(server, new string('0', 64));
        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync("/v1/requests"));
    }
    [Fact] public async Task CancelAndCloseRollbackOnlyUncommittedRegistration()
    {
        var rollbacks = 0;
        var server = new PairingServer(Pc, _ => Task.CompletedTask, () => { rollbacks++; return Task.CompletedTask; }, () => Task.CompletedTask);
        await server.Start(); using var client = Client(server); using var rsa = RSA.Create(2048);
        var secret = Protocol.RandomHex(32);
        var response = await client.PostAsJsonAsync("/v1/requests", new PairRequest(1, server.Bootstrap.OneTimeToken, "phone", PublicKey(rsa), secret));
        var started = await response.Content.ReadFromJsonAsync<JsonElement>();
        await server.Approve(true);
        client.DefaultRequestHeaders.Add("X-PC-Control-Request-Secret", secret);
        (await client.PostAsJsonAsync($"/v1/requests/{started.GetProperty("requestId").GetString()}/cancel", new { })).EnsureSuccessStatusCode();
        await server.DisposeAsync(); Assert.Equal(1, rollbacks);
    }
}
