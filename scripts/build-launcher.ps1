$ErrorActionPreference = 'Stop'
$frameworkRoot = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler was not found.' }
Push-Location -LiteralPath $PSScriptRoot
try {
    & $compiler /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /out:..\ISPBlockMaker.exe .\Launcher.cs
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
} finally { Pop-Location }
Write-Output "Built $frameworkRoot/ISPBlockMaker.exe"
