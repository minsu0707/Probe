@echo off
rem Stop the Probe server. Use "Probe-stop.cmd --force" to stop even while a run is active.
cd /d "%~dp0"
node scripts\stop.ts %*
pause
