@echo off
chcp 65001 >nul
echo ====================================================================
echo  Antigravity 自定义背景壁纸更换工具
echo ====================================================================
echo.

set "IMG_PATH=%~1"

if "%IMG_PATH%"=="" (
    echo [提示] 您可以直接把图片 (PNG, JPG, WebP) 拖拽到本 bat 图标上！
    echo.
    set /p "IMG_PATH=请输入图片文件的完整路径: "
)

if "%IMG_PATH%"=="" (
    echo [错误] 未提供图片路径，操作已取消。
    pause
    exit /b
)

echo.
node "%~dp0set-background.js" "%IMG_PATH%"
echo.
pause