$content = [System.IO.File]::ReadAllText("index.html", [System.Text.Encoding]::UTF8)

# Normalize CRLF to LF in content for robust matching
$c_lf = $content.Replace("`r`n", "`n")

# 1. Target for nav button integration
$target1 = @'
            <div class="glass-nav-card" id="tab-detail" onclick="switchTab('detail')">
                <span class="nav-icon">🔍</span>
                <span class="nav-label-main">종목 분석</span>
                <span class="nav-label-sub">Detailed Chart</span>
            </div>
        </div>
'@
$target1 = $target1.Replace("`r`n", "`n")

$replace1 = @'
            <div class="glass-nav-card" id="tab-detail" onclick="switchTab('detail')">
                <span class="nav-icon">🔍</span>
                <span class="nav-label-main">종목 분석</span>
                <span class="nav-label-sub">Detailed Chart</span>
            </div>
            <div class="glass-nav-card" id="tab-external" onclick="switchTab('external')">
                <span class="nav-icon">🔗</span>
                <span class="nav-label-main">경제지표 외부링크</span>
                <span class="nav-label-sub">External Links</span>
            </div>
        </div>
'@
$replace1 = $replace1.Replace("`r`n", "`n")

# 2. Target for removing old glass-external-grid
$target2 = @'
        <!-- 글래스모피즘 외부 링크 그리드 -->
        <div class="glass-external-grid">
            <a href="https://markets.hankyung.com/" target="_blank" class="glass-external-card">
                <span class="ext-icon">📈</span>
                <span class="ext-label-main">컨센서스</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
            <a href="https://markets.hankyung.com/consensus" target="_blank" class="glass-external-card">
                <span class="ext-icon">📄</span>
                <span class="ext-label-main">애널리스트 리포트</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
            <a href="https://markets.hankyung.com/investment/investors" target="_blank" class="glass-external-card">
                <span class="ext-icon">👥</span>
                <span class="ext-label-main">투자주체 동향</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
            <a href="https://markets.hankyung.com/marketmap/kospi" target="_blank" class="glass-external-card">
                <span class="ext-icon">🗺️</span>
                <span class="ext-label-main">코스피 맵</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
            <a href="https://markets.hankyung.com/marketmap/kosdaq" target="_blank" class="glass-external-card">
                <span class="ext-icon">🗺️</span>
                <span class="ext-label-main">코스닥 맵</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
            <a href="https://markets.hankyung.com/index-info/volume" target="_blank" class="glass-external-card">
                <span class="ext-icon">📊</span>
                <span class="ext-label-main">거래량 순위</span>
                <span class="ext-label-sub">외부 링크</span>
            </a>
        </div>
'@
$target2 = $target2.Replace("`r`n", "`n")

# 3. Target for adding section-external before footer
$target3 = @'
        </main>

        <footer>
'@
$target3 = $target3.Replace("`r`n", "`n")

# We make the glass-external-grid inside section-external a 3-column layout (3 top, 3 bottom) using style="grid-template-columns: repeat(3, 1fr);"
$replace3 = @'
        </main>

        <!-- [VIEW 6] 경제지표 외부링크 탭 -->
        <main class="tab-view" id="section-external" style="display: none;">
            <div class="market-summary-box" style="margin-bottom: 40px; background: rgba(13, 20, 38, 0.4); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 18px; padding: 30px; box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 12px 32px rgba(0, 0, 0, 0.2); backdrop-filter: blur(25px) saturate(160%);">
                <div class="summary-header" style="margin-bottom: 24px;">
                    <h2 class="section-title" style="margin: 0; font-size: 20px;">📊 경제지표 외부링크</h2>
                    <p style="color: var(--text-muted); font-size: 13px; margin: 6px 0 0 0;">주요 경제지표 및 분석 사이트 외부 링크 목록입니다.</p>
                </div>
                <!-- 글래스모피즘 외부 링크 그리드 - 3열 배치 (위의 3개, 아래 3개 대칭) -->
                <div class="glass-external-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 10px;">
                    <a href="https://markets.hankyung.com/" target="_blank" class="glass-external-card">
                        <span class="ext-icon">📈</span>
                        <span class="ext-label-main">컨센서스</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                    <a href="https://markets.hankyung.com/consensus" target="_blank" class="glass-external-card">
                        <span class="ext-icon">📄</span>
                        <span class="ext-label-main">애널리스트 리포트</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                    <a href="https://markets.hankyung.com/investment/investors" target="_blank" class="glass-external-card">
                        <span class="ext-icon">👥</span>
                        <span class="ext-label-main">투자주체 동향</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                    <a href="https://markets.hankyung.com/marketmap/kospi" target="_blank" class="glass-external-card">
                        <span class="ext-icon">🗺️</span>
                        <span class="ext-label-main">코스피 맵</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                    <a href="https://markets.hankyung.com/marketmap/kosdaq" target="_blank" class="glass-external-card">
                        <span class="ext-icon">🗺️</span>
                        <span class="ext-label-main">코스닥 맵</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                    <a href="https://markets.hankyung.com/index-info/volume" target="_blank" class="glass-external-card">
                        <span class="ext-icon">📊</span>
                        <span class="ext-label-main">거래량 순위</span>
                        <span class="ext-label-sub">외부 링크</span>
                    </a>
                </div>
            </div>
        </main>

        <footer>
'@
$replace3 = $replace3.Replace("`r`n", "`n")

if ($c_lf.Contains($target1)) {
    $c_lf = $c_lf.Replace($target1, $replace1)
    Write-Host "Target 1 found and replaced"
} else {
    Write-Host "Target 1 NOT found"
}

if ($c_lf.Contains($target2)) {
    $c_lf = $c_lf.Replace($target2, "")
    Write-Host "Target 2 found and removed"
} else {
    Write-Host "Target 2 NOT found"
}

if ($c_lf.Contains($target3)) {
    $c_lf = $c_lf.Replace($target3, $replace3)
    Write-Host "Target 3 found and replaced"
} else {
    Write-Host "Target 3 NOT found"
}

# Restore CRLF if file originally had it (index.html line endings check)
if ($content.Contains("`r`n")) {
    $final = $c_lf.Replace("`n", "`r`n")
} else {
    $final = $c_lf
}

[System.IO.File]::WriteAllText("index.html", $final, [System.Text.Encoding]::UTF8)
