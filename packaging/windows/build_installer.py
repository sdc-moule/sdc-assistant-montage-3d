"""Construit l'installateur et le dossier portable après npm run build.

Usage : Python standard sous Windows ; le compilateur .NET de Windows est utilisé.
"""
import io
from pathlib import Path
import shutil
import struct
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'Installation_Atelier_SDC_v0_2_0'
CSC = Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
SOURCES = Path(__file__).resolve().parent


def main():
    if not CSC.is_file() or not (ROOT / 'dist/index.html').is_file():
        raise SystemExit('Compilateur .NET ou build dist absent. Exécuter npm run build avant le packaging.')
    OUTPUT.mkdir(exist_ok=True)
    portable = OUTPUT / 'Portable'
    portable.mkdir(exist_ok=True)
    subprocess.run([str(CSC), '/nologo', '/target:winexe', '/platform:anycpu',
                    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
                    '/out:' + str(portable / 'SDC_Montage_3D.exe'), str(SOURCES / 'Launcher.cs'), str(SOURCES / 'FreeCADRuntime.cs')], check=True)
    subprocess.run([str(CSC), '/nologo', '/target:winexe', '/platform:anycpu',
                    '/reference:System.Windows.Forms.dll', '/reference:Microsoft.CSharp.dll',
                    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
                    '/out:' + str(OUTPUT / 'Install.exe'), str(SOURCES / 'Installer.cs'), str(SOURCES / 'FreeCADRuntime.cs')], check=True)
    subprocess.run([str(CSC), '/nologo', '/target:winexe', '/platform:anycpu',
                    '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
                    '/out:' + str(portable / 'Installer_FreeCAD.exe'), str(SOURCES / 'FreeCADSetup.cs'), str(SOURCES / 'FreeCADRuntime.cs')], check=True)
    # Copie sans effacement de données : seuls les fichiers applicatifs sont remplacés.
    shutil.copytree(ROOT / 'dist', portable / 'app', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'backend', portable / 'backend', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copy2(SOURCES / 'Demarrer_SDC.bat', portable / 'Demarrer_SDC.bat')
    shutil.copy2(SOURCES / 'INSTALLATION_FR.txt', portable / 'INSTALLATION_FR.txt')
    shutil.copy2(SOURCES / 'INSTALLATION_FR.txt', OUTPUT / 'INSTALLATION_FR.txt')
    documentation = OUTPUT / 'Documentation'
    documentation.mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'README.md', documentation / 'README.md')
    shutil.copytree(ROOT / 'docs', documentation / 'docs', dirs_exist_ok=True)
    payload = io.BytesIO()
    with ZipFile(payload, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(portable.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(portable).as_posix())
    data = payload.getvalue()
    with (OUTPUT / 'Install.exe').open('ab') as installer:
        installer.write(data)
        installer.write(struct.pack('<q', len(data)))
        installer.write(b'SDCZIP01')
    archive_path = ROOT / 'Installation_Atelier_SDC_v0_2_0.zip'
    with ZipFile(archive_path, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(OUTPUT.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(ROOT).as_posix())
    with ZipFile(archive_path) as archive:
        if archive.testzip():
            raise RuntimeError('Archive corrompue')
    print(archive_path)
    print('Archive vérifiée :', archive_path.stat().st_size, 'octets')


if __name__ == '__main__':
    main()
