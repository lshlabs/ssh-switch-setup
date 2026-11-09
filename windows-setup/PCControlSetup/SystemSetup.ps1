$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$a = $request.args
$root = Join-Path $env:ProgramData 'PCControlSetup'
$journal = Join-Path $root 'pending.json'
$sshRoot = Join-Path $env:ProgramData 'ssh'
$sshd = Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
$utf8 = [Text.UTF8Encoding]::new($false)

function No-Link([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse-point paths are not supported.' }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }; $cursor = $parent
    }
}
function Protect([string]$Path, [string]$Sid, [bool]$Directory) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($Sid))
    foreach ($id in @('S-1-5-18', 'S-1-5-32-544', $Sid) | Select-Object -Unique) {
        $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id), 'FullControl', $inherit, 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Init-State {
    No-Link $root
    if (!(Test-Path -LiteralPath $root)) { [void][IO.Directory]::CreateDirectory($root) }
    Protect $root 'S-1-5-32-544' $true
}
function Write-Journal($value) {
    $temp = Join-Path $root 'pending.tmp'
    [IO.File]::WriteAllText($temp, ($value | ConvertTo-Json -Depth 8), $utf8)
    Move-Item -LiteralPath $temp -Destination $journal -Force
}
function Key-Update([byte[]]$Before, [string]$PublicKey) {
    $decoder = [Text.UTF8Encoding]::new($false, $true)
    $text = $decoder.GetString($Before)
    if ($text.Contains([char]0)) { throw 'authorized_keys must be UTF-8, not UTF-16.' }
    $blob = ($PublicKey -split ' ')[1]
    $matching = @($text -split '\r?\n' | Where-Object { $_ -notmatch '^\s*#' -and $_ -match ('(^|\s)' + [regex]::Escape($blob) + '(\s|$)') })
    $duplicate = @($matching | Where-Object { $_ -match ('^\s*ssh-rsa\s+' + [regex]::Escape($blob) + '(\s|$)') }).Count -gt 0
    if ($matching.Count -gt 0 -and !$duplicate) { throw 'This key already has restrictions. Preserve its policy and register manually.' }
    $suffix = if ($duplicate) { '' } else { $(if ($Before.Length -gt 0 -and !$text.EndsWith("`n")) { "`r`n" }) + $PublicKey + "`r`n" }
    return @{ bytes=[byte[]]($Before + $decoder.GetBytes($suffix)); duplicate=$duplicate }
}
function Effective([string]$Username) {
    $serviceConfig = Get-CimInstance Win32_Service -Filter "Name='sshd'"
    if ($serviceConfig -and $serviceConfig.PathName.Trim('"') -ine $sshd) { throw 'Custom SSH service binary or arguments require manual review.' }
    # Address-dependent Match can select a different key path for each phone. Fail closed.
    $configPath = Join-Path $sshRoot 'sshd_config'
    if (Test-Path -LiteralPath $configPath) {
        $config = [IO.File]::ReadAllText($configPath)
        if ($config -match '(?im)^\s*Include\s' -or $config -match '(?im)^\s*Match\s+.*\b(Address|LocalAddress|LocalPort|Host|RDomain|exec)\b') {
            throw 'Custom Include/address-dependent Match configuration requires manual administrator review.'
        }
    }
    $lines = @(& $sshd -T -C "user=$Username,host=localhost,addr=127.0.0.1" 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'sshd configuration validation failed. Review sshd_config with sshd -t.' }
    return $lines
}
function Describe([string]$Username, [string]$Ip) {
    if ($Username -notmatch '^[a-zA-Z0-9_.-]{1,64}$') { throw 'Select a supported local account (letters, digits, underscore, dot, hyphen).' }
    $account = Get-LocalUser -Name $Username
    if (!$account.Enabled) { throw 'Account is disabled.' }
    $profile = Get-CimInstance Win32_UserProfile | Where-Object SID -eq $account.SID.Value | Select-Object -First 1
    if (!$profile) { throw 'Sign in to the selected Windows account once before setup.' }
    $lines = Effective $Username
    if ($lines -notcontains 'pubkeyauthentication yes') { throw 'Public-key authentication is disabled; existing policy was preserved.' }
    $ports = @($lines | Where-Object { $_ -match '^port ' } | ForEach-Object { [int](($_ -split ' ')[1]) })
    if ($ports.Count -ne 1) { throw 'Multiple SSH ports require manual review.' }
    $keyLine = @($lines | Where-Object { $_ -match '^authorizedkeysfile ' })[0]
    $keyPaths = @($keyLine -split '\s+' | Select-Object -Skip 1)
    if ($keyPaths.Count -ne 1) { throw 'Multiple authorized key paths require manual review.' }
    $keyPath = $keyPaths[0].Replace('__PROGRAMDATA__', $env:ProgramData).Replace('%h', $profile.LocalPath).Replace('%u', $Username)
    if ($keyPath.Contains('%')) { throw 'Unsupported authorized_keys path token.' }
    if (![IO.Path]::IsPathRooted($keyPath)) { $keyPath = Join-Path $profile.LocalPath $keyPath }
    $keyPath = [IO.Path]::GetFullPath($keyPath)
    $shared = [IO.Path]::GetFullPath((Join-Path $sshRoot 'administrators_authorized_keys'))
    $personal = [IO.Path]::GetFullPath((Join-Path $profile.LocalPath '.ssh\authorized_keys'))
    if ($keyPath -ine $shared -and $keyPath -ine $personal) { throw 'Custom authorized_keys location requires manual review.' }
    No-Link $keyPath
    $hostPaths = @($lines | Where-Object { $_ -match '^hostkey ' } | ForEach-Object { ($_ -replace '^hostkey ', '').Replace('__PROGRAMDATA__', $env:ProgramData) })
    # Match the existing Android JSch host-key preference: P-256 first, RSA second.
    $public = @($hostPaths | ForEach-Object { if (Test-Path -LiteralPath "$_.pub") { [IO.File]::ReadAllText("$_.pub").Trim() } })
    $hostKey = $public | Where-Object { $_ -match '^ecdsa-sha2-nistp256 ' } | Select-Object -First 1
    if (!$hostKey) { $hostKey = $public | Where-Object { $_ -match '^ssh-rsa ' } | Select-Object -First 1 }
    if (!$hostKey) { throw 'No Android-compatible RSA/P-256 SSH host key configured.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = 'SHA256:' + [Convert]::ToBase64String($sha.ComputeHash([Convert]::FromBase64String(($hostKey -split ' ')[1]))).TrimEnd('=') } finally { $sha.Dispose() }
    $address = Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $Ip | Select-Object -First 1
    if (!$address) { throw 'Selected network address is no longer available.' }
    return @{ path=$keyPath; sid=$account.SID.Value; shared=($keyPath -ieq $shared); port=$ports[0]; fingerprint=$fingerprint; prefix=$address.PrefixLength }
}
function Restore-Key {
    if (!(Test-Path -LiteralPath $journal)) { return }
    $j = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
    No-Link $j.path
    $current = if (Test-Path -LiteralPath $j.path) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($j.path)) } else { '' }
    if ($current -ne $j.after -and $current -ne $j.before) { throw 'Recovery blocked: authorized_keys was changed externally. Backup retained for manual reconciliation.' }
    if ($j.existed) {
        [IO.File]::WriteAllBytes($j.path, [Convert]::FromBase64String($j.before))
        $acl = Get-Acl -LiteralPath $j.path; $acl.SetSecurityDescriptorSddlForm($j.sddl); Set-Acl -LiteralPath $j.path -AclObject $acl
    } elseif (Test-Path -LiteralPath $j.path) { Remove-Item -LiteralPath $j.path -Force }
    if ($j.directoryExisted) {
        $acl = Get-Acl -LiteralPath $j.directory; $acl.SetSecurityDescriptorSddlForm($j.directorySddl); Set-Acl -LiteralPath $j.directory -AclObject $acl
    } elseif ((Test-Path -LiteralPath $j.directory) -and @(Get-ChildItem -LiteralPath $j.directory -Force).Count -eq 0) {
        Remove-Item -LiteralPath $j.directory # empty directory only, never recursive
    }
    Remove-Item -LiteralPath $journal
}
try {
    $result = @{}
    switch ($request.action) {
        'inspect' {
            $service = Get-Service sshd -ErrorAction SilentlyContinue
            $networks = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and ($_.IPAddress -match '^10\.' -or $_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.') } | ForEach-Object {
                $network = Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
                @{ ip=$_.IPAddress; prefix=$_.PrefixLength; adapter=$_.InterfaceAlias; category=[string]$network.NetworkCategory }
            })
            $result = @{ os=[Environment]::OSVersion.VersionString; architecture=$env:PROCESSOR_ARCHITECTURE; user=[Security.Principal.WindowsIdentity]::GetCurrent().Name; service=[string]$service.Status; startup=[string]$service.StartType; accounts=@(Get-LocalUser | Where-Object Enabled | ForEach-Object Name); networks=$networks; recoveryPending=(Test-Path -LiteralPath $journal) }
        }
        'prepare' {
            Init-State
            if (Test-Path -LiteralPath $journal) { throw 'Recover the pending registration first.' }
            $backup = Join-Path $root ('backup-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
            [void][IO.Directory]::CreateDirectory($backup)
            $service = Get-Service sshd -ErrorAction SilentlyContinue
            $previousStatus = [string]$service.Status; $previousStart = [string]$service.StartType
            $createdRule = $null
            @{ serviceStatus=[string]$service.Status; startup=[string]$service.StartType } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'service-before.json') -Encoding UTF8
            if (Test-Path -LiteralPath (Join-Path $sshRoot 'sshd_config')) { Copy-Item -LiteralPath (Join-Path $sshRoot 'sshd_config') -Destination (Join-Path $backup 'sshd_config') }
            try {
            # Validate existing configurations before changing service startup.
            if (Test-Path -LiteralPath $sshd) { $null = Effective $a.username }
            $defaultRuleBefore = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
            $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
            if ($capability.State -ne 'Installed') {
                $installed = Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
                if (!$defaultRuleBefore) {
                    # Disable only a broad default rule introduced by this installation.
                    Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
                }
                if ($installed.RestartNeeded) { throw 'OpenSSH installed; Windows restart is required before continuing.' }
            }
            # Service initialization generates its default configuration/host keys if absent.
            Set-Service sshd -StartupType Automatic
            if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
            $result = Describe $a.username $a.ip
            $owner = (Get-CimInstance Win32_Service -Filter "Name='sshd'").ProcessId
            if (!(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq $result.port -and $_.OwningProcess -eq $owner })) { throw 'Configured SSH port is not listening in the sshd service.' }
            $rule = 'PCControlSetup-SSH-' + $result.port
            if (!(Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue)) {
                New-NetFirewallRule -Name $rule -DisplayName 'PC Control SSH (Private LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $result.port -Profile Private -RemoteAddress LocalSubnet | Out-Null
                $createdRule = $rule
            } else {
                $existing = Get-NetFirewallRule -Name $rule
                $portFilter = $existing | Get-NetFirewallPortFilter
                $scope = $existing | Get-NetFirewallAddressFilter
                if ($existing.Enabled -ne 'True' -or $existing.Direction -ne 'Inbound' -or $existing.Action -ne 'Allow' -or [string]$existing.Profile -ne 'Private' -or $portFilter.LocalPort -ne $result.port -or [string]$scope.RemoteAddress -ne 'LocalSubnet') { throw 'Existing PCControlSetup firewall rule differs; preserved for manual review.' }
            }
            $result.backup = $backup
            } catch {
                $originalFailure = $_.Exception.Message
                try {
                    if ($createdRule) { Get-NetFirewallRule -Name $createdRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
                    if ($service) {
                        if ($previousStatus -eq 'Stopped' -and (Get-Service sshd).Status -eq 'Running') { Stop-Service sshd }
                        if ($previousStart -in @('Automatic','Manual','Disabled')) { Set-Service sshd -StartupType $previousStart }
                    }
                } catch { throw "$originalFailure Recovery also failed; see service-before.json in $backup." }
                throw $originalFailure
            }
        }
        'register' {
            Init-State
            if (Test-Path -LiteralPath $journal) { throw 'A previous registration needs recovery.' }
            $info = Describe $a.username $a.ip
            if ($a.publicKey -notmatch '^ssh-rsa [A-Za-z0-9+/=]+(?: [^\r\n]*)?$' -or $a.publicKey.Length -gt 8192) { throw 'Invalid public key.' }
            $path = $info.path; $directory = Split-Path -Parent $path
            $existed = Test-Path -LiteralPath $path; $directoryExisted = Test-Path -LiteralPath $directory
            [byte[]]$before = @()
            if ($existed) { $before = [IO.File]::ReadAllBytes($path) }
            $update = Key-Update $before $a.publicKey
            $duplicate = $update.duplicate; $after = $update.bytes
            $j = @{ path=$path; directory=$directory; existed=$existed; directoryExisted=$directoryExisted; before=[Convert]::ToBase64String($before); after=[Convert]::ToBase64String($after); sddl=$(if ($existed) { (Get-Acl -LiteralPath $path).Sddl } else { '' }); directorySddl=$(if ($directoryExisted) { (Get-Acl -LiteralPath $directory).Sddl } else { '' }) }
            Write-Journal $j
            try {
                [void][IO.Directory]::CreateDirectory($directory)
                if (!$info.shared) { Protect $directory $info.sid $true }
                No-Link $path
                # Write through exclusive handle; on partial write journal remains for manual recovery.
                $stream = [IO.File]::Open($path, 'OpenOrCreate', 'ReadWrite', 'None')
                try {
                    $observed = [byte[]]::new($stream.Length)
                    $offset = 0
                    while ($offset -lt $observed.Length) {
                        $count = $stream.Read($observed, $offset, $observed.Length - $offset)
                        if ($count -eq 0) { throw 'Unexpected end of authorized_keys.' }; $offset += $count
                    }
                    if ([Convert]::ToBase64String($observed) -ne [Convert]::ToBase64String($before)) { throw 'authorized_keys changed while registering; external content preserved.' }
                    $stream.Position = 0; $stream.Write($after, 0, $after.Length); $stream.SetLength($after.Length); $stream.Flush($true)
                } finally { $stream.Dispose() }
                Protect $path $(if ($info.shared) { 'S-1-5-32-544' } else { $info.sid }) $false
            } catch { Restore-Key; throw }
            $result = @{ registered=$true; duplicate=$duplicate; shared=$info.shared; path=$path }
        }
        'rollback' { Init-State; Restore-Key; $result = @{ recovered=$true } }
        'commit' { Init-State; if (Test-Path -LiteralPath $journal) { Move-Item -LiteralPath $journal -Destination (Join-Path $root ('committed-' + [guid]::NewGuid().ToString('N') + '.json')) }; $result = @{ committed=$true } }
        'openFirewall' {
            if ($a.name -notmatch '^PCControlSetup-Pair-[a-f0-9]{32}$' -or [int]$a.port -lt 1024 -or [int]$a.port -gt 65535) { throw 'Invalid temporary firewall request.' }
            if (![IO.Path]::IsPathRooted($a.program) -or !(Test-Path -LiteralPath $a.program)) { throw 'Invalid setup executable path.' }
            New-NetFirewallRule -Name $a.name -DisplayName 'PC Control temporary HTTPS pairing' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ([int]$a.port) -LocalAddress $a.ip -Program $a.program -Profile Private -RemoteAddress LocalSubnet | Out-Null
        }
        'closeFirewall' {
            if ($a.name -notmatch '^PCControlSetup-Pair-[a-f0-9]{32}$') { throw 'Invalid temporary rule name.' }
            Get-NetFirewallRule -Name $a.name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        }
        'recoverFirewall' {
            Get-NetFirewallRule -Name 'PCControlSetup-Pair-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        }
        default { throw 'Unknown setup operation.' }
    }
    $result | ConvertTo-Json -Depth 8 -Compress
} catch {
    # No command arguments, key material, tokens or PowerShell invocation dumps in diagnostics.
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
