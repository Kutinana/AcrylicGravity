@echo off
chcp 65001 >nul
echo 正在更新本地主题包 bootstrap.js...
node "%~dp0build_bootstrap.js" --sync
if errorlevel 1 (
    pause
    exit /b 1
)
echo.
echo [OK] 更新完成！下次启动或在 Antigravity 界面按 Ctrl+R 即可看到最新样式。
pause
