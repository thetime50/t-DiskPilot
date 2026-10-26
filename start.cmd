@echo off
chcp 65001 >nul
cd /d "%~dp0"
title t-DiskPilot
echo ========================================
echo  t-DiskPilot 启动中（API + Vite）
echo  关闭本窗口即停止服务
echo ========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 并加入 PATH。
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo 首次运行，正在 npm install ...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
)
call npm run dev
echo.
echo 已退出。按任意键关闭窗口。
pause >nul
