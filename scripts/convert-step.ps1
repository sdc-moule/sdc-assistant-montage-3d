param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$FreeCADBin,
    [double]$Deflection = 0.2
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $FreeCADBin 'python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Python FreeCAD introuvable dans le dossier bin fourni.' }
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $taskRoot 'backend'
    & $taskPython -m sdc_converter.convert_step $Source $Destination --deflection $Deflection
    if ($LASTEXITCODE -ne 0) { throw 'Conversion échouée : consulter le diagnostic ci-dessus.' }
} finally { $env:PYTHONPATH = $previousPythonPath }
