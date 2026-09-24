@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js desde https://nodejs.org y volve a abrir este archivo.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if not exist public\sample\rutina-ejemplo.xlsx call node scripts\make-sample.js
node server.js
pause
