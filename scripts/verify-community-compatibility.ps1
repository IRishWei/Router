param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$EvidenceRoot,
    [string]$DesktopExe = 'E:\Program Files\DeepSeek Harness\DeepSeek Harness.exe',
    [string]$DshCli = 'E:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
)

# Run only while every other DSH Desktop owner has exited. Electron's singleton
# is shared even when DSH_HOME differs. This script never operates a window.
$ErrorActionPreference = 'Stop'
$expectedCommit = '38c826b30e1598dbd74a5f52a74ab3e7e9a7accd'
$source = (Resolve-Path -LiteralPath $SourcePath).Path
$cli = (Resolve-Path -LiteralPath $DshCli).Path
$desktop = (Resolve-Path -LiteralPath $DesktopExe).Path
$root = [System.IO.Path]::GetFullPath($EvidenceRoot)
if (Test-Path -LiteralPath $root) { throw 'EvidenceRoot must be a new directory; existing profiles are never reused.' }
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) { throw 'Fully quit DSH Desktop before running this isolated verification.' }
$commit = (& git -C $source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -ne $expectedCommit) { throw 'Source commit does not match the fixed T04 candidate.' }
$dirty = & git -C $source status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Candidate tracked files must be unchanged.' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $source 'package.json') | ConvertFrom-Json
if ($manifest.name -ne 'oh-my-dsh' -or $manifest.version -ne '0.1.0') { throw 'Unexpected candidate package.' }
New-Item -ItemType Directory -Path $root | Out-Null
$dshHome = Join-Path $root 'dsh-home'
$packages = Join-Path $root 'packages'
New-Item -ItemType Directory -Path $dshHome, $packages | Out-Null
$owner = $null

function Invoke-IsolatedCli([string[]]$Arguments) {
    $hadDshHome = Test-Path Env:DSH_HOME
    $priorDshHome = $env:DSH_HOME
    try { $env:DSH_HOME = $dshHome; & $cli @Arguments 2>&1 }
    finally {
        if ($hadDshHome) { $env:DSH_HOME = $priorDshHome }
        else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    }
}

function Start-IsolatedDesktop([string]$Stage) {
    $hadDshHome = Test-Path Env:DSH_HOME
    $priorDshHome = $env:DSH_HOME
    $output = Join-Path $root "$Stage.private.out.log"
    $errorLog = Join-Path $root "$Stage.private.err.log"
    try {
        $env:DSH_HOME = $dshHome
        $script:owner = Start-Process -FilePath $desktop -WindowStyle Hidden -PassThru -RedirectStandardOutput $output -RedirectStandardError $errorLog
    }
    finally {
        if ($hadDshHome) { $env:DSH_HOME = $priorDshHome }
        else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    }
    $script:ownerStart = $owner.StartTime
    @{ pid = $owner.Id; home = $dshHome; executable = $desktop; stage = $Stage } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $root 'owned-process.json') -Encoding utf8
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Owned Desktop exited before its localhost endpoint became ready.' }
        if ((Test-Path -LiteralPath $output) -and (Get-Content -Raw -LiteralPath $output) -match 'http://127\.0\.0\.1:\d+/\?token=') { return $output }
        Start-Sleep -Milliseconds 500
    }
    throw 'Owned Desktop did not become ready within 60 seconds. Private logs are not printed.'
}

function Stop-OwnedDesktop {
    if ($null -eq $script:owner) { return }
    $current = Get-Process -Id $owner.Id -ErrorAction SilentlyContinue
    if ($null -ne $current) {
        if ($current.Path -ne $desktop -or $current.StartTime -ne $ownerStart) { throw 'Owned process identity changed; refusing to stop it.' }
        Stop-Process -Id $current.Id
        $current.WaitForExit(15000) | Out-Null
        if (-not $current.HasExited) { throw 'Owned Desktop did not exit.' }
    }
    @{ pid = $owner.Id; home = $dshHome; executable = $desktop; stopped = $true } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $root 'owned-process.json') -Encoding utf8
    $script:owner = $null
}

$priorLocation = Get-Location
try {
    Set-Location -LiteralPath $source
    $pack = & npm.cmd pack --ignore-scripts --json --pack-destination $packages 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed; no candidate lifecycle scripts were run.' }
    $packJson = ($pack -join [Environment]::NewLine) | ConvertFrom-Json
    $tarball = Join-Path $packages $packJson.filename
    $pack | Set-Content -LiteralPath (Join-Path $root 'pack.json') -Encoding utf8
    $version = (Invoke-IsolatedCli @('--version') | Out-String).Trim()
    if ($version -ne '0.2.0-rc.2') { throw 'CLI runtime must be the T04 target 0.2.0-rc.2.' }
    $null = Start-IsolatedDesktop 'initialize'
    Stop-OwnedDesktop
    $profileManifest = Join-Path $dshHome 'profiles\desktop\package.json'
    $beforeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $profileManifest).Hash
    $install = Invoke-IsolatedCli @('plugin', '--profile', 'desktop', 'add', $tarball)
    $installExit = $LASTEXITCODE
    $installText = $install -join [Environment]::NewLine
    $install | Set-Content -LiteralPath (Join-Path $root 'install.log') -Encoding utf8
    if ($installExit -ne 1 -or $installText -notmatch 'oh-my-dsh@0\.1\.0 is incompatible with dsh 0\.2\.0-rc\.2') {
        throw 'Expected official compatibility refusal was not observed; inspect the isolated install.log.'
    }
    $afterHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $profileManifest).Hash
    if ($beforeHash -ne $afterHash) { throw 'The refused install unexpectedly changed the desktop profile manifest.' }
    $output = Start-IsolatedDesktop 'restart'
    & node (Join-Path $PSScriptRoot 'verify-community-host.mjs') $output $tarball (Join-Path $root 'host-rpc.json')
    if ($LASTEXITCODE -ne 0) { throw 'Public installed-Desktop verification failed; private launch URLs are never printed.' }
    Stop-OwnedDesktop
    $summary = [ordered]@{
        candidate = 'oh-my-dsh@0.1.0'; sourceCommit = $commit; runtime = $version
        tarballSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $tarball).Hash
        installExit = $installExit; compatibilityRefused = $true; profileManifestUnchanged = $true
        communityAgentPresetCreated = (Test-Path -LiteralPath (Join-Path $dshHome '.agent-presets\oh-my-dsh'))
        modelCalls = 0; modelCallsScope = 'The agent is never prompted; community installation is refused before activation.'
    }
    $summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'summary.json') -Encoding utf8
    $summary | ConvertTo-Json
}
finally { Stop-OwnedDesktop; Set-Location -LiteralPath $priorLocation.Path }
