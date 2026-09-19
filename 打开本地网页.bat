@echo off
cd /d "%~dp0"
echo Starting local price dashboard...
start "" "http://127.0.0.1:5173/"
node scripts\dev-server.js
