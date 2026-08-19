@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 데이터베이스 시작

echo.
echo ==========================================
echo   PostgreSQL + Redis 컨테이너 시작
echo ==========================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [오류] Docker 를 찾을 수 없습니다.
  echo        Docker Desktop 을 설치하거나, 직접 설치한 PostgreSQL 을 사용하려면
  echo        .env 의 DATABASE_URL 을 해당 서버 주소로 수정하세요.
  echo.
  pause
  exit /b 1
)

docker compose up -d
if errorlevel 1 (
  echo.
  echo [오류] 컨테이너를 시작하지 못했습니다. Docker Desktop 이 실행 중인지 확인해 주세요.
  pause
  exit /b 1
)

echo.
echo [완료] PostgreSQL(5432), Redis(6379) 가 실행 중입니다.
echo        컨테이너를 내리려면: docker compose down
echo.
pause
endlocal
