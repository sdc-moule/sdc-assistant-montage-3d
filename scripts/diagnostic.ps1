$ErrorActionPreference = 'Stop'
Write-Output 'Diagnostic en lecture seule : aucune installation.'
foreach ($commandName in @('git', 'node', 'npm.cmd', 'py')) {
    $commandInfo = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($commandInfo) { Write-Output "$commandName : $($commandInfo.Source)" }
    else { Write-Output "$commandName : non trouvé" }
}
if (Get-Command git -ErrorAction SilentlyContinue) { git --version }
if (Get-Command node -ErrorAction SilentlyContinue) { node --version }
if (Get-Command py -ErrorAction SilentlyContinue) { py --list }
Get-ChildItem -LiteralPath 'C:\Program Files' -Directory -Filter '*FreeCAD*' | Select-Object FullName
Write-Output 'La version OCCT doit être lue dans FreeCAD : Part.OCC_VERSION.'
