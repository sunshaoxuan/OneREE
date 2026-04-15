# Stop node process running server.mjs (ASCII-only).
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server.mjs*' }
if (-not $p) {
    Write-Host '[OneREE] No running OneREE server (server.mjs).'
    exit 0
}
$p | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[OneREE] Stopped PID $($_.ProcessId)"
}
exit 0
