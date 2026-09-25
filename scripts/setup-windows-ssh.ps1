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

  [switch] $ReplaceKey
)

$ErrorActionPreference = 'Stop'
$authorizedKeysPath = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
$firewallRuleName = 'OpenSSH-Server-In-TCP-PC-Control'

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

Write-Step 'Checking Windows OpenSSH Server'
$capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
if ($capability.State -ne 'Installed') {
  Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
  Write-Host 'OpenSSH Server installed.' -ForegroundColor Green
} else {
  Write-Host 'OpenSSH Server is already installed.' -ForegroundColor Green
}

Write-Step 'Starting OpenSSH and enabling automatic startup'
Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd

Write-Step 'Registering the app public key'
$key = Read-PublicKey
Test-PublicKey $key
New-Item -ItemType Directory -Force -Path (Split-Path $authorizedKeysPath) | Out-Null
if (-not (Test-Path $authorizedKeysPath)) { New-Item -ItemType File -Path $authorizedKeysPath | Out-Null }

$existing = @(Get-Content -LiteralPath $authorizedKeysPath -ErrorAction SilentlyContinue)
if ($ReplaceKey) {
  Set-Content -LiteralPath $authorizedKeysPath -Value $key -Encoding ascii
  Write-Host 'Existing administrator keys replaced by the supplied key.' -ForegroundColor Yellow
} elseif ($existing -notcontains $key) {
  Add-Content -LiteralPath $authorizedKeysPath -Value $key -Encoding ascii
  Write-Host 'Public key added.' -ForegroundColor Green
} else {
  Write-Host 'Public key is already registered.' -ForegroundColor Green
}

Write-Step 'Applying OpenSSH administrator key ACL'
icacls.exe $authorizedKeysPath /inheritance:r | Out-Null
icacls.exe $authorizedKeysPath /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null

Write-Step 'Checking the SSH firewall rule'
$rule = Get-NetFirewallRule -Name $firewallRuleName -ErrorAction SilentlyContinue
if (-not $rule) {
  New-NetFirewallRule -Name $firewallRuleName -DisplayName 'OpenSSH Server (PC Control, Local Subnet)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -Profile Private -RemoteAddress LocalSubnet | Out-Null
} else {
  Set-NetFirewallRule -Name $firewallRuleName -Enabled True -Profile Private -RemoteAddress LocalSubnet | Out-Null
}

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Authorized keys: $authorizedKeysPath"
Write-Host 'SSH service: Automatic / Running'
Write-Host 'Firewall: TCP 22, Private profile, LocalSubnet only'
Write-Host 'Next: test hostname and whoami from PC Control, then verify the server fingerprint.'
