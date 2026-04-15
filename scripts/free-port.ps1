# Free TCP listen port used by OneREE (reads app_port from config.json in $ProjectRoot).
# ASCII-only for Windows cmd compatibility.
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ProjectRoot
)

Set-Location -LiteralPath $ProjectRoot
$ErrorActionPreference = 'SilentlyContinue'

$cfg = Join-Path (Get-Location).Path 'config.json'
if (-not (Test-Path -LiteralPath $cfg)) {
    $port = 3000
}
else {
    $raw = Get-Content -LiteralPath $cfg -Raw
    $port = (ConvertFrom-Json $raw).app_port
}
if (-not $port) { $port = 3000 }

$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "[OneREE] Port $port is free."
    exit 0
}

$seen = @{}
foreach ($c in $conns) {
    $seen[$c.OwningProcess] = $true
}
foreach ($id in $seen.Keys) {
    try {
        $p = Get-Process -Id $id -ErrorAction Stop
        Write-Host "[OneREE] Stopping PID $id ($($p.ProcessName)) listening on port $port"
        Stop-Process -Id $id -Force -ErrorAction Stop
    }
    catch {
        Write-Host "[OneREE] Cannot stop PID ${id}: $($_.Exception.Message)"
    }
}
exit 0
