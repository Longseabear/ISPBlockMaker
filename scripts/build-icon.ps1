# Windows icon rendition of docs/assets/logo.svg. No external graphics tools required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $PSScriptRoot '..\docs\assets\app.ico'
$frames = @()
foreach ($size in @(16,24,32,48,64,128,256)) {
    $bitmap = New-Object System.Drawing.Bitmap ($size * 4),($size * 4)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size / 10.0),($size / 10.0))
    $shape = New-Object Drawing.Drawing2D.GraphicsPath
    $shape.AddArc(0,0,22,22,180,90)
    $shape.AddArc(18,0,22,22,270,90)
    $shape.AddArc(18,18,22,22,0,90)
    $shape.AddArc(0,18,22,22,90,90)
    $shape.CloseFigure()
    $brush = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#183b31'))
    $graphics.FillPath($brush,$shape)
    $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#b6ead1')),2
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    foreach ($coords in @(@(9,14,20,8,31,14,20,20,9,14),@(9,20,20,26,31,20),@(9,26,20,32,31,26))) {
        $points = @()
        for ($i=0; $i -lt $coords.Length; $i+=2) { $points += New-Object Drawing.PointF $coords[$i],$coords[$i+1] }
        $graphics.DrawLines($pen,[Drawing.PointF[]]$points)
    }
    $small = New-Object Drawing.Bitmap $size,$size
    $scaled = [Drawing.Graphics]::FromImage($small)
    $scaled.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaled.DrawImage($bitmap,0,0,$size,$size)
    $stream = New-Object IO.MemoryStream
    $small.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $frames += ,@($size,$stream.ToArray())
    $stream.Dispose(); $scaled.Dispose(); $small.Dispose(); $pen.Dispose(); $brush.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$file = [IO.File]::Create($iconPath)
$writer = New-Object IO.BinaryWriter $file
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dimension = if ($frame[0] -eq 256) { 0 } else { $frame[0] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame[1].Length); $writer.Write([uint32]$offset)
        $offset += $frame[1].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame[1]) }
} finally { $writer.Dispose(); $file.Dispose() }
Write-Output "Built $iconPath"
