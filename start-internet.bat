@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo       DURAK - INTERNET MODE
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cloudflared not found in PATH.
  echo.
  echo Install cloudflared from the official Cloudflare page:
  echo https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  echo.
  echo After installation, reopen this window and run start-internet.bat again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting the Durak server on http://localhost:3000 ...
start "Durak Node Server" cmd /k "cd /d ""%~dp0"" && npm start"

timeout /t 2 /nobreak >nul

echo.
echo Starting Cloudflare Tunnel...
echo.
echo IMPORTANT: The public https://...trycloudflare.com link below is the
echo link you send to the other player.
echo.
cloudflared tunnel --url http://localhost:3000

echo.
echo Tunnel stopped.
pause
