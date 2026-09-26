$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$adapter = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' -and
  ($null -eq $adapter -or $_.InterfaceIndex -eq $adapter.ifIndex)
})
$address = $addresses | Select-Object -First 1
if (-not $address) { throw 'No usable IPv4 LAN address was found.' }
$sshPort = 22
$sshd = Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
$effective = @()
$listeningPorts = @()
if (Test-Path $sshd) {
  $effective = @(& $sshd -T 2>$null)
  if ($LASTEXITCODE -ne 0) { $effective = @() }
  $processIds = @(Get-Process sshd -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($processIds.Count -gt 0) {
    $listeningPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $processIds -contains $_.OwningProcess } |
      ForEach-Object { $_.LocalPort } | Select-Object -Unique)
  }
}
$configuredPorts = @($effective | Where-Object { $_ -match '^port\s+\d+$' } |
  ForEach-Object { [int](($_ -split '\s+')[1]) })
$activePort = @($configuredPorts | Where-Object { $listeningPorts -contains $_ } |
  Select-Object -First 1)
if ($activePort.Count -gt 0) { $sshPort = $activePort[0] }
$configuredHostKeys = @($effective | Where-Object { $_ -match '^hostkey\s+' } |
  ForEach-Object {
    $path = ($_ -split '\s+', 2)[1].Replace('__PROGRAMDATA__', $env:ProgramData)
    [Environment]::ExpandEnvironmentVariables($path)
  })
$hostKeyAlgorithms = (($effective | Where-Object { $_ -match '^hostkeyalgorithms\s+' } |
  Select-Object -First 1) -split '\s+', 2)[1]
$keyPath = @($configuredHostKeys | Where-Object {
  $_ -match 'ssh_host_ecdsa_key$' -and $hostKeyAlgorithms -match 'ecdsa-sha2-nistp256'
} | ForEach-Object { "$_.pub" } | Where-Object { Test-Path $_ } | Select-Object -First 1)
if ($keyPath.Count -eq 0) {
  $keyPath = @($configuredHostKeys | Where-Object {
    $_ -match 'ssh_host_rsa_key$' -and $hostKeyAlgorithms -match 'rsa-sha2-(256|512)'
  } | ForEach-Object { "$_.pub" } | Where-Object { Test-Path $_ } | Select-Object -First 1)
}
$keyPath = $keyPath | Select-Object -First 1
$fingerprint = ''
$hostId = ''
if ($keyPath -and (Test-Path $keyPath)) {
  $keyInfo = & ssh-keygen.exe -lf $keyPath -E sha256 2>$null
  if ($LASTEXITCODE -eq 0) { $fingerprint = ($keyInfo -split '\s+')[1] }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((Get-Content -Raw -LiteralPath $keyPath).Trim())
    $hostId = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').Substring(0, 24).ToLowerInvariant()
  } finally { $sha.Dispose() }
}
$gateway = (Get-NetIPConfiguration -InterfaceIndex $address.InterfaceIndex).IPv4DefaultGateway.NextHop | Select-Object -First 1
$users = @(Get-LocalUser | Where-Object { $_.Enabled } | ForEach-Object { $_.Name })
[ordered]@{
  hostId = $hostId
  displayName = $env:COMPUTERNAME
  hostname = $env:COMPUTERNAME
  currentLanIp = $address.IPAddress
  lanPrefix = $address.PrefixLength
  sshPort = $sshPort
  sshUsername = $env:USERNAME
  sshHostKeyFingerprint = $fingerprint
  macAddressCandidate = if ($adapter) { $adapter.MacAddress.Replace('-', ':') } else { $null }
  defaultGatewayCandidate = $gateway
  adapterName = if ($adapter) { $adapter.Name } else { $null }
  accounts = $users
  sshInstalled = [bool](Get-Service sshd -ErrorAction SilentlyContinue) -and
    $activePort.Count -gt 0 -and [bool]$keyPath
} | ConvertTo-Json -Compress -Depth 4
