using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace PCControlSetup;

public record PairRequest(int ProtocolVersion, string OneTimeToken, string DeviceName, string SshPublicKey, string RequestSecret);
public record PcInfo(string HostId, string DisplayName, string Hostname, string CurrentLanIp, int LanPrefix, int SshPort, string SshUsername, string SshHostKeyFingerprint);
public record Bootstrap(int ProtocolVersion, string HostId, string DisplayName, string PairingEndpoint, string OneTimeToken, string PairingIdentityFingerprint, string TlsCertificateFingerprint, long ExpiresAt);

public static class Protocol
{
    public static string RandomHex(int bytes) => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(bytes));
    public static bool Equal(string? a, string? b) => a != null && b != null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    public static string Code(string token, string key, string fingerprint) => (BinaryPrimitives.ReadUInt32BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes(token + key + fingerprint))) % 1_000_000).ToString("D6");
    public static bool IsSecret(string? value) => value != null && Regex.IsMatch(value, "^[0-9a-f]{64}$");
    public static RSA ParseKey(string key)
    {
        if (key.Length > 8192 || key.Contains('\n') || key.Contains('\r')) throw new FormatException("Invalid public key");
        var parts = key.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || parts[0] != "ssh-rsa") throw new FormatException("Android RSA public key required");
        var blob = Convert.FromBase64String(parts[1]);
        var position = 0;
        byte[] Field()
        {
            if (position + 4 > blob.Length) throw new FormatException("Truncated SSH key");
            var length = BinaryPrimitives.ReadUInt32BigEndian(blob.AsSpan(position, 4)); position += 4;
            if (length > 2048 || length > blob.Length - position) throw new FormatException("Invalid SSH field");
            var value = blob.AsSpan(position, (int)length).ToArray(); position += (int)length; return value;
        }
        if (Encoding.ASCII.GetString(Field()) != "ssh-rsa") throw new FormatException("SSH algorithm mismatch");
        byte[] Positive(byte[] bytes)
        {
            if (bytes.Length == 0 || (bytes[0] & 128) != 0) throw new FormatException("Invalid mpint");
            return bytes[0] == 0 ? bytes[1..] : bytes;
        }
        var exponent = Positive(Field()); var modulus = Positive(Field());
        if (position != blob.Length || modulus.Length < 256 || modulus.Length > 1024) throw new FormatException("RSA key size invalid");
        var rsa = RSA.Create();
        try { rsa.ImportParameters(new RSAParameters { Exponent = exponent, Modulus = modulus }); return rsa; }
        catch { rsa.Dispose(); throw; }
    }
    public static string Fingerprint(string key) => "SHA256:" + Convert.ToBase64String(SHA256.HashData(Convert.FromBase64String(key.Split(' ', StringSplitOptions.RemoveEmptyEntries)[1]))).TrimEnd('=');
    public static bool Verify(string key, string id, string challenge, string signature)
    {
        try
        {
            using var rsa = ParseKey(key);
            return rsa.VerifyData(Encoding.UTF8.GetBytes($"pc-control-pairing-v1:{id}:{challenge}"), Convert.FromBase64String(signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        catch (Exception e) when (e is FormatException or CryptographicException) { return false; }
    }
}
