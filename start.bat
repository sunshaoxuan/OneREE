@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [OneREE] 未找到 node，请先安装 Node.js 并加入 PATH。
    pause
    exit /b 1
)

echo [OneREE] 检查 config.json 中的端口是否被占用...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Set-Location -LiteralPath '%CD%'; ^
   $cfg = Join-Path (Get-Location).Path 'config.json'; ^
   if (-not (Test-Path -LiteralPath $cfg)) { $port = 3000 } ^
   else { $raw = Get-Content -LiteralPath $cfg -Raw; $port = (ConvertFrom-Json $raw).app_port }; ^
   if (-not $port) { $port = 3000 }; ^
   $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; ^
   if (-not $conns) { Write-Host ('[OneREE] 端口 ' + $port + ' 未被占用。'); exit 0 }; ^
   $seen = @{}; ^
   foreach ($c in $conns) { $seen[$c.OwningProcess] = $true }; ^
   foreach ($id in $seen.Keys) { ^
     try { ^
       $p = Get-Process -Id $id -ErrorAction Stop; ^
       Write-Host ('[OneREE] 结束占用端口 ' + $port + ' 的进程: PID ' + $id + ' (' + $p.ProcessName + ')'); ^
       Stop-Process -Id $id -Force -ErrorAction Stop ^
     } catch { Write-Host ('[OneREE] 无法结束 PID ' + $id + ': ' + $_.Exception.Message) } ^
   }"

echo [OneREE] 正在启动服务（新窗口）...
start "OneREE Server" cmd /k "node server.mjs"
echo [OneREE] 已在新窗口中启动。关闭该窗口即可停止服务，或运行 stop.bat。
exit /b 0
