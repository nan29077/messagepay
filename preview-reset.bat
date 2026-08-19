@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 미리보기 데이터 초기화

echo.
echo ==========================================
echo   간편 미리보기 데이터 초기화
echo ==========================================
echo.
echo   .pglite 폴더를 삭제하고 다음 실행 때 새로 만듭니다.
echo   [주의] 미리보기에서 만든 데이터가 모두 사라집니다.
echo.
set /p CONFIRM="계속하려면 Y 를 입력하세요: "
if /i not "%CONFIRM%"=="Y" (
  echo 취소했습니다.
  pause
  exit /b 0
)

netstat -ano | findstr /r /c:":5433 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [중단] 미리보기 서버가 실행 중입니다. preview.bat 창을 먼저 닫아 주세요.
  echo.
  pause
  exit /b 1
)

if exist ".pglite" rmdir /s /q ".pglite"
echo.
echo [완료] 초기화되었습니다. preview.bat 을 다시 실행하면 시드 데이터가 새로 생성됩니다.
echo.
pause
endlocal
