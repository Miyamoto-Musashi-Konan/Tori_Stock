# fetch_historical.ps1
$ErrorActionPreference = "Stop"

$startPeriod = 946684800
$endPeriod = [Math]::Floor([DateTimeOffset]::Now.ToUnixTimeSeconds())

Write-Host "Downloading FRED REER CSV..."
curl.exe -L -o "reer_raw.csv" "https://fred.stlouisfed.org/graph/fredgraph.csv?id=RBKRBIS"

$symbols = @{
    "kospi"  = "^KS11"
    "sp500"  = "^GSPC"
    "dxy"    = "DX-Y.NYB"
    "usdjpy" = "USDJPY=X"
    "usdkrw" = "USDKRW=X"
    "eurusd" = "EURUSD=X"
    "usdcny" = "USDCNY=X"
    "nasdaq" = "^IXIC"
}

foreach ($key in $symbols.Keys) {
    $sym = $symbols[$key]
    Write-Host ("Downloading Yahoo Finance data for " + $key + "...")
    $file = $key + "_raw.json"
    $url = "https://query1.finance.yahoo.com/v8/finance/chart/" + $sym + "?period1=" + $startPeriod + "&period2=" + $endPeriod + "&interval=1mo"
    curl.exe -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -L -o $file $url
}

Write-Host "Parsing downloaded data..."

$reerData = @{}
if (Test-Path "reer_raw.csv") {
    $lines = Get-Content "reer_raw.csv"
    foreach ($line in $lines) {
        if ($line -like "*observation_date*") { continue }
        $parts = $line.Split(",")
        if ($parts.Count -eq 2) {
            $dateStr = $parts[0]
            $valStr = $parts[1].Trim()
            if ($dateStr -and $valStr -and $valStr -ne ".") {
                $monthKey = $dateStr.Substring(0, 7)
                $reerData[$monthKey] = [double]$valStr
            }
        }
    }
}

function Parse-YahooJson($filePath) {
    $data = @{}
    if (Test-Path $filePath) {
        $content = Get-Content $filePath -Raw
        if ($content) {
            $json = ConvertFrom-Json $content
            $result = $json.chart.result[0]
            if ($result -and $result.timestamp) {
                $timestamps = $result.timestamp
                $closes = $result.indicators.quote[0].close
                for ($i = 0; $i -lt $timestamps.Count; $i++) {
                    $ts = $timestamps[$i]
                    $val = $closes[$i]
                    if ($ts -and $val -ne $null) {
                        $date = [DateTimeOffset]::FromUnixTimeSeconds($ts).DateTime
                        $monthKey = $date.ToString("yyyy-MM")
                        $data[$monthKey] = [double]$val
                    }
                }
            }
        }
    }
    return $data
}

$kospiObj = Parse-YahooJson "kospi_raw.json"
$sp500Obj = Parse-YahooJson "sp500_raw.json"
$dxyObj = Parse-YahooJson "dxy_raw.json"
$usdjpyObj = Parse-YahooJson "usdjpy_raw.json"
$usdkrwObj = Parse-YahooJson "usdkrw_raw.json"
$eurusdObj = Parse-YahooJson "eurusd_raw.json"
$usdcnyObj = Parse-YahooJson "usdcny_raw.json"
$nasdaqObj = Parse-YahooJson "nasdaq_raw.json"

Write-Host "Merging data by month..."

$startDate = Get-Date -Year 2000 -Month 1 -Day 1
$endDate = Get-Date
$currentDate = $startDate

$dataPoints = @()
$baseDxy = 101.87
$baseUsdJpy = 105.16

while ($currentDate -le $endDate) {
    $monthKey = $currentDate.ToString("yyyy-MM")
    $label = $currentDate.ToString("yyyy-MM")
    
    $kVal = 1000.0
    if ($kospiObj.ContainsKey($monthKey)) { $kVal = $kospiObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $kVal = $dataPoints[-1].kospi }
    
    $spVal = 1400.0
    if ($sp500Obj.ContainsKey($monthKey)) { $spVal = $sp500Obj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $spVal = $dataPoints[-1].sp500 }
    
    $dxyVal = $baseDxy
    if ($dxyObj.ContainsKey($monthKey)) { $dxyVal = $dxyObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $dxyVal = $dataPoints[-1].dxy }
    
    $ujVal = $baseUsdJpy
    if ($usdjpyObj.ContainsKey($monthKey)) { $ujVal = $usdjpyObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $ujVal = $dataPoints[-1].usdjpy }
    
    $ukVal = 1120.0
    if ($usdkrwObj.ContainsKey($monthKey)) { $ukVal = $usdkrwObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $ukVal = $dataPoints[-1].usdKrw }
    
    # Fix scale anomalies in USD/KRW (Yahoo Finance data errors where rate is divided by 10000)
    if ($ukVal -lt 10.0) {
        $ukVal = $ukVal * 10000.0
    }
    
    $euVal = 1.01
    if ($eurusdObj.ContainsKey($monthKey)) { $euVal = $eurusdObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $euVal = $dataPoints[-1].eurusd }
    
    $ucVal = 8.27
    if ($usdcnyObj.ContainsKey($monthKey)) { $ucVal = $usdcnyObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $ucVal = $dataPoints[-1].usdcny }
    
    $ndVal = 3500.0
    if ($nasdaqObj.ContainsKey($monthKey)) { $ndVal = $nasdaqObj[$monthKey] } elseif ($dataPoints.Count -gt 0) { $ndVal = $dataPoints[-1].nasdaq }
    
    $reerVal = 99.0
    if ($reerData.ContainsKey($monthKey)) { $reerVal = $reerData[$monthKey] } elseif ($dataPoints.Count -gt 0) { $reerVal = $dataPoints[-1].reer }
    
    # Range check validations
    if ($kVal -lt 100) { $kVal = if ($dataPoints.Count -gt 0) { $dataPoints[-1].kospi } else { 1000.0 } }
    if ($spVal -lt 100) { $spVal = if ($dataPoints.Count -gt 0) { $dataPoints[-1].sp500 } else { 1400.0 } }
    if ($ndVal -lt 100) { $ndVal = if ($dataPoints.Count -gt 0) { $dataPoints[-1].nasdaq } else { 3500.0 } }
    if ($ukVal -lt 500 -or $ukVal -gt 2500) { $ukVal = if ($dataPoints.Count -gt 0) { $dataPoints[-1].usdKrw } else { 1120.0 } }
    if ($ujVal -lt 50 -or $ujVal -gt 300) { $ujVal = if ($dataPoints.Count -gt 0) { $dataPoints[-1].usdjpy } else { $baseUsdJpy } }
    
    $usdValueIndex = [Math]::Round(100 * ($baseDxy / $dxyVal), 1)
    $jpyValueVsUsd = [Math]::Round(100 * ($baseUsdJpy / $ujVal), 1)
    
    $jpyKrw = [Math]::Round(100 * ($ukVal / $ujVal), 1)
    $eurKrw = [Math]::Round($ukVal * $euVal, 1)
    $cnyKrw = [Math]::Round($ukVal / $ucVal, 1)
    
    $yr = [Math]::Round($currentDate.Year + ($currentDate.Month - 1)/12.0, 2)
    
    $dp = [PSCustomObject]@{
        year = $yr
        label = $label
        kospi = [Math]::Round($kVal, 1)
        nasdaq = [Math]::Round($ndVal, 1)
        sp500 = [Math]::Round($spVal, 1)
        reer = [Math]::Round($reerVal, 1)
        usdKrw = [Math]::Round($ukVal, 1)
        jpyKrw = $jpyKrw
        eurKrw = $eurKrw
        cnyKrw = $cnyKrw
        jpyValueVsUsd = $jpyValueVsUsd
        usdValueIndex = $usdValueIndex
        dxy = [Math]::Round($dxyVal, 1)
        usdjpy = [Math]::Round($ujVal, 1)
        eurusd = [Math]::Round($euVal, 3)
        usdcny = [Math]::Round($ucVal, 3)
    }
    
    $dataPoints += $dp
    $currentDate = $currentDate.AddMonths(1)
}

$jsonStr = $dataPoints | ConvertTo-Json -Compress
$jsHeader = 'const REAL_HISTORICAL_DATA = '
$jsFooter = '; if (typeof module !== "undefined" && module.exports) { module.exports = REAL_HISTORICAL_DATA; } else { window.REAL_HISTORICAL_DATA = REAL_HISTORICAL_DATA; }'

$jsContent = $jsHeader + $jsonStr + $jsFooter
$jsContent | Out-File -FilePath "historical-data.js" -Encoding utf8

# Clean up temp files
Write-Host "Cleaning up temporary files..."
Remove-Item "reer_raw.csv" -ErrorAction SilentlyContinue
foreach ($key in $symbols.Keys) {
    Remove-Item ($key + "_raw.json") -ErrorAction SilentlyContinue
}

Write-Host "Success! Generated historical-data.js."
