# Isolated tests: load only functions from the script AST. Never run its dispatcher.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'PCControlSetup/SystemSetup.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($function.Extent.Text))
}
$utf8 = [Text.UTF8Encoding]::new($false)
function Assert($condition, $message) { if (!$condition) { throw $message } }
$key = 'ssh-rsa AAAATEST device'
$emptyUpdate = Key-Update ([byte[]]@()) $key
Assert ($utf8.GetString($emptyUpdate.bytes) -eq "$key`r`n") 'Empty/new key file failed'
$before = $utf8.GetBytes("# existing UTF-8 comment 한글`nssh-rsa AAAAOLD old")
$update = Key-Update $before $key
Assert ($utf8.GetString($update.bytes) -eq ($utf8.GetString($before) + "`r`n$key`r`n")) 'Existing bytes were changed'
$twice = Key-Update $update.bytes 'ssh-rsa AAAATEST renamed'
Assert ([Convert]::ToBase64String($twice.bytes) -eq [Convert]::ToBase64String($update.bytes)) 'Duplicate key appended'
$blocked = $false
try { $null = Key-Update ($utf8.GetBytes('command="restricted" ssh-rsa AAAATEST device')) $key } catch { $blocked = $true }
Assert $blocked 'Restricted key bypass was allowed'
$blocked = $false
try { $null = Key-Update ([Text.Encoding]::Unicode.GetBytes('ssh-rsa AAAAOLD')) $key } catch { $blocked = $true }
Assert $blocked 'UTF-16 authorized_keys accepted'

$root = Join-Path ([IO.Path]::GetTempPath()) ('pc-control-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$journal = Join-Path $root 'pending.json'
$path = Join-Path $root 'authorized_keys'
try {
    [IO.File]::WriteAllBytes($path, $before)
    $sddl = (Get-Acl -LiteralPath $path).Sddl
    $directorySddl = (Get-Acl -LiteralPath $root).Sddl
    Write-Journal @{ path=$path; directory=$root; existed=$true; directoryExisted=$true; before=[Convert]::ToBase64String($before); after=[Convert]::ToBase64String($update.bytes); sddl=$sddl; directorySddl=$directorySddl }
    [IO.File]::WriteAllBytes($path, $update.bytes)
    Restore-Key
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -eq [Convert]::ToBase64String($before)) 'Rollback changed original bytes'
    Assert ((Get-Acl -LiteralPath $path).Sddl -eq $sddl) 'Rollback changed original ACL'
    Restore-Key # idempotent
    Write-Journal @{ path=$path; directory=$root; existed=$true; directoryExisted=$true; before=[Convert]::ToBase64String($before); after=[Convert]::ToBase64String($update.bytes); sddl=$sddl; directorySddl=$directorySddl }
    [IO.File]::WriteAllText($path, 'external edit', $utf8)
    $blocked = $false; try { Restore-Key } catch { $blocked = $true }
    Assert $blocked 'External edit overwritten during recovery'
    Assert ([IO.File]::ReadAllText($path) -eq 'external edit') 'External edit was lost'
    Assert (Test-Path -LiteralPath $journal) 'Recovery journal lost'
    Write-Output 'PASS: new key file, byte preservation, duplicate key, restricted key, encoding, rollback bytes/ACL, repeated rollback, concurrent-edit protection (9 checks).'
} finally {
    # Only the explicitly named fixture files and empty directory are removed.
    foreach ($file in @($path, $journal, (Join-Path $root 'pending.tmp'))) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $root
}
