$content = [System.IO.File]::ReadAllText("app.js", [System.Text.Encoding]::UTF8)

# Normalize CRLF to LF in content for robust matching
$c_lf = $content.Replace("`r`n", "`n")

$target = @'
    // 7. 내비게이션 탭 스위칭 최적화 (switchTab)
    window.switchTab = function(tabName) {
        // 모든 탭 버튼 비활성화 및 active 클래스 교체
        const tabs = ['overview', 'history', 'travel', 'sentiment', 'detail'];
'@
$target = $target.Replace("`r`n", "`n")

$replace = @'
    // 7. 내비게이션 탭 스위칭 최적화 (switchTab)
    window.switchTab = function(tabName) {
        // 모든 탭 버튼 비활성화 및 active 클래스 교체
        const tabs = ['overview', 'history', 'travel', 'sentiment', 'detail', 'external'];
'@
$replace = $replace.Replace("`r`n", "`n")

if ($c_lf.Contains($target)) {
    $c_lf = $c_lf.Replace($target, $replace)
    Write-Host "Target found and replaced"
} else {
    Write-Host "Target NOT found"
}

# Preserve original line endings (LF in app.js)
if ($content.Contains("`r`n")) {
    $final = $c_lf.Replace("`n", "`r`n")
} else {
    $final = $c_lf
}

[System.IO.File]::WriteAllText("app.js", $final, [System.Text.Encoding]::UTF8)
