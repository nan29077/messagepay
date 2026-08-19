@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - GitHub 업로드

echo.
echo ==========================================
echo   GitHub 업로드
echo   https://github.com/nan29077/tornado
echo ==========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [오류] Git 을 찾을 수 없습니다. https://git-scm.com 에서 설치해 주세요.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 git remote add origin https://github.com/nan29077/tornado.git

set /p MSG="커밋 메시지 (비우면 'update'): "
if "%MSG%"=="" set MSG=update

git add -A
git commit -m "%MSG%"
git branch -M main
git push -u origin main

echo.
echo [안내] 인증 창이 뜨면 GitHub 계정으로 로그인하세요.
echo.
pause
endlocal
