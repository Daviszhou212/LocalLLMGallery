@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not found. Please install Node.js 18+ first.
  exit /b 1
)

if "%HOST%"=="" set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=8086"
set "BROWSER_HOST=%HOST%"
if /I "%BROWSER_HOST%"=="0.0.0.0" set "BROWSER_HOST=127.0.0.1"
if /I "%BROWSER_HOST%"=="::" set "BROWSER_HOST=127.0.0.1"
set "APP_URL=http://%BROWSER_HOST%:%PORT%"

if not exist node_modules (
  echo [INFO] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

echo [INFO] Starting service on %APP_URL%
echo [INFO] Browser will open automatically...
echo [INFO] Press Ctrl+C to stop.
if "%LOCAL_API_TOKEN%"=="" (
  echo [WARN] LOCAL_API_TOKEN is not set. Enable ALLOW_INSECURE_LOCAL=true for local debug.
  set ALLOW_INSECURE_LOCAL=true
)
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; try { Start-Process '%APP_URL%' } catch { Start-Process explorer.exe '%APP_URL%' }"
call npm run start
exit /b %errorlevel%
