@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 개발 서버

echo.
echo ==========================================
echo   토네이도 TORNADO - 개발 서버
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 를 찾을 수 없습니다. https://nodejs.org 에서 설치해 주세요.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [안내] 아직 설치가 되지 않았습니다. setup.bat 을 먼저 실행합니다.
  echo.
  call "%~dp0setup.bat"
  if errorlevel 1 exit /b 1
)

if not exist ".env" copy /y ".env.example" ".env" >nul

echo [안내] 잠시 후 브라우저가 자동으로 열립니다.
echo        서버를 끄려면 이 창에서 Ctrl+C 를 누르세요.
echo.
echo   메인        http://localhost:3000
echo   크리에이터  http://localhost:3000/studio   (creator1@tornado.kr / tornado1234!)
echo   관리자      http://localhost:3000/admin    (admin@tornado.kr / tornado1234!)
echo.

start "" cmd /c "timeout /t 8 >nul && start http://localhost:3000"
call npm run dev

endlocal
