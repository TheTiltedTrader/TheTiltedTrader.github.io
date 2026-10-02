@echo off
rem Double-click to open the TTT Terminal with live data.
rem Starts the local data helper (built-in Windows PowerShell, nothing to install)
rem and opens http://localhost:8787 in your default browser.
title TTT Terminal - data helper (keep open)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0TTT-Server.ps1"
if errorlevel 1 pause
