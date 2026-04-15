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

echo [OneREE] 正在启动服务（新窗口）...
start "OneREE Server" cmd /k "node server.mjs"
echo [OneREE] 已在新窗口中启动。关闭该窗口即可停止服务，或运行 stop.bat。
exit /b 0
