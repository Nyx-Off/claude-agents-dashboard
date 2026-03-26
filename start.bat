@echo off
title Claude Agents Dashboard
echo.
echo   Claude Agents Dashboard
echo.

:: Kill old server if running
taskkill /f /fi "WINDOWTITLE eq Claude Agents Dashboard" >nul 2>&1

:: Find node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else (
        echo   ERROR: Node.js not found.
        echo   Install with: winget install OpenJS.NodeJS.LTS
        pause
        exit /b 1
    )
)

:: Use the directory where this .bat file lives
set "DASH_DIR=%~dp0"

:: Reset state
echo {"agents":[],"log":[],"startTime":"","totalXP":0,"version":0} > "%DASH_DIR%agents.json"

:: Start browser and server
start http://localhost:8787
node "%DASH_DIR%server.js"
pause
