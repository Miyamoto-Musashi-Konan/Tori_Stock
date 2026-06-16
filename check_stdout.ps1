$srcFile = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 깃허브\Tori_Stock\app.js"

if (-not (Test-Path $srcFile)) {
    Write-Output "Error: app.js not found at $srcFile"
    exit
}

$c = [System.IO.File]::ReadAllText($srcFile)
$stack = [System.Collections.Generic.Stack[PSObject]]::new()
$mapping = @{ ')' = '('; '}' = '{'; ']' = '[' }
$line = 1
$col = 1

try {
    for ($i = 0; $i -lt $c.Length; $i++) {
        $char = $c[$i]
        if ($char -eq "`n") {
            $line++
            $col = 1
            continue
        }
        
        if ($char -eq '(' -or $char -eq '{' -or $char -eq '[') {
            $stack.Push(@{ char = $char; line = $line; col = $col })
        } elseif ($char -eq ')' -or $char -eq '}' -or $char -eq ']') {
            if ($stack.Count -eq 0) {
                Write-Output "Unmatched closing bracket '$char' at line $line, col $col"
                exit
            }
            $top = $stack.Pop()
            $expected = $mapping[$char]
            if ($top.char -ne $expected) {
                Write-Output "Mismatch: '$char' at line $line, col $col does not match '$($top.char)' from line $($top.line), col $($top.col)"
                exit
            }
        }
        $col++
    }

    if ($stack.Count -gt 0) {
        $top = $stack.Pop()
        Write-Output "Unmatched opening bracket '$($top.char)' from line $($top.line), col $($top.col) reached EOF"
    } else {
        Write-Output "All brackets are balanced successfully!"
    }
} catch {
    Write-Output "Error: $_"
}
