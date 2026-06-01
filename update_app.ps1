$content = [System.IO.File]::ReadAllText("app.js", [System.Text.Encoding]::UTF8)

$target1 = @'
        // 캔들 툴팁/설명 리셋
        const descEl = document.getElementById('detail-candle-desc');
        const pointerLine = document.getElementById('desc-pointer-line');
        const compLine = document.getElementById('desc-comparison-line');
        if (descEl) descEl.style.opacity = '0.4';
        if (pointerLine) pointerLine.innerHTML = 
            `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
        if (compLine) compLine.style.display = 'none';
    }
'@

$replace1 = @'
        // 캔들 툴팁/설명 리셋
        const descEl = document.getElementById('detail-candle-desc');
        const pointerLine = document.getElementById('desc-pointer-line');
        const compLine = document.getElementById('desc-comparison-line');
        if (descEl) descEl.style.opacity = '0.4';
        if (pointerLine) pointerLine.innerHTML = 
            `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
        if (compLine) compLine.style.display = 'none';

        // 동의 팝업 닫기
        const popup = document.getElementById('chart-info-consent-popup');
        if (popup && popup.style.display !== 'none') {
            popup.style.display = 'none';
            window._chartConsentPopupVisible = false;
        }
    }
'@

$target2 = @'
    setTimeout(() => {
        const fgScore = Math.floor(Math.random() * 60) + 20; 
        updateFearGreedGauge(fgScore);
    }, 500);
});
'@

$replace2 = @'
    setTimeout(() => {
        const fgScore = Math.floor(Math.random() * 60) + 20; 
        updateFearGreedGauge(fgScore);
    }, 500);

    // TradingView-style chart info consent popup helper
    window._chartConsentPopupVisible = false;

    function showChartConsentPopup(chart) {
        const popup = document.getElementById('chart-info-consent-popup');
        if (!popup) return;
        
        window._chartConsentPopupVisible = true;
        
        const canvas = chart.canvas;
        const rect = canvas.getBoundingClientRect();
        
        popup.style.display = 'block';
        // Center the popup over the chart area (using fixed positioning viewport space)
        popup.style.left = (rect.left + (rect.width - 280) / 2) + 'px';
        popup.style.top = (rect.top + (rect.height - 180) / 2) + 'px';
    }

    const consentBtn = document.getElementById('chart-consent-ok-btn');
    if (consentBtn) {
        consentBtn.addEventListener('click', () => {
            sessionStorage.setItem('chartDetailConsent', 'yes');
            const popup = document.getElementById('chart-info-consent-popup');
            if (popup) popup.style.display = 'none';
            window._chartConsentPopupVisible = false;
            
            // Immediately show comparison values if mouse is currently over chart
            const descEl = document.getElementById('detail-candle-desc');
            const compLine = document.getElementById('desc-comparison-line');
            if (descEl) descEl.style.opacity = '1';
            if (compLine) compLine.style.display = 'block';
        });
    }
});
'@

# Normalize line endings to match the LF file
$target1 = $target1.Replace("`r`n", "`n")
$replace1 = $replace1.Replace("`r`n", "`n")
$target2 = $target2.Replace("`r`n", "`n")
$replace2 = $replace2.Replace("`r`n", "`n")

if ($content.Contains($target1)) {
    $content = $content.Replace($target1, $replace1)
    Write-Host "Target 1 found and replaced successfully"
} else {
    Write-Host "Target 1 NOT found in file"
}

if ($content.Contains($target2)) {
    $content = $content.Replace($target2, $replace2)
    Write-Host "Target 2 found and replaced successfully"
} else {
    Write-Host "Target 2 NOT found in file"
}

[System.IO.File]::WriteAllText("app.js", $content, [System.Text.Encoding]::UTF8)
