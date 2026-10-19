@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-theme.ps1" -Mode Folder
if errorlevel 1 (
    echo Installation or restore failed. Review the message above.
    pause
    exit /b 1
)
pause

