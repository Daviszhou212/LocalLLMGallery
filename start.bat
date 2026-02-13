@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not found. Please install Node.js 18+ first.
  exit /b 1
)

if not exist node_modules (
  echo [INFO] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

echo [INFO] Starting service on http://127.0.0.1:8086
echo [INFO] Press Ctrl+C to stop.
if "%LOCAL_API_TOKEN%"=="" (
  echo [WARN] LOCAL_API_TOKEN is not set. Enable ALLOW_INSECURE_LOCAL=true for local debug.
  set ALLOW_INSECURE_LOCAL=true
)
call npm run start
