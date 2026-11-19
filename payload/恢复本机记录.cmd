@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if exist "runtime\node.exe" (
 "runtime\node.exe" "update.mjs" --restore
) else (
 node.exe "update.mjs" --restore
)
pause
