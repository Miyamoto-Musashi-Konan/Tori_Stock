$files = @("app.js", "index.html", "style.css", "mock-data.js", "historical-data.js")
$dir1 = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터"
$dir2 = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 깃허브\Tori_Stock"
$outputPath = Join-Path $dir2 "comparison_result.txt"

$report = [System.Collections.Generic.List[string]]::new()
$report.Add("=== Core Files Comparison ===")

foreach ($file in $files) {
    $p1 = Join-Path $dir1 $file
    $p2 = Join-Path $dir2 $file
    
    $h1 = if (Test-Path $p1) { (Get-FileHash -Path $p1 -Algorithm MD5).Hash } else { "MISSING" }
    $h2 = if (Test-Path $p2) { (Get-FileHash -Path $p2 -Algorithm MD5).Hash } else { "MISSING" }
    
    if ($h1 -eq $h2) {
        $report.Add("[MATCH] $file")
    } else {
        # Check if the contents are identical excluding line endings
        $isSameExcludingLineEndings = $false
        if ($h1 -ne "MISSING" -and $h2 -ne "MISSING") {
            $c1 = [System.IO.File]::ReadAllText($p1).Replace("`r`n", "`n")
            $c2 = [System.IO.File]::ReadAllText($p2).Replace("`r`n", "`n")
            if ($c1 -eq $c2) {
                $isSameExcludingLineEndings = $true
            }
        }
        
        if ($isSameExcludingLineEndings) {
            $report.Add("[MATCH (Diff line endings only)] $file")
        } else {
            $report.Add("[MISMATCH] $file")
            $report.Add("  Data Dir  : $h1")
            $report.Add("  Tori Stock: $h2")
        }
    }
}
$report.Add("=============================")

$report | Out-File -FilePath $outputPath -Encoding utf8
Write-Output "Comparison completed!"
