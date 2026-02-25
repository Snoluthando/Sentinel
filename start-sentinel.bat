@echo off
title Sentinel — Local Services
color 0A

echo.
echo  ============================================
echo   SENTINEL — Starting Local Services
echo  ============================================
echo.

:: Start AI Service in new window
echo  [1/2] Starting AI Service on port 8000...
start "Sentinel AI Service" cmd /k "cd /d %~dp0 && .venv\Scripts\activate && python -m uvicorn main:app --port 8000"

:: Wait 3 seconds
timeout /t 3 /nobreak >nul

:: Start Backend API in new window  
echo  [2/2] Starting Backend API on port 3001...
start "Sentinel API" cmd /k "cd /d %~dp0backend && npx ts-node src\main.ts"

echo.
echo  ============================================
echo   Services starting in separate windows.
echo   
echo   AI Service:  http://localhost:8000
echo   Backend API: http://localhost:3001
echo   Dashboard:   https://your-app.vercel.app
echo  ============================================
echo.
echo  Press any key to close this window...
pause >nul
