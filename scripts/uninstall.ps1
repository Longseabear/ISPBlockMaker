param([switch]$NoRegistration)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$manifest = Get-Content -LiteralPath (Join-Path $installRoot 'installed-files.json') -Raw | ConvertFrom-Json
# Only package-owned files are removed. Workspaces and local state are retained.
$targets = @($manifest | ForEach-Object {
    $candidate = [IO.Path]::GetFullPath((Join-Path $installRoot $_))
    if (!$candidate.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid uninstall path' }
    $candidate
})
foreach($file in $targets) { if(Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force } }
if (!$NoRegistration) {
    $bin = Join-Path $installRoot 'bin'
    $oldPath = [Environment]::GetEnvironmentVariable('Path','User')
    [Environment]::SetEnvironmentVariable('Path', (($oldPath -split ';' | Where-Object { $_.TrimEnd('\') -ine $bin.TrimEnd('\') }) -join ';'), 'User')
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'ISP Block Maker.lnk'
    if(Test-Path -LiteralPath $menu) { Remove-Item -LiteralPath $menu }
    Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ISPBlockMaker' -ErrorAction SilentlyContinue
}
Write-Output 'ISP Block Maker removed. Workspace files and logs were preserved.'
