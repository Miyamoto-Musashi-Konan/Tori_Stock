$path = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터\app.js"
Get-Content -Path $path -Encoding UTF8 -TotalCount 20 | Out-File -FilePath "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터\output_utf8.txt" -Encoding UTF8
Get-Content -Path $path -Encoding Default -TotalCount 20 | Out-File -FilePath "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 데이터\output_default.txt" -Encoding UTF8
