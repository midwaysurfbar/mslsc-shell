@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   MSLSC Systems Shell - Phase 1 prototype
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC, and this needs it to run.
  echo.
  echo 1. A download page will open in your browser.
  echo 2. Download and run the "LTS" installer for Windows.
  echo 3. Once it finishes installing, come back and double-click this
  echo    file again.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

rem Checks for the actual Electron binary, not just the node_modules
rem folder - npm install can finish "successfully" while the separate
rem download of Electron's own binary silently fails partway through
rem (seen for real on a venue PC's network), leaving an node_modules
rem folder that exists but doesn't actually work. Re-installing from
rem scratch clears that up automatically instead of needing someone to
rem know to delete node_modules by hand.
if not exist "node_modules\electron\dist\electron.exe" (
  if exist "node_modules" (
    echo A previous install looks incomplete - reinstalling from scratch...
    rmdir /s /q "node_modules"
    echo.
  )
  echo First run - installing dependencies, this only happens once and
  echo may take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong installing dependencies. Check the
    echo messages above and try again.
    pause
    exit /b 1
  )
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo Dependencies installed, but Electron's own program file still
    echo didn't download correctly - this usually means the network
    echo here is blocking or timing out on that specific download
    echo ^(it's separate from the regular install^). Try again on a
    echo different network if this keeps happening.
    pause
    exit /b 1
  )
  echo.
)

echo Starting MSLSC...
call npm start

echo.
echo MSLSC has closed. If that wasn't intentional, scroll up to see
echo any error messages above.
pause
