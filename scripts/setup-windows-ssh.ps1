#requires -RunAsAdministrator

<##
.SYNOPSIS
  Installs and configures the Windows OpenSSH server for PC Control.

.DESCRIPTION
  Run this script in an elevated PowerShell window on the Windows PC.
  The public key is supplied by the Android app at run time; it is never stored here.
  The firewall rule remains limited to the local subnet.
##>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string] $PublicKey,

  [switch] $ReplaceKey,

  [switch] $RemoveKey,

  [switch] $PrepareOnly,

  [string] $Username,

  [ValidateRange(0, 65535)]
  [int] $OpenPairingPort = 0,

  [switch] $ClosePairingPort,
  [string] $ArgumentFile
)

$ErrorActionPreference = 'Stop'
$argumentFilePath = $ArgumentFile
if ($argumentFilePath) {
  $arguments = Get-Content -Raw -LiteralPath $argumentFilePath | ConvertFrom-Json
  Remove-Item -LiteralPath $argumentFilePath -Force
  $forward = @{}
  foreach ($property in $arguments.PSObject.Properties) { $forward[$property.Name] = $property.Value }
  & $PSCommandPath @forward
  exit
}
$firewallRuleName = 'OpenSSH-Server-In-TCP-PC-Control'
$pairingRuleName = 'PC-Control-Temporary-Pairing'

function Write-Step([string] $Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Read-PublicKey {
  if ($PublicKey) { return $PublicKey.Trim() }
  $entered = Read-Host 'Paste the one-line SSH public key from PC Control'
  if (-not $entered.Trim()) { throw 'A public key is required.' }
  return $entered.Trim()
}

function Test-PublicKey([string] $Key) {
  if ($Key -notmatch '^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp\S+)\s+\S+(\s+.*)?$') {
    throw 'The value does not look like an OpenSSH public key.'
  }
}

function Set-KeyAcl([string] $Path, [string[]] $AllowedSids, [string] $OwnerSid, [bool] $Directory) {
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($entry) }
  $inheritance = if ($Directory) {
    [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sid in $AllowedSids) {
    $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $identity, [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance, [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($OwnerSid))
  Set-Acl -LiteralPath $Path -AclObject $acl
  $actual = Get-Acl -LiteralPath $Path
  foreach ($entry in $actual.Access) {
    $sid = $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($AllowedSids -notcontains $sid -or $entry.AccessControlType -ne 'Allow') {
      throw "Unexpected authorized_keys ACL entry: $sid"
    }
  }
}

if ($ClosePairingPort) {
  Get-NetFirewallRule -Name $pairingRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  exit 0
}

if ($OpenPairingPort -gt 0) {
  Get-NetFirewallRule -Name $pairingRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -Name $pairingRuleName -DisplayName 'PC Control temporary pairing' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $OpenPairingPort -Profile Private -RemoteAddress LocalSubnet | Out-Null
  exit 0
}

if ($RemoveKey) {
  if (-not $PublicKey -or -not $Username) { throw 'Username and public key are required for removal.' }
  $account = Get-LocalUser -Name $Username -ErrorAction Stop
  $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $adminGroup = $adminSid.Translate([System.Security.Principal.NTAccount]).Value
  $isAdmin = @(Get-LocalGroupMember -Group $adminGroup -ErrorAction Stop |
    Where-Object { $_.SID.Value -eq $account.SID.Value }).Count -gt 0
  if ($isAdmin) {
    $removePath = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
  } else {
    $profile = Get-CimInstance Win32_UserProfile |
      Where-Object { $_.SID -eq $account.SID.Value } | Select-Object -First 1
    if (-not $profile) { throw 'The selected account has no Windows profile.' }
    $removePath = Join-Path $profile.LocalPath '.ssh\authorized_keys'
  }
  if (Test-Path -LiteralPath $removePath) {
    $keyToRemove = $PublicKey.Trim()
    $remaining = @(Get-Content -LiteralPath $removePath |
      Where-Object { $_.Trim() -ne $keyToRemove })
    Set-Content -LiteralPath $removePath -Value $remaining -Encoding ascii
  }
  exit 0
}

Write-Step 'Checking Windows OpenSSH Server'
$capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
if ($capability.State -ne 'Installed') {
  Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
  Write-Host 'OpenSSH Server installed.' -ForegroundColor Green
} else {
  Write-Host 'OpenSSH Server is already installed.' -ForegroundColor Green
}

Write-Step 'Starting OpenSSH and enabling automatic startup'
& ssh-keygen.exe -A | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare SSH host keys.' }
Set-Service -Name sshd -StartupType Automatic
if ((Get-Service -Name sshd).Status -ne 'Running') { Start-Service -Name sshd }

if (-not $PrepareOnly) {
  Write-Step 'Registering the app public key'
  $key = Read-PublicKey
  Test-PublicKey $key

  if ($Username) {
    $account = Get-LocalUser -Name $Username -ErrorAction Stop
    $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $adminGroup = $adminSid.Translate([System.Security.Principal.NTAccount]).Value
    $isAdmin = @(Get-LocalGroupMember -Group $adminGroup -ErrorAction Stop | Where-Object { $_.SID.Value -eq $account.SID.Value }).Count -gt 0
  } else {
    $isAdmin = $true
  }

  if ($isAdmin) {
    $authorizedKeysPath = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
  } else {
    $profile = Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $account.SID.Value } | Select-Object -First 1
    if (-not $profile) { throw 'The selected account has no Windows profile yet. Sign in once and retry.' }
    $authorizedKeysPath = Join-Path $profile.LocalPath '.ssh\authorized_keys'
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $authorizedKeysPath) | Out-Null
  if (-not (Test-Path $authorizedKeysPath)) { New-Item -ItemType File -Path $authorizedKeysPath | Out-Null }

  $existing = @(Get-Content -LiteralPath $authorizedKeysPath -ErrorAction SilentlyContinue)
  if ($ReplaceKey) {
    Set-Content -LiteralPath $authorizedKeysPath -Value $key -Encoding ascii
    Write-Host 'Existing keys replaced by the supplied key.' -ForegroundColor Yellow
  } elseif ($existing -notcontains $key) {
    Add-Content -LiteralPath $authorizedKeysPath -Value $key -Encoding ascii
    Write-Host 'Public key added.' -ForegroundColor Green
  } else {
    Write-Host 'Public key is already registered.' -ForegroundColor Green
  }

  Write-Step 'Applying OpenSSH key ACL'
  if ($isAdmin) {
    Set-KeyAcl $authorizedKeysPath @('S-1-5-18', 'S-1-5-32-544') 'S-1-5-32-544' $false
  } else {
    $allowed = @('S-1-5-18', 'S-1-5-32-544', $account.SID.Value)
    Set-KeyAcl (Split-Path $authorizedKeysPath) $allowed $account.SID.Value $true
    Set-KeyAcl $authorizedKeysPath $allowed $account.SID.Value $false
  }
}

Write-Step 'Checking the SSH firewall rule'
$sshd = Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
$effective = @(& $sshd -T)
if ($LASTEXITCODE -ne 0) { throw 'Could not read effective sshd configuration.' }
$configuredPorts = @($effective | Where-Object { $_ -match '^port\s+\d+$' } |
  ForEach-Object { [int](($_ -split '\s+')[1]) })
$processIds = @(Get-Process sshd -ErrorAction Stop | ForEach-Object { $_.Id })
$listeningPorts = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
  Where-Object { $processIds -contains $_.OwningProcess } |
  ForEach-Object { $_.LocalPort })
$sshPort = @($configuredPorts | Where-Object { $listeningPorts -contains $_ } |
  Select-Object -First 1)[0]
if (-not $sshPort) { throw 'sshd is not listening on an effective configured port.' }
$rule = Get-NetFirewallRule -Name $firewallRuleName -ErrorAction SilentlyContinue
if (-not $rule) {
  New-NetFirewallRule -Name $firewallRuleName -DisplayName 'OpenSSH Server (PC Control, Local Subnet)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $sshPort -Profile Private -RemoteAddress LocalSubnet | Out-Null
} else {
  Set-NetFirewallRule -Name $firewallRuleName -Enabled True -Profile Private -RemoteAddress LocalSubnet | Out-Null
  Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule | Set-NetFirewallPortFilter -LocalPort $sshPort
}

Write-Host "`nSetup complete." -ForegroundColor Green
if (-not $PrepareOnly) { Write-Host "Authorized keys: $authorizedKeysPath" }
Write-Host 'SSH service: Automatic / Running'
Write-Host "Firewall: TCP $sshPort, Private profile, LocalSubnet only"
Write-Host 'Next: test hostname and whoami from PC Control, then verify the server fingerprint.'
