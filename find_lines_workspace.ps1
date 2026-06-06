$patterns = @('initDollarBasisChart', 'dollarBasisChart', 'updateDollarBasisChart', 'valueLabelsPlugin', 'currencyLabelsPlugin', 'REAL_HISTORICAL_DATA', 'google-logout-btn', 'chart-historical-main', 'initHistoricalChart', 'big-chart-wrapper')
$results = @()
$filePath = Join-Path $PSScriptRoot "app.js"

$lines = Get-Content -Path $filePath
for ($i = 0; $i -lt $lines.Length; $i++) {
    $lineNum = $i + 1
    $line = $lines[$i]
    foreach ($pattern in $patterns) {
        if ($line.Contains($pattern)) {
            $results += "app.js:$lineNum | $pattern | $($line.Trim())"
            break
        }
    }
}

$results | Out-File -FilePath (Join-Path $PSScriptRoot "search_result_workspace.txt") -Encoding utf8
Write-Output "PowerShell search in workspace done."
