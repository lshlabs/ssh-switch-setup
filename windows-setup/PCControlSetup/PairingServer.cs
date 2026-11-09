using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace PCControlSetup;

public sealed class PairingServer : IAsyncDisposable
{
    private readonly PcInfo pc;
    private readonly Func<string, Task> register;
    private readonly Func<Task> rollback;
    private readonly Func<Task> commit;
    private readonly SemaphoreSlim gate = new(1);
    private readonly CancellationTokenSource lifetime = new();
    private readonly X509Certificate2 certificate;
    private WebApplication? app;
    private PairRequest? request;
    private string id = "", secretHash = "", challenge = "";
    private bool registered, disposed;
    private int invalidAttempts;
    public string State { get; private set; } = "ready";
    public Bootstrap Bootstrap { get; private set; }
    public string DeviceName => request?.DeviceName ?? "";
    public string KeyFingerprint => request == null ? "" : Protocol.Fingerprint(request.SshPublicKey);
    public string ConfirmationCode => request == null ? "" : Protocol.Code(Bootstrap.OneTimeToken, request.SshPublicKey, pc.SshHostKeyFingerprint);
    public event Action? Changed;
    public event Action<string>? CleanupFailed;

    public PairingServer(PcInfo pc, Func<string, Task> register, Func<Task> rollback, Func<Task> commit, TimeSpan? sessionLifetime = null)
    {
        this.pc = pc; this.register = register; this.rollback = rollback; this.commit = commit;
        using var rsa = RSA.Create(2048);
        var certRequest = new CertificateRequest("CN=PC Control ephemeral pairing", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); san.AddIpAddress(IPAddress.Parse(pc.CurrentLanIp));
        certRequest.CertificateExtensions.Add(san.Build());
        certRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        certRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new("1.3.6.1.5.5.7.3.1") }, true));
        using var temporary = certRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(15));
        // Windows Schannel requires a named private-key container. Without PersistKeySet,
        // the imported temporary container is removed when the certificate is disposed.
        certificate = X509CertificateLoader.LoadPkcs12(temporary.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.UserKeySet);
        Bootstrap = new(1, pc.HostId, pc.DisplayName, "", Protocol.RandomHex(32), pc.SshHostKeyFingerprint,
            Convert.ToHexStringLower(SHA256.HashData(certificate.RawData)), DateTimeOffset.UtcNow.Add(sessionLifetime ?? TimeSpan.FromMinutes(10)).ToUnixTimeMilliseconds());
    }

    public async Task Start()
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders(); // Never log request bodies or bootstrap secrets.
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = 16 * 1024;
            options.Limits.MaxConcurrentConnections = 8;
            options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            options.Listen(IPAddress.Parse(pc.CurrentLanIp), 0, listener => listener.UseHttps(certificate));
        });
        app = builder.Build();
        app.Run(Handle);
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        Bootstrap = Bootstrap with { PairingEndpoint = address };
        _ = Expire();
    }

    private async Task Expire()
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(Math.Max(0, Bootstrap.ExpiresAt - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())), lifetime.Token);
            await gate.WaitAsync();
            try
            {
                if (!disposed && State != "completed")
                {
                    try { await Rollback(); }
                    finally { State = "expired"; Changed?.Invoke(); }
                }
            }
            finally { gate.Release(); }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { CleanupFailed?.Invoke(e.Message); }
    }

    private async Task Handle(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (!await gate.WaitAsync(TimeSpan.FromSeconds(1))) { context.Response.StatusCode = 503; return; }
        try
        {
            if (disposed || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= Bootstrap.ExpiresAt) { context.Response.StatusCode = 410; return; }
            var path = context.Request.Path.Value;
            if (path == "/v1/requests" && context.Request.Method == "POST")
            {
                if (request != null) { context.Response.StatusCode = 409; return; }
                var incoming = await context.Request.ReadFromJsonAsync<PairRequest>();
                if (invalidAttempts >= 20) { context.Response.StatusCode = 429; return; }
                if (incoming == null || incoming.ProtocolVersion != 1 || !Protocol.Equal(incoming.OneTimeToken, Bootstrap.OneTimeToken) || !Protocol.IsSecret(incoming.RequestSecret)) { invalidAttempts++; context.Response.StatusCode = 403; return; }
                if (string.IsNullOrWhiteSpace(incoming.DeviceName) || incoming.DeviceName.Length > 80 || incoming.DeviceName.Any(char.IsControl) || incoming.SshPublicKey == null) { context.Response.StatusCode = 400; return; }
                using var key = Protocol.ParseKey(incoming.SshPublicKey);
                request = incoming with { RequestSecret = "", OneTimeToken = "" };
                secretHash = Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(incoming.RequestSecret)));
                id = Protocol.RandomHex(16); challenge = Protocol.RandomHex(32); State = "pending";
                Changed?.Invoke();
                await context.Response.WriteAsJsonAsync(new { requestId = id, confirmationCode = ConfirmationCode, expiresAt = Bootstrap.ExpiresAt }); return;
            }
            var supplied = context.Request.Headers["X-PC-Control-Request-Secret"].ToString();
            if (request == null || !Protocol.IsSecret(supplied) || !Protocol.Equal(secretHash, Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(supplied))))) { context.Response.StatusCode = 403; return; }
            var basePath = $"/v1/requests/{id}";
            if (path == basePath && context.Request.Method == "GET")
            {
                await context.Response.WriteAsJsonAsync(new { state = State, requestId = id, confirmationCode = ConfirmationCode, pc = State == "verifying" ? pc : null, challenge = State == "verifying" ? challenge : null }); return;
            }
            if (context.Request.Method != "POST") { context.Response.StatusCode = 405; return; }
            if (path == basePath + "/complete")
            {
                var body = await context.Request.ReadFromJsonAsync<JsonElement>();
                if (State is not ("verifying" or "verified") || !body.TryGetProperty("signature", out var sig) || sig.ValueKind != JsonValueKind.String || !Protocol.Verify(request.SshPublicKey, id, challenge, sig.GetString()!)) { context.Response.StatusCode = 403; return; }
                State = "verified"; Changed?.Invoke(); await context.Response.WriteAsJsonAsync(new { verified = true }); return;
            }
            if (path == basePath + "/finalize")
            {
                if (State is not ("verified" or "completed")) { context.Response.StatusCode = 409; return; }
                if (State != "completed") { await commit(); registered = false; State = "completed"; Changed?.Invoke(); }
                await context.Response.WriteAsJsonAsync(new { completed = true }); return;
            }
            if (path == basePath + "/cancel")
            {
                if (State == "completed") { context.Response.StatusCode = 409; return; }
                await Rollback(); State = "cancelled"; Changed?.Invoke(); await context.Response.WriteAsJsonAsync(new { cancelled = true }); return;
            }
            context.Response.StatusCode = 404;
        }
        catch (Exception e) when (e is JsonException or FormatException or CryptographicException or BadHttpRequestException)
        { context.Response.StatusCode = 400; }
        catch (Exception)
        {
            State = "failed"; Changed?.Invoke(); context.Response.StatusCode = 500;
        }
        finally { gate.Release(); }
    }

    public async Task Approve(bool approved)
    {
        await gate.WaitAsync();
        try
        {
            if (State != "pending" || request == null || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= Bootstrap.ExpiresAt) throw new InvalidOperationException("No active approval request");
            if (!approved) { State = "rejected"; Changed?.Invoke(); return; }
            State = "registering"; Changed?.Invoke();
            registered = true; // Roll back even if the register operation fails after writing its journal.
            try { await register(request.SshPublicKey); State = "verifying"; }
            catch { State = "failed"; await Rollback(); throw; }
            finally { Changed?.Invoke(); }
        }
        finally { gate.Release(); }
    }
    private async Task Rollback() { if (registered) { await rollback(); registered = false; } }
    public async ValueTask DisposeAsync()
    {
        await gate.WaitAsync();
        try { if (disposed) return; disposed = true; lifetime.Cancel(); await Rollback(); }
        finally
        {
            gate.Release();
            if (app != null) { await app.StopAsync(); await app.DisposeAsync(); app = null; }
            certificate.Dispose();
        }
    }
}
