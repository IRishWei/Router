param([string]$CounterPath,[string]$ReadyPath,[string]$ReleasePath)
$ErrorActionPreference='Stop'
$t18Lock=[IO.File]::Open($CounterPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try {
 [IO.File]::WriteAllText($ReadyPath,'ready')
 $t18Deadline=[DateTime]::UtcNow.AddSeconds(5)
 while (-not (Test-Path -LiteralPath $ReleasePath)) {
  if ([DateTime]::UtcNow -gt $t18Deadline) { throw 'Owned file-lock release deadline exceeded' }
  Start-Sleep -Milliseconds 5
 }
} finally { $t18Lock.Dispose() }
