$srcFile = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 깃허브\Tori_Stock\app.js"
$destFile = "c:\Users\mdwin\Downloads\99_Vibe_Coding\주가 차트 분석 깃허브\Tori_Stock\check_result.txt"

if (-not (Test-Path $srcFile)) {
    [System.IO.File]::WriteAllText($destFile, "Error: app.js not found at $srcFile")
    exit
}

$c = [System.IO.File]::ReadAllText($srcFile)
$stack = [System.Collections.Generic.Stack[PSObject]]::new()
$mapping = @{ ')' = '('; '}' = '{'; ']' = '[' }
$line = 1
$col = 1
$result = ""

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
                $result = "Unmatched closing bracket '$char' at line $line, col $col"
                [System.IO.File]::WriteAllText($destFile, $result)
                exit
            }
            $top = $stack.Pop()
            $expected = $mapping[$char]
            if ($top.char -ne $expected) {
                $result = "Mismatch: '$char' at line $line, col $col does not match '$($top.char)' from line $($top.line), col $($top.col)"
                [System.IO.File]::WriteAllText($destFile, $result)
                exit
            }
        }
        $col++
    }

    if ($stack.Count -gt 0) {
        $top = $stack.Pop()
        $result = "Unmatched opening bracket '$($top.char)' from line $($top.line), col $($top.col) reached EOF"
    } else {
        $result = "All brackets are balanced successfully!"
    }
} catch {
    $result = "Error: $_"
}

[System.IO.File]::WriteAllText($destFile, $result)
