$srcFile = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 깃허브\Tori_Stock\app.js"
$c = [System.IO.File]::ReadAllText($srcFile)

# Strip comments
$c = [regex]::Replace($c, "/\*[\s\S]*?\*/", "")
$c = [regex]::Replace($c, "//.*", "")

# Strip strings
$c = [regex]::Replace($c, "'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'", "''")
$c = [regex]::Replace($c, '"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"', '""')
$c = [regex]::Replace($c, '`[^`\\\\]*(?:\\\\.[^`\\\\]*)*`', '``')

# Strip typical regex literals
$c = [regex]::Replace($c, "/\\[^/]*/", "null")
$c = $c.Replace("/\(([^)]+)\)/", "null")

$b = $c -replace '[^{}\[\]()]', ''

$stack = [System.Collections.Generic.Stack[char]]::new()
$mapping = @{ '}' = '{'; ')' = '('; ']' = '[' }
$balanced = $true

for ($i = 0; $i -lt $b.Length; $i++) {
    $char = $b[$i]
    if ($char -eq '{' -or $char -eq '(' -or $char -eq '[') {
        $stack.Push($char)
    } elseif ($char -eq '}' -or $char -eq ')' -or $char -eq ']') {
        if ($stack.Count -eq 0) {
            Write-Output "Unmatched closing bracket '$char' at index $i"
            $balanced = $false
            break
        }
        $top = $stack.Pop()
        if ($top -ne $mapping[$char]) {
            Write-Output "Mismatch: '$char' does not match '$top' at index $i"
            $balanced = $false
            break
        }
    }
}

if ($balanced) {
    if ($stack.Count -gt 0) {
        Write-Output "Unmatched opening bracket '$($stack.Pop())' reached EOF"
    } else {
        Write-Output "All brackets are balanced successfully!"
    }
}
