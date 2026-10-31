@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS or download the portable Windows release.
  pause
  exit /b 1
)
node "scripts\start.cjs"
if errorlevel 1 pause
popd
endlocal
