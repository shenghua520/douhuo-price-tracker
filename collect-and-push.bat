@echo off
setlocal
cd /d "%~dp0"
echo [%date% %time%] collect start
call npm run collect
if errorlevel 1 (
  echo collect failed
  exit /b 1
)
git add data docs/data
git diff --staged --quiet
if errorlevel 1 (
  git commit -m "data: daily price snapshot"
  git push
) else (
  echo no data change
)
echo [%date% %time%] done

