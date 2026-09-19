@echo off
setlocal
cd /d "%~dp0"
rem Trigger GitHub Actions price-sync (collection still runs ON GitHub)
rem Reads DOUHUO trigger token from .env key GITHUB_TOKEN or uses default file trigger-token.txt
set TOKEN=
if exist trigger-token.txt (
  set /p TOKEN=<trigger-token.txt
)
if "%TOKEN%"=="" (
  if exist .env (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
      if /i "%%A"=="GITHUB_TOKEN" set TOKEN=%%B
    )
  )
)
if "%TOKEN%"=="" (
  echo No GitHub token in trigger-token.txt or .env GITHUB_TOKEN
  exit /b 1
)
echo [%date% %time%] dispatch price-sync on GitHub
curl -s -X POST -H "Authorization: Bearer %TOKEN%" -H "Accept: application/vnd.github+json" -H "User-Agent: price-tracker-trigger" -d "{\"ref\":\"main\"}" https://api.github.com/repos/shenghua520/douhuo-price-tracker/actions/workflows/price-sync.yml/dispatches
echo.
echo [%date% %time%] dispatch request sent
