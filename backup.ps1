$srcDir = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터"
$backupBase = "$srcDir\backups"
$stableDir = "$backupBase\stable"

# 타임스탬프 설정
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$timeDir = "$backupBase\backup_$timestamp"

# 백업할 파일들
$files = @("app.js", "index.html", "style.css", "mock-data.js", "historical-data.js")

# 폴더 생성
if (!(Test-Path -Path $stableDir)) {
    New-Item -ItemType Directory -Force -Path $stableDir | Out-Null
}
New-Item -ItemType Directory -Force -Path $timeDir | Out-Null

Write-Host "Starting backup process..." -ForegroundColor Cyan

# 파일 복사
foreach ($file in $files) {
    $srcPath = Join-Path $srcDir $file
    if (Test-Path -Path $srcPath) {
        # stable 복사
        Copy-Item -Path $srcPath -Destination $stableDir -Force
        # 타임스탬프 복사
        Copy-Item -Path $srcPath -Destination $timeDir -Force
        Write-Host "Backed up: $file" -ForegroundColor Green
    } else {
        Write-Host "Warning: File not found - $file" -ForegroundColor Yellow
    }
}

Write-Host "Backup completed successfully!" -ForegroundColor Green
Write-Host "Stable Backup Location: $stableDir"
Write-Host "Timestamped Backup Location: $timeDir"
