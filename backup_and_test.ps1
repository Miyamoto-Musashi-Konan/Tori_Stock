# Dynamic Path Backup and Test Script using $PSScriptRoot
$srcDir = $PSScriptRoot
$backupBase = Join-Path $srcDir "backups"
$stableDir = Join-Path $backupBase "stable"

# Timestamp backup
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$timeDir = Join-Path $backupBase "backup_$timestamp"

# Files to backup
$files = @("app.js", "index.html", "style.css", "mock-data.js", "historical-data.js")

# Create directories
if (!(Test-Path -Path $stableDir)) {
    New-Item -ItemType Directory -Force -Path $stableDir | Out-Null
}
if (!(Test-Path -Path $timeDir)) {
    New-Item -ItemType Directory -Force -Path $timeDir | Out-Null
}

Write-Output "--- Backup Progress ---"

$allOk = $true

foreach ($file in $files) {
    $srcPath = Join-Path $srcDir $file
    if (Test-Path -Path $srcPath) {
        $destStable = Join-Path $stableDir $file
        $destTime = Join-Path $timeDir $file

        # Copy files
        Copy-Item -Path $srcPath -Destination $destStable -Force
        Copy-Item -Path $srcPath -Destination $destTime -Force

        # Verify integrity using Get-FileHash
        $srcHash = (Get-FileHash -Path $srcPath -Algorithm MD5).Hash
        $stableHash = (Get-FileHash -Path $destStable -Algorithm MD5).Hash
        $timeHash = (Get-FileHash -Path $destTime -Algorithm MD5).Hash

        if ($srcHash -eq $stableHash -and $srcHash -eq $timeHash) {
            Write-Output "[SUCCESS] $file has been backed up and verified (MD5: $srcHash)"
        } else {
            Write-Output "[ERROR] Integrity mismatch for $file!"
            $allOk = $false
        }
    } else {
        Write-Output "[WARNING] File not found: $file"
        $allOk = $false
    }
}

Write-Output "-----------------------"
if ($allOk) {
    Write-Output "Backup completed and tested successfully! All 5 core files are fully verified."
    Write-Output "Backup location: $timeDir"
} else {
    Write-Output "Backup verification failed! Please check error messages above."
    exit 1
}
