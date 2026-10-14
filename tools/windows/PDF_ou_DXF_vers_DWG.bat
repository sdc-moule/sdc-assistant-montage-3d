@echo off
rem Glisser un ou plusieurs fichiers .pdf (plan vectoriel) ou .dxf sur ce fichier : un .dwg est créé à côté.
rem Voir LISEZ-MOI.txt. Nécessite Python 3 (python.org) ; ezdxf et pymupdf s'installent au premier lancement.
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "ICI=%~dp0"
set "SDC_LIBREDWG=%ICI%tools\bin"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 est introuvable. Installer Python depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH", puis relancer.
  pause & exit /b 1
)
if "%~1"=="" (
  echo Glisser un fichier .pdf ou .dxf sur ce fichier .bat.
  pause & exit /b 1
)
%PY% -c "import ezdxf, pymupdf" >nul 2>nul
if errorlevel 1 (
  echo Premier lancement : installation de ezdxf et pymupdf ^(connexion Internet nécessaire^)...
  %PY% -m pip install --user ezdxf pymupdf
  if errorlevel 1 ( echo Échec de l'installation. & pause & exit /b 1 )
)
:suite
if "%~1"=="" goto fin
echo.
echo === %~nx1
if /i "%~x1"==".pdf" ( %PY% "%ICI%tools\pdf_vers_dwg.py" "%~1" ) else if /i "%~x1"==".dxf" ( %PY% "%ICI%tools\dxf_vers_dwg.py" "%~1" ) else ( echo Format non pris en charge : %~x1 ^(.pdf ou .dxf^) )
shift
goto suite
:fin
echo.
echo Terminé. Ouvrir chaque .dwg dans la CAO et le vérifier avant tout usage.
pause
