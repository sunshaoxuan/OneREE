@echo off
REM ASCII-only: do not put non-English text here (cmd breaks UTF-8 .bat on some locales).
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [OneREE] Node.js not found. Install Node.js and add it to PATH.
    pause
    exit /b 1
)

echo [OneREE] Checking port from config.json...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-port.ps1" "%CD%"
if errorlevel 1 (
    echo [OneREE] Port check failed.
    pause
    exit /b 1
)

echo [OneREE] Starting server...
start "OneREE Server" cmd /k "node server.mjs"
echo [OneREE] Done. Close the window or run stop.bat to stop.
exit /b 0
