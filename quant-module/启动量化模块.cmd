@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
    node server.mjs
    goto end
)
echo Node.js 20+ is required. Install Node.js and launch again.
pause
:end
if errorlevel 1 pause
