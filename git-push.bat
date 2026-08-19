@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 토네이도 - GitHub 업로드

echo.
echo ==========================================
echo   GitHub 업로드
echo   https://github.com/nan29077/tornado
echo   브랜치: main
echo ==========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [오류] Git 을 찾을 수 없습니다. https://git-scm.com 에서 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

rem 이전 작업에서 남은 잠금 파일 정리
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>nul
if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock" >nul 2>nul
if exist ".git\objects\maintenance.lock" del /f /q ".git\objects\maintenance.lock" >nul 2>nul

if not exist ".git" (
  echo [작업] Git 저장소를 초기화합니다.
  git init -b main
)

git config core.fileMode false
git config core.autocrlf false

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin https://github.com/nan29077/tornado.git
) else (
  git remote set-url origin https://github.com/nan29077/tornado.git
)

git branch -M main

echo [현재 변경 사항]
git status --short
echo.

set "MSG="
set /p MSG="커밋 메시지 (그냥 Enter 누르면 기본 메시지): "
if not defined MSG set "MSG=토네이도 업데이트"

git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo [안내] 새로 커밋할 변경 사항이 없습니다. 푸시만 진행합니다.
  echo.
)

echo.
echo [푸시] GitHub 인증 창이 뜨면 계정으로 로그인해 주세요.
echo.
git push -u origin main
if not errorlevel 1 goto :done

echo.
echo [안내] 푸시가 거절되었습니다. 원격에 다른 커밋이 있는지 확인하고 병합을 시도합니다.
echo.
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo [오류] 원격 내용과 병합하지 못했습니다.
  echo        충돌이 있다면 해결한 뒤 다시 실행해 주세요.
  echo        원격이 비어 있는 새 저장소라면 GitHub 에서 저장소가 생성되었는지 확인하세요.
  echo.
  pause
  exit /b 1
)

git push -u origin main
if errorlevel 1 (
  echo.
  echo [오류] 푸시에 실패했습니다. 위 메시지를 확인해 주세요.
  echo        - 인증 실패라면 Windows 자격 증명 관리자에서 github 항목을 지우고 다시 시도
  echo        - 권한 오류라면 해당 GitHub 계정에 저장소 쓰기 권한이 있는지 확인
  echo.
  pause
  exit /b 1
)

:done
echo.
echo ==========================================
echo   업로드가 완료되었습니다.
echo   https://github.com/nan29077/tornado
echo ==========================================
echo.
git log --oneline -3
echo.
pause
endlocal
