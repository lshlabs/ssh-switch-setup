using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media.Imaging;
using QRCoder;

namespace PCControlSetup;
public partial class MainWindow : Window
{
    private readonly SystemBridge system = new();
    private readonly SemaphoreSlim operations = new(1);
    private readonly Mutex singleInstance;
    private PairingServer? server;
    private PcInfo? pc;
    private string? firewall;
    private bool closing;
    private record NetworkChoice(string Ip, int Prefix, string Category, string Label);
    public MainWindow()
    {
        singleInstance = new Mutex(true, "Global\\PCControlSetup.Part1", out var first);
        InitializeComponent();
        if (!first) { MessageBox.Show("다른 PC Control Setup 창을 먼저 닫으세요."); closing = true; Close(); return; }
        Status.Text = "관리자 권한으로 실행 중입니다. 환경 진단부터 시작하세요. 시스템 변경은 구성 버튼을 누를 때 수행합니다.";
    }
    private async Task Run(Func<Task> work)
    {
        if (!await operations.WaitAsync(0)) { MessageBox.Show("현재 작업이 끝날 때까지 기다려 주세요."); return; }
        InspectButton.IsEnabled = PrepareButton.IsEnabled = PairButton.IsEnabled = false;
        try { await work(); }
        catch (Exception e) { Status.Text = "작업 실패: " + e.Message + "\n미완료 등록이 있으면 복구를 실행하세요. 기존 sshd_config는 변경하지 않았습니다."; }
        finally { InspectButton.IsEnabled = PrepareButton.IsEnabled = PairButton.IsEnabled = true; operations.Release(); }
    }
    private async void Inspect(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var info = await system.Run("inspect");
        Account.ItemsSource = info.GetProperty("accounts").EnumerateArray().Select(x => x.GetString()).ToArray();
        Network.ItemsSource = info.GetProperty("networks").EnumerateArray().Select(x => new NetworkChoice(x.GetProperty("ip").GetString()!, x.GetProperty("prefix").GetInt32(), x.GetProperty("category").GetString()!, $"{x.GetProperty("adapter").GetString()} · {x.GetProperty("ip").GetString()} · {x.GetProperty("category").GetString()}")).ToArray();
        Status.Text = JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true });
    });
    private async void Prepare(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await Stop(); pc = null;
        if (Account.SelectedItem is not string username || Network.SelectedItem is not NetworkChoice net) throw new InvalidOperationException("계정과 네트워크를 선택하세요.");
        if (net.Category != "Private") throw new InvalidOperationException("선택한 네트워크가 Private이 아닙니다. Windows 설정에서 신뢰할 수 있는 LAN인지 확인하세요.");
        Status.Text = "OpenSSH 구성 중입니다. Windows 기능 설치는 몇 분 걸릴 수 있습니다. 완료될 때까지 기다리세요.";
        var result = await system.Run("prepare", new { username, ip = net.Ip });
        pc = new(Environment.MachineName, Environment.MachineName, Environment.MachineName, net.Ip, net.Prefix, result.GetProperty("port").GetInt32(), username, result.GetProperty("fingerprint").GetString()!);
        Status.Text = $"SSH 준비됨 · {pc.CurrentLanIp}:{pc.SshPort} · {pc.SshUsername}\n{pc.SshHostKeyFingerprint}\n키 경로: {result.GetProperty("path").GetString()}\n백업: {result.GetProperty("backup").GetString()}\n실제 Android SSH 인증은 아직 검증하지 않았습니다.";
    });
    private async void StartPairing(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await Stop();
        var target = pc ?? throw new InvalidOperationException("먼저 SSH 환경 구성을 완료하세요.");
        await system.Run("recoverFirewall");
        server = new PairingServer(target,
            async key => { await system.Run("register", new { username = target.SshUsername, ip = target.CurrentLanIp, publicKey = key }); },
            async () => { await system.Run("rollback"); }, async () => { await system.Run("commit"); });
        server.Changed += () => Dispatcher.BeginInvoke(() => ShowPairing());
        server.CleanupFailed += error => Dispatcher.BeginInvoke(() => Status.Text = "복구 실패: " + error);
        try
        {
            await server.Start();
            firewall = "PCControlSetup-Pair-" + Protocol.RandomHex(16);
            await system.Run("openFirewall", new { name = firewall, ip = target.CurrentLanIp, port = new Uri(server.Bootstrap.PairingEndpoint).Port, program = Environment.ProcessPath });
            BootstrapText.Text = JsonSerializer.Serialize(server.Bootstrap, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(BootstrapText.Text, QRCodeGenerator.ECCLevel.M);
            using var png = new PngByteQRCode(data);
            using var stream = new MemoryStream(png.GetGraphic(5));
            var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.StreamSource = stream; bitmap.EndInit(); Qr.Source = bitmap;
            ShowPairing();
        }
        catch { await Stop(); throw; }
    });
    private void ShowPairing()
    {
        if (server == null) return;
        Pending.Text = $"상태: {server.State} · SSH 계정: {pc?.SshUsername} · PC: {pc?.CurrentLanIp}\n기기: {server.DeviceName}\n공개키: {server.KeyFingerprint}\n확인 코드: {server.ConfirmationCode}";
        ApproveButton.IsEnabled = RejectButton.IsEnabled = server.State == "pending";
        if (server.State is "completed" or "expired" or "cancelled" or "rejected" or "failed")
        {
            var final = server.State;
            // Allow finalize/cancel response to flush before stopping Kestrel.
            _ = FinishSession(final, server);
        }
    }
    private async Task FinishSession(string final, PairingServer finished)
    {
        await Task.Delay(1500);
        await Run(async () => { if (!ReferenceEquals(server, finished)) return; await Stop(); Status.Text = final == "completed" ? "페어링 완료. Android가 SSH 인증 후 연결 정보를 저장했습니다. 종료·재부팅과 VPN은 아직 실기기 검증이 필요합니다." : $"페어링 {final}. 임시 리소스를 정리했습니다."; });
    }
    private async void Approve(object sender, RoutedEventArgs e) => await Run(async () => { if (server != null) await server.Approve(true); });
    private async void Reject(object sender, RoutedEventArgs e) => await Run(async () => { if (server != null) await server.Approve(false); });
    private async void StopPairing(object sender, RoutedEventArgs e) => await Run(Stop);
    private async Task Stop()
    {
        try { if (server != null) { var old = server; server = null; await old.DisposeAsync(); } }
        finally
        {
            if (firewall != null) { await system.Run("closeFirewall", new { name = firewall }); firewall = null; }
            Qr.Source = null; BootstrapText.Clear(); ApproveButton.IsEnabled = RejectButton.IsEnabled = false;
        }
    }
    private async void Recover(object sender, RoutedEventArgs e) => await Run(async () => { await Stop(); await system.Run("rollback"); await system.Run("recoverFirewall"); Status.Text = "미완료 공개키 등록 및 임시 방화벽 복구 완료. OpenSSH 서비스는 유지됩니다."; });
    private async void ManualRegister(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await Stop(); var target = pc ?? throw new InvalidOperationException("먼저 SSH 환경을 구성하세요.");
        var key = ManualKey.Text.Trim(); using var parsed = Protocol.ParseKey(key);
        if (MessageBox.Show($"이 공개키의 셸 접근을 승인합니까?\n{Protocol.Fingerprint(key)}\n계정: {target.SshUsername}", "수동 공개키 등록", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
        try { await system.Run("register", new { username = target.SshUsername, ip = target.CurrentLanIp, publicKey = key }); await system.Run("commit"); }
        catch { await system.Run("rollback"); throw; }
        ManualKey.Clear(); Status.Text = $"수동 등록 완료. Android에서 {target.CurrentLanIp}:{target.SshPort} / {target.SshUsername} 입력 후 아래 호스트 지문을 비교하고 연결 테스트하세요.\n{target.SshHostKeyFingerprint}\nSSH 인증은 아직 미검증입니다.";
    });
    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (closing) return;
        e.Cancel = true;
        if (!await operations.WaitAsync(0)) { MessageBox.Show("실행 중인 설정 작업이 끝나면 닫을 수 있습니다."); return; }
        try { await Stop(); closing = true; singleInstance.Dispose(); Close(); }
        catch (Exception error) { Status.Text = "정리 실패. 복구 후 다시 닫으세요: " + error.Message; }
        finally { operations.Release(); }
    }
}
