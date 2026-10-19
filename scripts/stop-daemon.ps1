$projectRoot = Split-Path $PSScriptRoot -Parent
$daemonPath = Join-Path $projectRoot 'daemon.js'
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($daemonPath)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
