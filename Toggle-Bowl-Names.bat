@echo off
setlocal enabledelayedexpansion
title Toggle Repurposed Bowl Names

if "%~1"=="" (
    echo.
    echo No file was dragged onto this tool.
    echo Drag your save file onto this .bat file's icon and drop it there instead.
    echo.
    pause
    exit /b 1
)

set "INPUT=%~1"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Node.js doesn't seem to be installed, or isn't on your PATH.
    echo Install it from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\madden-franchise" (
    echo.
    echo First-time setup - installing what this tool needs. This only happens once.
    echo.
    pushd "%~dp0"
    call npm install madden-franchise
    popd
)

echo.
echo ====================================================
echo   Toggle Repurposed Bowl Names
echo ====================================================
echo   File: !INPUT!
echo.
echo   This only touches the 4 bowls the 16-team format
echo   repurposes as extra Round 1 games: Boca Raton,
echo   New Orleans, Cure, and Gasparilla. Nothing else.
echo ====================================================
echo.
echo   1. Rename all 4 to "CFP First Round"
echo      (matches the 4 real CFP slots, so all 8 Round 1
echo       games read consistently)
echo.
echo   2. Restore the 4 real bowl names
echo      (use this if you're running a season WITHOUT
echo       the 16-team format and want normal names back)
echo.
set "CHOICE="
set /p CHOICE="Type 1 or 2, then press Enter: "

if "!CHOICE!"=="1" (
    set "MODE=--to-cfp"
    set "SUFFIX=-CFPNAMES"
) else if "!CHOICE!"=="2" (
    set "MODE=--to-original"
    set "SUFFIX=-REALNAMES"
) else (
    echo.
    echo That wasn't 1 or 2. Run this again and pick one of those.
    echo.
    pause
    exit /b 1
)

set "INPUT_DIR="
set "INPUT_NAME="
for %%F in ("!INPUT!") do (
    set "INPUT_DIR=%%~dpF"
    set "INPUT_NAME=%%~nF"
)
set "OUTPUT=!INPUT_DIR!!INPUT_NAME!!SUFFIX!"

echo.
echo Running...
echo   node "%~dp0toggle-repurposed-bowl-names.mjs" "!INPUT!" "!OUTPUT!" !MODE!
echo.
node "%~dp0toggle-repurposed-bowl-names.mjs" "!INPUT!" "!OUTPUT!" !MODE!

echo.
if errorlevel 1 (
    echo Something went wrong - see the error above.
    echo Your original save was not touched either way.
) else (
    echo Done. Your original save was never touched.
    echo New file saved right next to it:
    echo   !OUTPUT!
)
echo.
echo Press any key to close this window...
pause >nul
