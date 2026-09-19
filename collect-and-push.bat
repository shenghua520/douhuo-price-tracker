@echo off
setlocal
cd /d "%~dp0"
echo [%date% %time%] collect start
call npm run collect
if errorlevel 1 (
  echo collect failed
  exit /b 1
)
call npm run selftest
if errorlevel 1 (
  echo selftest failed, skip commit
  exit /b 1
)
git add data docs/data
git diff --staged --quiet
if errorlevel 1 (
  git commit -m "data: price snapshot"
  git pull --rebase origin main
  git push origin HEAD:main
  if errorlevel 1 (
    echo push failed, retry
    git pull --rebase origin main
    git push origin HEAD:main
  )
) else (
  echo no data change
)
echo [%date% %time%] done
