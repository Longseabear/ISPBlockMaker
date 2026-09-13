param([switch]$NoRegistration)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$package = Get-Content -LiteralPath (Join-Path $installRoot 'distribution.json') -Raw | ConvertFrom-Json
$appRoot = Join-Path $installRoot $package.app
if (!(Test-Path -LiteralPath (Join-Path $appRoot 'ISPBlockMaker.exe'))) { throw 'Incomplete package' }
$bin = Join-Path $installRoot 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
# The caller's working directory is deliberately preserved.
$command = '@echo off' + "`r`n" + '@start "" "%~dp0..\' + $package.app.Replace('/','\') + '\ISPBlockMaker.exe" %*' + "`r`n"
[IO.File]::WriteAllText((Join-Path $bin 'isp-block-maker.cmd'), $command, [Text.Encoding]::ASCII)
$owned = @()
$manifest = Join-Path $installRoot 'installed-files.json'
if(Test-Path -LiteralPath $manifest) { $owned += @(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json) }
$owned += @(Get-Content -LiteralPath (Join-Path $installRoot 'package-files.json') -Raw | ConvertFrom-Json)
[IO.File]::WriteAllText($manifest, (ConvertTo-Json -InputObject @($owned | Sort-Object -Unique)), [Text.Encoding]::UTF8)
if ($NoRegistration) { exit 0 }
$oldPath = [string][Environment]::GetEnvironmentVariable('Path','User')
if (@($oldPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -eq 0) {
    [Environment]::SetEnvironmentVariable('Path', ($oldPath.TrimEnd(';') + ';' + $bin).TrimStart(';'), 'User')
}
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'ISP Block Maker.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($menu)
$shortcut.TargetPath = Join-Path $appRoot 'ISPBlockMaker.exe'
$shortcut.WorkingDirectory = [Environment]::GetFolderPath('MyDocuments')
$shortcut.Save()
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ISPBlockMaker'
New-Item -Path $key -Force | Out-Null
$values = @{ DisplayName='ISP Block Maker'; DisplayVersion=$package.version; Publisher='ISP Block Maker'; InstallLocation=$installRoot; UninstallString=('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'uninstall.ps1') + '"') }
foreach($entry in $values.GetEnumerator()) { New-ItemProperty -Path $key -Name $entry.Key -Value $entry.Value -PropertyType String -Force | Out-Null }
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class IspEnvironment { [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr h,int m,IntPtr w,string l,int f,int t,out IntPtr r); }'
$result = [IntPtr]::Zero
[void][IspEnvironment]::SendMessageTimeout([IntPtr]0xffff,0x1a,[IntPtr]::Zero,'Environment',2,5000,[ref]$result)
