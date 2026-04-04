@echo off
REM Windows launcher — PowerShell does not run .sh files. Use this or start.ps1 from repo root.
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Target %1
)
exit /b %ERRORLEVEL%
