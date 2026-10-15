@echo off
REM Downloads real OpenStreetMap data for the Kaduna State towns.
REM Double-click, or run: fetch_towns.bat zaria
cd /d %~dp0
if "%1"=="" (python fetch_towns.py all) else (python fetch_towns.py %1)
pause
