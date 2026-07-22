Add-Type -AssemblyName System.Drawing

function Create-Icon {
    param([int]$size, [string]$path)
    
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    
    # Background
    $g.Clear([System.Drawing.Color]::FromArgb(27, 40, 56))
    
    # Draw "G" letter
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(102, 192, 244))
    $fontSize = [Math]::Max(8, $size * 0.5)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString('G', $font, $brush, $rect, $sf)
    
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created: $path"
}

$iconDir = "c:\Users\TGFXP\Documents\QoderCN\2026-07-22\chat-1\game-recommender\icons"
Create-Icon -size 16 -path "$iconDir\icon16.png"
Create-Icon -size 48 -path "$iconDir\icon48.png"
Create-Icon -size 128 -path "$iconDir\icon128.png"
Write-Host "All icons created!"
