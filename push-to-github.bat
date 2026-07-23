@echo off
chcp 65001 >nul
title 推送到 GitHub - Game Recommender
cd /d "%~dp0"

echo ========================================
echo   推送 Game Recommender 到 GitHub
echo ========================================
echo.
echo 远程仓库: https://github.com/tgfxpfgt/game-recommender.git
echo.
echo 即将执行 git push，Git Credential Manager 会弹出浏览器
echo 请在浏览器中完成 GitHub 登录授权...
echo.

git push -u origin main

echo.
echo ========================================
if %errorlevel%==0 (
    echo   推送成功！代码已上传到 GitHub。
) else (
    echo   推送失败，请检查网络或授权是否完成。
    echo   你也可以手动执行: git push -u origin main
)
echo ========================================
echo.
pause
