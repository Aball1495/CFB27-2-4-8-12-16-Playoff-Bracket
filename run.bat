@echo off
REM Smart launcher for the CFB27 Playoff Editor dev build.
REM Only runs "npm install" if node_modules doesn't exist yet - on every
REM later run, it skips straight to "npm start". This is the actual fix
REM for the slow-every-time workflow: npm install only needs to happen
REM once per extracted folder, not once per update.
cd /d "%~dp0"

if not exist "node_modules\" (
    echo node_modules not found - running npm install once...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed - see errors above.
        pause
        exit /b 1
    )
) else (
    echo node_modules already present - skipping install.
)

echo Starting the app...
call npm start
pause
