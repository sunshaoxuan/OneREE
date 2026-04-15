@echo off
REM ASCII-only: do not put non-English text here.
setlocal
echo [OneREE] Stopping server (server.mjs)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
echo [OneREE] Done.
pause
