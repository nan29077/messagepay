@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 프로덕션 미리보기 (포트 3025)

set TORNADO_PORT=3025
set TORNADO_URL=http://localhost:%TORNADO_PORT%

echo.
echo ==========================================
echo   토네이도 TORNADO - 프로덕션 빌드 미리보기
echo   %TORNADO_URL%
echo ==========================================
echo.

call "%~dp0ensure-deps.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "src\generated\prisma" (
  call npm run db:generate
  if errorlevel 1 (
    echo [오류] Prisma 클라이언트 생성에 실패했습니다.
    pause
    exit /b 1
  )
)

echo [확인] 데이터베이스 연결
call npm run check:db
if errorlevel 1 (
  echo.
  echo [중단] 데이터베이스가 준비되지 않았습니다. db-up.bat 을 먼저 실행해 주세요.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/2] 빌드 (2~5분 정도 걸립니다)
call npm run build
if errorlevel 1 (
  echo.
  echo [오류] 빌드에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo [2/2] 서버 시작
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%TORNADO_URL%/api/health'; for($i=0;$i -lt 90;$i++){ try{ $r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 5; if($r.StatusCode -eq 200){ Start-Process '%TORNADO_URL%'; exit } }catch{}; Start-Sleep -Seconds 2 }"
call npm run start

endlocal
