param([Parameter(Mandatory=$true)][string]$Stage,[Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($Stage,$Archive,[IO.Compression.CompressionLevel]::Optimal,$false)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$release = Split-Path $Archive -Parent
# Relative compiler paths also work in folders with Korean characters.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Setup.cs') -Destination (Join-Path $release 'Setup.cs')
Push-Location -LiteralPath $release
try {
    $resource='/resource:' + (Split-Path $Archive -Leaf) + ',payload.zip'
    & $compiler /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /out:ISPBlockMaker-Setup.exe $resource .\Setup.cs
    if($LASTEXITCODE -ne 0) { throw 'Setup build failed' }
} finally { Pop-Location }
