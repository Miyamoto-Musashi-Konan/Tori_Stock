$srcDir = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터"
$backupBase = Join-Path $srcDir "backups"
$stableDir = Join-Path $backupBase "stable"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$timeDir = Join-Path $backupBase ("backup_" + $timestamp)

$files = @("app.js", "index.html", "style.css", "mock-data.js", "historical-data.js")

if (!(Test-Path -Path $stableDir)) {
    New-Item -ItemType Directory -Force -Path $stableDir | Out-Null
}
New-Item -ItemType Directory -Force -Path $timeDir | Out-Null

Write-Host "Starting backup process..."

foreach ($file in $files) {
    $srcPath = Join-Path $srcDir $file
    if (Test-Path -Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $stableDir -Force
        Copy-Item -Path $srcPath -Destination $timeDir -Force
        Write-Host "Backed up: $file"
    } else {
        Write-Host "Warning: File not found - $file"
    }
}

Write-Host "Backup completed successfully!"
Write-Host "Stable Backup Location: $stableDir"
Write-Host "Timestamped Backup Location: $timeDir"
