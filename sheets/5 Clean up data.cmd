@echo off
rem Runs one script from the scripts folder on the two newest spreadsheets in this folder.
rem -ExecutionPolicy Bypass applies to this one run only and changes no setting.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Clean-Files.ps1"
echo.
pause
