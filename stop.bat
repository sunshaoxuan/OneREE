@echo off
chcp 65001 >nul
setlocal

echo [OneREE] 正在结束运行 server.mjs 的 Node 进程...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*server.mjs*' }; ^
   if (-not $p) { Write-Host '[OneREE] 未找到正在运行的 OneREE 服务。'; exit 0 }; ^
   $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('[OneREE] 已结束 PID ' + $_.ProcessId) }"

echo [OneREE] 完成。
pause
