# Construit dist\sdc_camera.exe (un seul fichier, 64 bits, sans droits administrateur). À lancer sur Windows.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
python -m venv .venv-build
.\.venv-build\Scripts\python -m pip install -q -r requirements.txt pyinstaller
.\.venv-build\Scripts\python -m PyInstaller --onefile --name sdc_camera --console sdc_camera\__main__.py `
  --paths . --exclude-module tkinter --exclude-module matplotlib
Write-Host "OK : dist\sdc_camera.exe  (essai : .\dist\sdc_camera.exe --demo)"
