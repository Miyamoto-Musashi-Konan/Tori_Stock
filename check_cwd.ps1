$dest = "C:\Users\mdwin\.gemini\antigravity-ide\scratch\cwd_result.txt"
$cwd = Get-Location
$files = Get-ChildItem | Select-Object Name, Length
$output = "CWD: $cwd`n`nFiles:`n"
foreach ($f in $files) {
    $output += "$($f.Name) ($($f.Length) bytes)`n"
}
[System.IO.File]::WriteAllText($dest, $output)
