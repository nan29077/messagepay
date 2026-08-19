@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 프로덕션 미리보기

echo.
echo ==========================================
echo   토네이도 TORNADO - 프로덕션 빌드 미리보기
echo ==========================================
echo.

if not exist "node_modules" (
  call "%~dp0setup.bat"
  if errorlevel 1 exit /b 1
)

echo [1/2] 빌드
call npm run build
if errorlevel 1 (
  echo.
  echo [오류] 빌드에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo [2/2] 서버 시작
start "" cmd /c "timeout /t 5 >nul && start http://localhost:3000"
call npm run start

endlocal
