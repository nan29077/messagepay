@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - 최초 설치

echo.
echo ==========================================
echo   토네이도 TORNADO - 최초 설치
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 를 찾을 수 없습니다.
  echo        https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [확인] Node.js %%v

if not exist ".env" (
  echo [작업] .env 파일이 없어 .env.example 을 복사합니다.
  copy /y ".env.example" ".env" >nul
)

echo.
echo [1/4] 의존성 설치 (npm install)
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/4] Prisma 클라이언트 생성
call npx prisma generate
if errorlevel 1 goto :fail

echo.
echo [3/4] 데이터베이스 마이그레이션
call npx prisma migrate deploy
if errorlevel 1 (
  echo.
  echo [오류] 데이터베이스에 연결하지 못했습니다.
  echo        1) Docker Desktop 사용 중이면 db-up.bat 을 먼저 실행하세요.
  echo        2) 별도 PostgreSQL 을 쓰신다면 .env 의 DATABASE_URL 을 수정하세요.
  echo.
  pause
  exit /b 1
)

echo.
echo [4/4] 시드 데이터 생성
call npm run db:seed
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo   설치가 완료되었습니다.
echo   start.bat 을 실행하면 앱이 열립니다.
echo ==========================================
echo.
echo   관리자     : admin@tornado.kr / tornado1234!
echo   크리에이터 : creator1@tornado.kr / tornado1234!
echo.
pause
exit /b 0

:fail
echo.
echo [오류] 설치 중 문제가 발생했습니다. 위 메시지를 확인해 주세요.
echo.
pause
exit /b 1
