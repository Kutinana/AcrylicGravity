param(
    [ValidateSet('Folder', 'Asar', 'Restore')][string]$Mode = 'Folder',
    [string]$ResourcesPath = (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources'),
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$resources = (Resolve-Path -LiteralPath $ResourcesPath).Path
$appDir = Join-Path $resources 'app'
$archive = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.vanilla'
$executable = Join-Path (Split-Path $resources -Parent) 'Antigravity.exe'

if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Antigravity.exe was not found beside resources.' }
if ([IO.Path]::GetFullPath($appDir) -ne [IO.Path]::Combine($resources, 'app')) { throw 'Unexpected application path.' }
if (Test-Path -LiteralPath $appDir) {
    if ((Get-Item -LiteralPath $appDir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to replace a linked app directory.' }
    $packagePath = Join-Path $appDir 'package.json'
    $package = if (Test-Path -LiteralPath $packagePath) { Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json }
    $legacyHook = Join-Path $appDir 'dist\utils.js'
    $legacy = (Test-Path -LiteralPath $legacyHook) -and ((Get-Content -LiteralPath $legacyHook -Raw) -match 'Permanent Theme Hook')
    if (-not $package.acrylicGravity -and -not $legacy) { throw 'An unrelated resources/app directory already exists.' }
}

if ($Mode -eq 'Restore') {
    $original = @($backup, (Join-Path $resources 'app.asar.backup')) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $original) { throw 'No original archive was found. No files were changed.' }
} else {
    Push-Location $projectRoot
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\@electron\asar\package.json'))) {
            & npm.cmd ci --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        }
        $sourceArgs = @()
        # Custom installations use their own archive and backup candidates.
        if ($ResourcesPath -ne (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources')) {
            $original = @($backup, (Join-Path $resources 'app.asar.backup'), $archive) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if (-not $original) { throw 'No original archive found in the selected resources directory.' }
            $sourceArgs = @('--source', $original)
        }
        $packArgs = @()
        if ($Mode -eq 'Asar') { $packArgs += '--asar' }
        & node (Join-Path $PSScriptRoot 'prepare-app.js') @sourceArgs @packArgs
        if ($LASTEXITCODE -ne 0) { throw 'Client preparation failed. No installed files were changed.' }
        $original = (Get-Content -LiteralPath (Join-Path $projectRoot 'build\install-source.json') -Raw | ConvertFrom-Json).source
    } finally { Pop-Location }
}

if ($PrepareOnly) { Write-Host 'Preparation completed. The installed client was not changed.'; exit 0 }
if ((Read-Host 'Antigravity will close and restart. Continue? [y/N]') -notmatch '^(y|yes)$') { exit 0 }

& (Join-Path $PSScriptRoot 'stop-daemon.ps1')
Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force
Start-Sleep -Seconds 2

if ($Mode -eq 'Restore') {
    Copy-Item -LiteralPath $original -Destination $archive -Force
    if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
} else {
    if ([IO.Path]::GetFullPath($original) -ne [IO.Path]::GetFullPath($backup)) {
        Copy-Item -LiteralPath $original -Destination $backup -Force
    }
    # Deploy beside the live directory first; retain it until the copy succeeds.
    if ($Mode -eq 'Folder') {
        $staging = Join-Path $resources 'app.acrylicgravity-staging'
        if (Test-Path -LiteralPath $staging) { throw 'A staging directory already exists. Restore the original client before retrying.' }
        Copy-Item -LiteralPath (Join-Path $projectRoot 'build\app') -Destination $staging -Recurse
        if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
        Move-Item -LiteralPath $staging -Destination $appDir
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    } else {
        Copy-Item -LiteralPath (Join-Path $projectRoot 'build\app.asar.patched') -Destination $archive -Force
        $unpacked = Join-Path $projectRoot 'build\app.asar.patched.unpacked'
        if (Test-Path -LiteralPath $unpacked) {
            $unpackedTarget = Join-Path $resources 'app.asar.unpacked'
            New-Item -ItemType Directory -Path $unpackedTarget -Force | Out-Null
            Get-ChildItem -LiteralPath $unpacked -Force | ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $unpackedTarget -Recurse -Force
            }
        }
        if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
    }
}

Start-Process -FilePath $executable -WindowStyle Normal
Write-Host 'Completed. Original archives remain in the Antigravity resources directory.'
