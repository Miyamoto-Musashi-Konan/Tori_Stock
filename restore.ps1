# Dynamic Path Recovery Script using $PSScriptRoot
$srcDir = $PSScriptRoot
$backupBase = Join-Path $srcDir "backups"
$stableDir = Join-Path $backupBase "stable"
$rollbackTempDir = Join-Path $backupBase "before_restore"

# Files to restore
$files = @("app.js", "index.html", "style.css", "mock-data.js", "historical-data.js")

if (!(Test-Path -Path $stableDir)) {
    Write-Error "Error: Stable backup directory does not exist. Please run backup_and_test.ps1 first to create a stable checkpoint."
    exit 1
}

Write-Host "Starting recovery process..." -ForegroundColor Cyan

# 1. Create a safety rollback backup of current files
if (!(Test-Path -Path $rollbackTempDir)) {
    New-Item -ItemType Directory -Force -Path $rollbackTempDir | Out-Null
}
Write-Host "Creating a safety backup of your current files at: $rollbackTempDir" -ForegroundColor Yellow

foreach ($file in $files) {
    $currentFilePath = Join-Path $srcDir $file
    if (Test-Path -Path $currentFilePath) {
        Copy-Item -Path $currentFilePath -Destination $rollbackTempDir -Force
    }
}

# 2. Restore stable files to work directory
Write-Host "Restoring stable version files to work directory..." -ForegroundColor Yellow
foreach ($file in $files) {
    $stableFilePath = Join-Path $stableDir $file
    if (Test-Path -Path $stableFilePath) {
        Copy-Item -Path $stableFilePath -Destination $srcDir -Force
        Write-Host "Restored: $file" -ForegroundColor Green
    } else {
        Write-Host "Error: Stable backup file missing - $file" -ForegroundColor Red
    }
}

Write-Host "Restoration completed successfully!" -ForegroundColor Green
Write-Host "Please refresh your browser (index.html) to reload the working stable dashboard."
