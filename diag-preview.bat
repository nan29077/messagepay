@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TORNADO - 미리보기 진단

if not exist "logs" mkdir "logs"
set LOG=logs\preview-run.log

echo TORNADO preview diagnostic > "%LOG%"
echo ==== 1. node ==== >> "%LOG%"
where node >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
echo ==== 2. 현재 포트 상태 ==== >> "%LOG%"
netstat -ano ^| findstr /r /c:":3025 .*LISTENING" >> "%LOG%" 2>&1
netstat -ano ^| findstr /r /c:":5433 .*LISTENING" >> "%LOG%" 2>&1
echo ==== 3. 포트 점유 프로세스 확인 ==== >> "%LOG%"
node tools\process-guard.mjs free 3025 5433 >> "%LOG%" 2>&1
echo ==== 4. 미리보기 실행 ==== >> "%LOG%"

echo.
echo   진단을 시작합니다. 이 창을 그대로 두고 기다려 주세요.
echo   결과는 logs\preview-run.log 파일에 저장됩니다.
echo.
echo   (미리보기가 정상 실행되면 브라우저가 열립니다.
echo    실패하면 몇 초 안에 이 창에 안내가 나옵니다.)
echo.

node tools\preview.mjs >> "%LOG%" 2>&1

echo ==== 5. 종료 코드 %errorlevel% ==== >> "%LOG%"
echo.
echo   실행이 끝났습니다. logs\preview-run.log 를 확인해 주세요.
echo.
pause

endlocal
