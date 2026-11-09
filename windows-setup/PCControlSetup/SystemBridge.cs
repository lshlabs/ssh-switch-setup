using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace PCControlSetup;

public sealed class SystemBridge
{
    private readonly SemaphoreSlim gate = new(1);
    public async Task<JsonElement> Run(string action, object? args = null)
    {
        await gate.WaitAsync();
        try
        {
            using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("PCControlSetup.SystemSetup.ps1")!;
            using var reader = new StreamReader(resource);
            var script = await reader.ReadToEndAsync();
            var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell/v1.0/powershell.exe"))
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            // Stream the embedded script to avoid Windows' 32K command-line limit and
            // avoid executing an elevated script from a user-writable temporary file.
            const string loader = "$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())); & ([scriptblock]::Create($source))";
            foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(loader)) }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            await process.StandardInput.WriteLineAsync(Convert.ToBase64String(Encoding.UTF8.GetBytes(script)));
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { action, args }));
            process.StandardInput.Close();
            // Do not kill DISM halfway through capability installation. UI remains asynchronous.
            await process.WaitForExitAsync();
            var text = await output;
            var diagnostics = await error;
            if (process.ExitCode != 0) throw new InvalidOperationException($"{action}: {diagnostics.Trim()}");
            return JsonDocument.Parse(text.Trim()).RootElement.Clone();
        }
        finally { gate.Release(); }
    }
}
