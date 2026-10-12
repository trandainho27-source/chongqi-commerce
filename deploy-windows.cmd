@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)
call npm run install:ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
node scripts/deploy-cloudflare.mjs --login
if errorlevel 1 goto failed
echo.
echo Deployment finished. Read docs\DEPLOY.md to configure secrets and /admin.
pause
exit /b 0
:failed
echo.
echo Deployment stopped. Copy the error above for troubleshooting.
pause
exit /b 1
