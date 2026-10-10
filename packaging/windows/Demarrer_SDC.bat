@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0SDC_Montage_3D.exe" (
  echo Le lanceur SDC_Montage_3D.exe est absent.
  echo Extraire tout le dossier ou lancer Install.exe.
  pause
  exit /b 1
)
start "SDC Assistant Montage 3D" "%~dp0SDC_Montage_3D.exe"
exit /b 0
