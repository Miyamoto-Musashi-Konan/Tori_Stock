/**
 * 실시간 주가 차트 분석 대시보드 - 메인 애플리케이션 로직 (app.js)
 * Chart.js 연동, 데이터 로딩, 실시간 갱신 및 상세 차트 그리기 기능 제공
 */

function initDashboardApp() {
    // 1. 상태 및 전역 변수 정의
    let miniCharts = {};

    // Adjust chart container height dynamically based on data density
    function adjustChartHeight(chart, baseHeight = 260) {
        if (!chart) return;
        const dataLen = chart.data.datasets.reduce((sum, ds) => sum + (ds.data?.length || 0), 0);
        let heightFactor = 1;
        if (dataLen > 150) heightFactor = 1.5;
        if (dataLen > 300) heightFactor = 2;
        const newHeight = baseHeight * heightFactor;
        const container = chart.canvas.parentNode;
        if (container) {
            container.style.height = `${newHeight}px`;
        }
        chart.resize();
    }
    let historicalChart = null;
    let historicalData = [];
    let activeDatasets = {
        reer: true,
        usdVal: true,
        kospi: true,
        sp500: false,
        jpyVal: false
    };
    let detailChart = null;
    let detailVolumeChart = null;

    // Fear & Greed 대형 게이지 물리 바늘 진동 상태 변수 및 렌더러
    let currentNeedleAngle = -90; 
    let targetNeedleAngle = -90;
    let lastLitTickIndex = -1;

    // 100 Ticks Color interpolation helper (Comfortable green/warm tones, avoiding harsh neon)
    function getInterpolatedColor(percent) {
        const anchors = [
            { pct: 0, r: 180, g: 50, b: 50 },      // Soft matte red
            { pct: 25, r: 210, g: 110, b: 50 },    // Soft amber-orange
            { pct: 50, r: 120, g: 130, b: 140 },   // Soft warm gray / slate
            { pct: 75, r: 46, g: 125, b: 50 },     // Comfortable green
            { pct: 100, r: 15, g: 90, b: 70 }      // Premium deep emerald
        ];
        
        let lower = anchors[0];
        let upper = anchors[anchors.length - 1];
        
        for (let i = 0; i < anchors.length - 1; i++) {
            if (percent >= anchors[i].pct && percent <= anchors[i + 1].pct) {
                lower = anchors[i];
                upper = anchors[i + 1];
                break;
            }
        }
        
        const range = upper.pct - lower.pct;
        const rangePct = range === 0 ? 0 : (percent - lower.pct) / range;
        
        const r = Math.round(lower.r + (upper.r - lower.r) * rangePct);
        const g = Math.round(lower.g + (upper.g - lower.g) * rangePct);
        const b = Math.round(lower.b + (upper.b - lower.b) * rangePct);
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Initialize 100 ticks inside the SVG dynamically (Clock style dial)
    function initGaugeTicks() {
        const ticksContainer = document.getElementById("fg-gauge-ticks");
        if (ticksContainer) {
            let ticksHTML = "";
            for (let i = 0; i <= 100; i++) {
                const angle = -90 + (i * 1.8);
                const color = getInterpolatedColor(i);
                
                // Clock-style ticks: every 10 is long & thick, every 5 is medium, rest is small
                let y1 = 16;
                let y2 = 24;
                let strokeWidth = 1.0;
                if (i % 10 === 0) {
                    y1 = 11;
                    y2 = 29;
                    strokeWidth = 2.0;
                } else if (i % 5 === 0) {
                    y1 = 13;
                    y2 = 27;
                    strokeWidth = 1.5;
                }
                
                ticksHTML += `<line x1="120" y1="${y1}" x2="120" y2="${y2}" 
                    class="fg-gauge-tick" 
                    data-index="${i}" 
                    transform="rotate(${angle}, 120, 120)" 
                    stroke="${color}" 
                    stroke-width="${strokeWidth}" 
                    stroke-linecap="round" 
                    style="opacity: 0.1; transition: opacity 0.25s ease, filter 0.25s ease;" />`;
            }
            ticksContainer.innerHTML = ticksHTML;
        }
    }

    function animateNeedle() {
        const diff = targetNeedleAngle - currentNeedleAngle;
        currentNeedleAngle += diff * 0.08; 

        // 85Hz 모터 고주파 진동 + 화이트 노이즈로 실제 계기판 떨림 구현
        const timeSec = Date.now() / 1000;
        const motorFreq = Math.sin(timeSec * 85) * 0.15;
        const needleNoise = (Math.random() - 0.5) * 0.35;
        
        const finalAngle = currentNeedleAngle + motorFreq + needleNoise;

        if (largeMeterNeedleEl) {
            largeMeterNeedleEl.setAttribute("transform", `rotate(${finalAngle}, 120, 120)`);
        }

        // Dynamically light up ticks based on current needle angle (Chronograph LED sweeping)
        const currentScoreVal = Math.round((currentNeedleAngle + 90) / 1.8);
        if (lastLitTickIndex !== currentScoreVal) {
            lastLitTickIndex = currentScoreVal;
            const tickEls = document.querySelectorAll(".fg-gauge-tick");
            tickEls.forEach((tickEl) => {
                const idx = parseInt(tickEl.getAttribute("data-index"));
                if (idx <= currentScoreVal) {
                    tickEl.style.opacity = "1";
                    const tickColor = tickEl.getAttribute("stroke");
                    // Comfortable warm matte glow (using soft drop-shadow)
                    tickEl.style.filter = `drop-shadow(0 0 2px ${tickColor})`;
                } else {
                    tickEl.style.opacity = "0.08";
                    tickEl.style.filter = "none";
                }
            });
        }

        requestAnimationFrame(animateNeedle);
    }

    // Custom crosshair & Callout Line plugin (십자선 및 마우스 접점 안내선 그리기 플러그인)
    const customCrosshairPlugin = {
        id: 'customCrosshair',
        afterEvent: (chart, args) => {
            if (args.event.type === 'mousemove') {
                // 잠금 모드 중이면 일반 이벤트 추적 스킵
                if (chart._lockedCandle) return;
                chart._mouseEvent = args.event;
                chart.draw();

                // 상세 캔들 차트에서만 실시간 가격 트래킹
                if (chart.canvas.id === 'chart-ticker-detail' && chart.scales && chart.scales.y) {
                    const descEl        = document.getElementById('detail-candle-desc');
                    const pointerLine   = document.getElementById('desc-pointer-line');
                    const compLine      = document.getElementById('desc-comparison-line');
                    if (!descEl || !pointerLine) return;

                    // Y축 마우스 위치 가격 (실시간 트래킹 - 차트 어디나)
                    const hoveredPrice  = chart.scales.y.getValueForPixel(args.event.y);
                    const currency      = window.currentDetailCurrency || '';
                    const isKrwJpy      = currency === 'KRW' || currency === 'JPY';
                    const formattedPrice = formatNumber(hoveredPrice, isKrwJpy ? 0 : 2);

                    // 1행: 항상 실시간 포인터 가격 표시
                    descEl.style.opacity = '1';
                    pointerLine.innerHTML =
                        `🎯 <strong>실시간 포인터:</strong> ` +
                        `<span style="color:#60a5fa; font-weight:700; font-size:14px;">${formattedPrice} ${currency}</span>`;

                    // 동의 여부 확인 (세션스토리지 기반 - 재방문 시 초기화)
                    const consentGiven = sessionStorage.getItem('chartDetailConsent') === 'yes';

                    // 첫 호버 시 동의 팝업 표시
                    if (!consentGiven && !window._chartConsentPopupVisible) {
                        showChartConsentPopup(chart);
                    }

                    // 2행: 동의 + 캔들 위에 있을 때만 시가·종가대비 표시
                    if (compLine) {
                        const hasActive = chart.tooltip && chart.tooltip._active && chart.tooltip._active.length;
                        if (consentGiven && hasActive) {
                            const activePoint = chart.tooltip._active[0];
                            const rawData = chart.data.datasets[activePoint.datasetIndex]?.data[activePoint.index];

                            if (rawData && rawData.o !== undefined && rawData.c !== undefined) {
                                const pctOpen  = ((hoveredPrice - rawData.o) / rawData.o * 100);
                                const pctClose = ((hoveredPrice - rawData.c) / rawData.c * 100);
                                const col = v => v >= 0 ? '#10b981' : '#f43f5e';
                                const sg  = v => v >= 0 ? '+' : '';
                                compLine.style.display = 'block';
                                compLine.innerHTML =
                                    `시가대비: <span style="color:${col(pctOpen)}; font-weight:700;">${sg(pctOpen)}${pctOpen.toFixed(2)}%</span>` +
                                    ` &nbsp;|&nbsp; 종가대비: <span style="color:${col(pctClose)}; font-weight:700;">${sg(pctClose)}${pctClose.toFixed(2)}%</span>`;
                            } else if (rawData && rawData.y !== undefined) {
                                const pctChange = ((hoveredPrice - rawData.y) / rawData.y * 100);
                                const col = v => v >= 0 ? '#10b981' : '#f43f5e';
                                const sg  = v => v >= 0 ? '+' : '';
                                compLine.style.display = 'block';
                                compLine.innerHTML = `종가대비: <span style="color:${col(pctChange)}; font-weight:700;">${sg(pctChange)}${pctChange.toFixed(2)}%</span>`;
                            } else {
                                compLine.style.display = 'none';
                            }
                        } else {
                            compLine.style.display = 'none';
                        }
                    }
                }
            } else if (args.event.type === 'mouseout') {
                // 잠금 모드가 아닐 때만 마우스 이벤트 초기화
                if (!chart._lockedCandle) {
                    chart._mouseEvent = null;
                    chart.draw();

                    if (chart.canvas.id === 'chart-ticker-detail') {
                        const descEl      = document.getElementById('detail-candle-desc');
                        const pointerLine = document.getElementById('desc-pointer-line');
                        const compLine    = document.getElementById('desc-comparison-line');
                        if (descEl)      descEl.style.opacity = '0.4';
                        if (pointerLine) pointerLine.innerHTML =
                            `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
                        if (compLine)    compLine.style.display = 'none';
                    }
                }
            }
        },
        afterDraw: chart => {
            // ── 잠금 모드 렌더링 ──
            if (chart._lockedCandle && chart._lockedCandle.chart === chart) {
                const lock = chart._lockedCandle;
                const ctx = chart.ctx;
                const scaleY = chart.scales.y;
                const topY = chart.chartArea.top;
                const bottomY = chart.chartArea.bottom;
                const leftX = chart.chartArea.left;
                const rightX = chart.chartArea.right;
                const x = lock.x;
                const y = lock.currentY;
                const rawData = lock.rawData;

                // 캔들 시가/종가/고가/저가 Y 픽셀 계산
                const highY  = scaleY.getPixelForValue(rawData.h !== undefined ? rawData.h : rawData.y);
                const lowY   = scaleY.getPixelForValue(rawData.l !== undefined ? rawData.l : rawData.y);
                const openY  = rawData.o !== undefined ? scaleY.getPixelForValue(rawData.o) : null;
                const closeY = rawData.c !== undefined ? scaleY.getPixelForValue(rawData.c) : null;

                ctx.save();

                // 캔들 범위 하이라이트 (고가~저가)
                ctx.fillStyle = 'rgba(251, 191, 36, 0.07)';
                ctx.fillRect(leftX, highY, rightX - leftX, lowY - highY);

                // 고가·저가 수평 가이드선
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
                ctx.beginPath(); ctx.moveTo(leftX, highY); ctx.lineTo(rightX, highY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(leftX, lowY);  ctx.lineTo(rightX, lowY);  ctx.stroke();

                // 시가·종가 수평 가이드선
                if (openY !== null) {
                    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
                    ctx.setLineDash([3, 5]);
                    ctx.beginPath(); ctx.moveTo(leftX, openY); ctx.lineTo(rightX, openY); ctx.stroke();
                }
                if (closeY !== null) {
                    ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
                    ctx.setLineDash([3, 5]);
                    ctx.beginPath(); ctx.moveTo(leftX, closeY); ctx.lineTo(rightX, closeY); ctx.stroke();
                }

                // 잠금 수직선 (황금색 실선)
                ctx.setLineDash([]);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
                ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();

                // 자유 수평선 (흰색 점선)
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.beginPath(); ctx.moveTo(leftX, y); ctx.lineTo(rightX, y); ctx.stroke();

                // 현재 포인터 동그라미
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                // 잠금 아이콘 (캔들 위에 핀 표시)
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('📍', x, topY - 2);

                ctx.restore();

                // Y축 가격 배지 (황금색)
                if (scaleY) {
                    const currency = (chart.canvas.id === 'chart-ticker-detail') ? (window.currentDetailCurrency || '') : '';
                    const hasKrwJpy = currency === 'KRW' || currency === 'JPY';
                    const hoveredPrice = scaleY.getValueForPixel(y);
                    const priceText = formatNumber(hoveredPrice, hasKrwJpy ? 0 : 2) + (currency ? ' ' + currency : '');

                    ctx.save();
                    ctx.font = 'bold 10px Inter, sans-serif';
                    const textWidth = ctx.measureText(priceText).width;
                    const rectWidth = textWidth + 10;
                    const rectHeight = 16;
                    const rectY = y - rectHeight / 2;
                    const isRightAxis = scaleY.left > chart.chartArea.left;
                    const rectX = isRightAxis ? scaleY.left : (scaleY.right - rectWidth);

                    ctx.fillStyle = 'rgba(120, 80, 0, 0.95)';
                    ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, 4);
                    } else {
                        ctx.rect(rectX, rectY, rectWidth, rectHeight);
                    }
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#fbbf24';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(priceText, rectX + rectWidth / 2, y);
                    ctx.restore();
                }

                // desc 바 업데이트 (잠금 모드 - 2줄 구조)
                const lockDescEl    = document.getElementById('detail-candle-desc');
                const lockPtrLine   = document.getElementById('desc-pointer-line');
                const lockCompLine  = document.getElementById('desc-comparison-line');
                if (lockDescEl && lockPtrLine && rawData) {
                    const currency    = window.currentDetailCurrency || '';
                    const hasKrwJpy   = currency === 'KRW' || currency === 'JPY';
                    const currentPrice = scaleY.getValueForPixel(y);
                    const formattedPrice = formatNumber(currentPrice, hasKrwJpy ? 0 : 2);
                    lockDescEl.style.opacity = '1';

                    // 1행: 잠금 모드 실시간 포인터
                    lockPtrLine.innerHTML =
                        `📍 <strong style="color:#fbbf24;">잠금모드</strong> &nbsp; ` +
                        `<span style="color:#fbbf24; font-weight:700; font-size:14px;">${formattedPrice} ${currency}</span>` +
                        ` &nbsp;<span style="color:var(--text-muted); font-size:10px;">[클릭 or ESC 로 해제]</span>`;

                    // 2행: 시가·종가대비
                    if (lockCompLine && rawData.o !== undefined && rawData.c !== undefined) {
                        const pctOpen  = ((currentPrice - rawData.o) / rawData.o * 100);
                        const pctClose = ((currentPrice - rawData.c) / rawData.c * 100);
                        const pctHigh  = rawData.h !== undefined ? ((currentPrice - rawData.h) / rawData.h * 100) : null;
                        const pctLow   = rawData.l !== undefined ? ((currentPrice - rawData.l) / rawData.l * 100) : null;
                        const col = v => v >= 0 ? '#10b981' : '#f43f5e';
                        const sg  = v => v >= 0 ? '+' : '';
                        lockCompLine.style.display = 'block';
                        lockCompLine.innerHTML =
                            `시가대비: <span style="color:${col(pctOpen)}; font-weight:700;">${sg(pctOpen)}${pctOpen.toFixed(2)}%</span>` +
                            ` &nbsp;|&nbsp; 종가대비: <span style="color:${col(pctClose)}; font-weight:700;">${sg(pctClose)}${pctClose.toFixed(2)}%</span>` +
                            (pctHigh !== null ? ` &nbsp;|&nbsp; 고가대비: <span style="color:${col(pctHigh)}; font-weight:700;">${sg(pctHigh)}${pctHigh.toFixed(2)}%</span>` : '') +
                            (pctLow  !== null ? ` &nbsp;|&nbsp; 저가대비: <span style="color:${col(pctLow)}; font-weight:700;">${sg(pctLow)}${pctLow.toFixed(2)}%</span>` : '');
                    } else if (lockCompLine) {
                        lockCompLine.style.display = 'none';
                    }
                }

                return; // 잠금 모드에서는 일반 십자선 렌더링 스킵
            }

            // ── 일반 호버 모드 렌더링 ──
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length && chart._mouseEvent) {
                const activePoint = chart.tooltip._active[0];
                const ctx = chart.ctx;
                
                const x = activePoint.element.x !== undefined ? activePoint.element.x : chart._mouseEvent.x;
                let y = chart._mouseEvent.y;
                
                const topY = chart.chartArea ? chart.chartArea.top : chart.scales.y.top;
                const bottomY = chart.chartArea ? chart.chartArea.bottom : chart.scales.y.bottom;
                const leftX = chart.chartArea ? chart.chartArea.left : chart.scales.x.left;
                const rightX = chart.chartArea ? chart.chartArea.right : chart.scales.x.right;
                
                if (y < topY) y = topY;
                if (y > bottomY) y = bottomY;

                // 1. 십자선 (Crosshair) 그리기
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([4, 4]);
                ctx.moveTo(x, topY); ctx.lineTo(x, bottomY);
                ctx.moveTo(leftX, y); ctx.lineTo(rightX, y);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 십자선 선 색상
                ctx.stroke();
                
                // 마우스 접점에 작은 동그라미 표시
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
                ctx.restore();

                // 2. Y축 가격 라벨 배지 (TradingView style Y-axis label) 그리기
                const scaleY = chart.scales.y;
                if (scaleY) {
                    const hoveredPrice = scaleY.getValueForPixel(y);
                    const currency = (chart.canvas.id === 'chart-ticker-detail') ? (window.currentDetailCurrency || '') : '';
                    const hasKrwJpy = currency === 'KRW' || currency === 'JPY';
                    const priceText = formatNumber(hoveredPrice, hasKrwJpy ? 0 : 2) + (currency ? ' ' + currency : '');
                    
                    ctx.save();
                    ctx.font = 'bold 10px Inter, sans-serif';
                    const textWidth = ctx.measureText(priceText).width;
                    const rectWidth = textWidth + 10;
                    const rectHeight = 16;
                    const rectY = y - rectHeight / 2;
                    
                    // Y축 위치 판단 (보통 오른쪽에 Y축이 위치해 있음)
                    const isRightAxis = scaleY.left > chart.chartArea.left;
                    const rectX = isRightAxis ? scaleY.left : (scaleY.right - rectWidth);
                    
                    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; // 어두운 슬레이트
                    ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)'; // 소프트 블루 테두리
                    ctx.lineWidth = 1;
                    
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, 4);
                    } else {
                        ctx.rect(rectX, rectY, rectWidth, rectHeight);
                    }
                    ctx.fill();
                    ctx.stroke();
                    
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(priceText, rectX + rectWidth / 2, y);
                    ctx.restore();
                }
                
                // 3. 마우스 접점과 툴팁 박스 연결선 (Callout Line) 그리기
                const tooltipEl = document.getElementById('chartjs-floating-tooltip');
                if (tooltipEl && tooltipEl.style.opacity === '1') {
                    const tw = tooltipEl.offsetWidth || 180;
                    const th = tooltipEl.offsetHeight || 100;
                    
                    const py = activePoint.element.y !== undefined ? activePoint.element.y : y;
                    
                    const canvasPos = chart.canvas.getBoundingClientRect();
                    const absoluteTargetTop = canvasPos.top + window.scrollY + py - th - 15;
                    const isTooltipBelow = absoluteTargetTop < window.scrollY + 10;
                    
                    const tipBoxX = x;
                    const tipBoxY = isTooltipBelow ? (py + 25) : (py - 15 - th);
                    
                    const ldx = tipBoxX - x;
                    const ldy = tipBoxY - py;
                    const dist = Math.sqrt(ldx * ldx + ldy * ldy);
                    
                    const rx = tipBoxX - tw / 2;
                    const ry = isTooltipBelow ? (py + 25) : (py - 15 - th);
                    const rw = tw;
                    const rh = th;
                    
                    let tMin = 1.0;
                    if (ldx > 0) {
                        const t = (rx - x) / ldx;
                        if (t > 0 && t < tMin) tMin = t;
                    } else if (ldx < 0) {
                        const t = (rx + rw - x) / ldx;
                        if (t > 0 && t < tMin) tMin = t;
                    }
                    
                    if (ldy > 0) {
                        const t = (ry - py) / ldy;
                        if (t > 0 && t < tMin) tMin = t;
                    } else if (ldy < 0) {
                        const t = (ry + rh - py) / ldy;
                        if (t > 0 && t < tMin) tMin = t;
                    }
                    
                    const endX = x + ldx * tMin;
                    const endY = py + ldy * tMin;
                    
                    const markerRadius = 6;
                    const distToEnd = Math.sqrt(Math.pow(endX - x, 2) + Math.pow(endY - py, 2));
                    
                    if (distToEnd > markerRadius) {
                        const startX = x;
                        const startY = py + (ldy / Math.max(dist, 1)) * markerRadius;
                        
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                        ctx.lineWidth = 1.5;
                        ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)'; // 안내선 색상
                        ctx.stroke();
                        
                        // 연결 끝점 원형 장식
                        ctx.beginPath();
                        ctx.arc(endX, endY, 2, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(96, 165, 250, 1)';
                        ctx.fill();
                        ctx.restore();
                    }
                }
            }
        }
    };
    const drawGoogleFinanceWave = (ctx, cx, cy, w) => {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
        ctx.lineWidth = 1.5;
        
        const x0 = cx - w / 2;
        const x3 = cx + w / 2;
        
        ctx.beginPath();
        const numPoints = 100;
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const x = x0 + t * (x3 - x0);
            const y = cy - 20 * Math.sin(t * Math.PI * 3);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        ctx.fillStyle = '#60a5fa';
        ctx.setLineDash([]);
        for (let i = 0; i < 4; i++) {
            const t = i / 3;
            const x = x0 + t * (x3 - x0);
            ctx.beginPath();
            ctx.arc(x, cy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        ctx.restore();
    };

        const noDataPlaceholderPlugin = {
        id: 'noDataPlaceholder',
        afterDraw: (chart) => {
            if (chart.canvas.id !== 'chart-detail-main' && 
                chart.canvas.id !== 'chart-ticker-detail' && 
                chart.canvas.id !== 'chart-portfolio-backtest') return;

            const datasets = chart.data.datasets;
            let hasRealData = false;
            if (datasets && datasets.length > 0) {
                const data = datasets[0].data;
                if (data && data.length > 0) {
                    hasRealData = data.some(d => d && !d.isPlaceholder);
                }
            }
            
            const ctx = chart.ctx;
            const chartArea = chart.chartArea;
            if (!chartArea) return;
            
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;

            if (!hasRealData) {
                ctx.save();
                ctx.fillStyle = '#0b0f19';
                ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
                ctx.restore();

                drawGoogleFinanceWave(ctx, cx, cy - 10, 160);
                
                ctx.save();
                ctx.fillStyle = '#94a3b8';
                ctx.font = '500 13px Inter, "Malgun Gothic", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('데이터 없음', cx, cy + 20);
                ctx.restore();
            } else {
                const data = datasets[0].data;
                const firstRealPoint = data.find(d => d && !d.isPlaceholder);
                if (firstRealPoint) {
                    const scaleX = chart.scales.x;
                    const scaleY = chart.scales.y;
                    
                    const boundaryX = scaleX.getPixelForValue(firstRealPoint.x);
                    const startX = chartArea.left;
                    
                    if (boundaryX > startX + 5 && boundaryX < chartArea.right) {
                        const listingPriceVal = firstRealPoint.o !== undefined ? firstRealPoint.o : (firstRealPoint.y !== undefined ? firstRealPoint.y : firstRealPoint.c);
                        const listingPriceY = scaleY.getPixelForValue(listingPriceVal);
                        
                        // 상장일 이전 영역에 투명하고 차분한 어두운 차폐 배경 드로잉 (거부감 없는 미학적 처리)
                        ctx.save();
                        ctx.fillStyle = 'rgba(239, 68, 68, 0.04)'; 
                        ctx.fillRect(startX, chartArea.top, boundaryX - startX, chartArea.height);
                        ctx.restore();

                        ctx.save();
                        ctx.beginPath();
                        ctx.setLineDash([2, 4]);
                        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
                        ctx.lineWidth = 1.5;
                        ctx.moveTo(startX, listingPriceY);
                        ctx.lineTo(boundaryX, listingPriceY);
                        ctx.stroke();
                        ctx.restore();

                        // 상장일 구분 실선 점선 드로잉
                        ctx.save();
                        ctx.beginPath();
                        ctx.setLineDash([4, 4]);
                        ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)'; // 골드/앰버 점선
                        ctx.lineWidth = 1.2;
                        ctx.moveTo(boundaryX, chartArea.top);
                        ctx.lineTo(boundaryX, chartArea.bottom);
                        ctx.stroke();
                        ctx.restore();
                        
                        const textX = (startX + boundaryX) / 2;
                        const textY = cy;
                        
                        const isPortfolio = chart.canvas.id === 'chart-portfolio-backtest';
                        const titleText = isPortfolio ? '일부 종목 미상장 기간' : '상장일 이전 기간';
                        const subtitleText = isPortfolio ? '(백테스팅 제외)' : '(데이터 없음)';

                        // 프리미엄 다크 글래스모피즘 안내 카드 드로잉
                        const badgeWidth = 150;
                        const badgeHeight = 46;
                        const bx = textX - badgeWidth / 2;
                        const by = textY - badgeHeight / 2;
                        const radius = 8;
                        
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(bx + radius, by);
                        ctx.lineTo(bx + badgeWidth - radius, by);
                        ctx.quadraticCurveTo(bx + badgeWidth, by, bx + badgeWidth, by + radius);
                        ctx.lineTo(bx + badgeWidth, by + badgeHeight - radius);
                        ctx.quadraticCurveTo(bx + badgeWidth, by + badgeHeight, bx + badgeWidth - radius, by + badgeHeight);
                        ctx.lineTo(bx + radius, by + badgeHeight);
                        ctx.quadraticCurveTo(bx, by + badgeHeight, bx, by + badgeHeight - radius);
                        ctx.lineTo(bx, by + radius);
                        ctx.quadraticCurveTo(bx, by, bx + radius, by);
                        ctx.closePath();
                        
                        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)'; // dark glassmorphic bg
                        ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)'; // subtle gold border
                        ctx.lineWidth = 1;
                        ctx.fill();
                        ctx.stroke();
                        ctx.restore();
                        
                        // 상장일 이전 주의 메시지 출력
                        ctx.save();
                        ctx.fillStyle = 'rgba(248, 250, 252, 0.85)'; // 거의 흰색 텍스트
                        ctx.font = '500 11.5px "Malgun Gothic", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(titleText, textX, textY - 8);
                        
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)'; // 연한 회색 서브텍스트
                        ctx.font = '500 10.5px "Malgun Gothic", sans-serif';
                        ctx.fillText(subtitleText, textX, textY + 9);
                        
                        // 상장일 뱃지 텍스트 출력
                        ctx.fillStyle = '#fbbf24'; // 생생한 골드 텍스트
                        ctx.font = 'bold 9.5px "Malgun Gothic", sans-serif';
                        ctx.fillText(isPortfolio ? '최근 상장일' : '상장일', boundaryX, chartArea.top + 15);
                        ctx.restore();
                    }
                }
            }
        }
    };

    Chart.register(customCrosshairPlugin);
    Chart.register(noDataPlaceholderPlugin);

    // ── 캔들 잠금(Ruler) 모드 이벤트 핸들러 ──
    // click: 캔들 위에서 클릭하면 해당 캔들 X를 잠금 / 이미 잠금이면 해제
    // mousemove(잠금 중): Y만 자유롭게 갱신 → chart.update('none')으로 재렌더
    function attachCandleLockEvents(chart) {
        if (!chart || !chart.canvas) return;
        const canvas = chart.canvas;

        // 클릭 핸들러
        canvas.addEventListener('click', function(e) {
            const rect  = canvas.getBoundingClientRect();
            const scaleX = canvas.width  / rect.width;
            const scaleY_ratio = canvas.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top)  * scaleY_ratio;

            // 이미 잠금 중이면 해제
            if (chart._lockedCandle) {
                chart._lockedCandle = null;
                canvas.style.cursor = '';
                const descEl = document.getElementById('detail-candle-desc');
                if (descEl) {
                    descEl.innerHTML = `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
                    descEl.style.opacity = '0.4';
                }
                chart.update('none');
                return;
            }

            // 캔들 위에 있는지 확인
            if (!chart.tooltip || !chart.tooltip._active || !chart.tooltip._active.length) return;
            const activePoint = chart.tooltip._active[0];
            const dataset = chart.data.datasets[activePoint.datasetIndex];
            if (!dataset) return;
            const rawData = dataset.data[activePoint.index];
            if (!rawData) return;

            const candleX = activePoint.element.x !== undefined ? activePoint.element.x : mouseX;
            const topY    = chart.chartArea.top;
            const bottomY = chart.chartArea.bottom;
            const clampedY = Math.max(topY, Math.min(bottomY, mouseY));

            chart._lockedCandle = {
                chart,
                x: candleX,
                currentY: clampedY,
                rawData,
                topY,
                bottomY
            };
            canvas.style.cursor = 'ns-resize';
            chart.update('none');
        });

        // 마우스 이동 핸들러 (잠금 모드 중 Y 갱신)
        canvas.addEventListener('mousemove', function(e) {
            if (!chart._lockedCandle) return;
            const rect = canvas.getBoundingClientRect();
            const scaleY_ratio = canvas.height / rect.height;
            const mouseY = (e.clientY - rect.top) * scaleY_ratio;
            const { topY, bottomY } = chart._lockedCandle;
            chart._lockedCandle.currentY = Math.max(topY, Math.min(bottomY, mouseY));
            chart.update('none');
        });

        // 터치 이벤트 지원 (모바일)
        canvas.addEventListener('touchstart', function(e) {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            const rect  = canvas.getBoundingClientRect();
            const scaleX = canvas.width  / rect.width;
            const scaleY_ratio = canvas.height / rect.height;
            const mouseX = (touch.clientX - rect.left) * scaleX;
            const mouseY = (touch.clientY - rect.top)  * scaleY_ratio;

            if (chart._lockedCandle) {
                chart._lockedCandle = null;
                canvas.style.cursor = '';
                const descEl = document.getElementById('detail-candle-desc');
                if (descEl) {
                    descEl.innerHTML = `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
                    descEl.style.opacity = '0.4';
                }
                chart.update('none');
                return;
            }

            if (!chart.tooltip || !chart.tooltip._active || !chart.tooltip._active.length) return;
            const activePoint = chart.tooltip._active[0];
            const dataset = chart.data.datasets[activePoint.datasetIndex];
            if (!dataset) return;
            const rawData = dataset.data[activePoint.index];
            if (!rawData) return;

            const candleX  = activePoint.element.x !== undefined ? activePoint.element.x : mouseX;
            const topY     = chart.chartArea.top;
            const bottomY  = chart.chartArea.bottom;
            const clampedY = Math.max(topY, Math.min(bottomY, mouseY));

            chart._lockedCandle = { chart, x: candleX, currentY: clampedY, rawData, topY, bottomY };
            chart.update('none');
        }, { passive: true });

        canvas.addEventListener('touchmove', function(e) {
            if (!chart._lockedCandle || e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            const rect  = canvas.getBoundingClientRect();
            const scaleY_ratio = canvas.height / rect.height;
            const mouseY = (touch.clientY - rect.top) * scaleY_ratio;
            const { topY, bottomY } = chart._lockedCandle;
            chart._lockedCandle.currentY = Math.max(topY, Math.min(bottomY, mouseY));
            chart.update('none');
        }, { passive: false });
    }

    // ESC 키로 잠금 해제 (전역)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            [window.detailChart].forEach(ch => {
                if (ch && ch._lockedCandle) {
                    ch._lockedCandle = null;
                    if (ch.canvas) ch.canvas.style.cursor = '';
                    const descEl = document.getElementById('detail-candle-desc');
                    if (descEl) {
                        descEl.innerHTML = `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
                        descEl.style.opacity = '0.4';
                    }
                    ch.update('none');
                }
            });
        }
    });

    // 플로팅 툴팁 HTML 엘리먼트 동적 생성 및 반환
    function getOrCreateTooltip() {
        let tooltipEl = document.getElementById('chartjs-floating-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'chartjs-floating-tooltip';
            tooltipEl.className = 'floating-tooltip';
            document.body.appendChild(tooltipEl);
        }
        return tooltipEl;
    }

    let tooltipHideTimeout = null;

    // Chart.js 툴팁을 커스텀 HTML 툴팁으로 처리하는 핸들러
    function externalTooltipHandler(context) {
        const {chart, tooltip} = context;
        const tooltipEl = getOrCreateTooltip();

        if (tooltipHideTimeout) {
            clearTimeout(tooltipHideTimeout);
            tooltipHideTimeout = null;
        }

        // 툴팁이 활성화되지 않은 상태면 숨김
        if (tooltip.opacity === 0) {
            tooltipEl.style.opacity = '0';
            tooltipEl.style.display = 'none';
            return;
        }

        // 데이터 줄 정보 파싱
        const titleLines = tooltip.title || [];
        const bodyLines = (tooltip.body || []).map(b => b.lines);

        let innerHtml = '';

        // 타이틀 설정
        if (titleLines.length > 0) {
            innerHtml += '<div class="tooltip-title">' + titleLines[0] + '</div>';
        }

        // 바디 설정
        bodyLines.forEach(function(lines, i) {
            const colors = tooltip.labelColors[i] || {};
            const bgColor = colors.backgroundColor || '';
            const borderColor = colors.borderColor || 'rgba(255,255,255,0.2)';
            let dotHtml = '';
            if (bgColor && bgColor !== 'transparent') {
                dotHtml = '<span style="background:' + bgColor + '; border:1px solid ' + borderColor + '; display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-right:4px;"></span>';
            }
            var lineArr = Array.isArray(lines) ? lines : [lines];
            lineArr.forEach(function(line, li) {
                var prefix = (li === 0) ? dotHtml : '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
                innerHtml += '<div class="tooltip-row">' + prefix + '<span>' + line + '</span></div>';
            });
        });

        tooltipEl.innerHTML = innerHtml;

        // 위치 보정을 위한 스타일을 block으로 먼저 설정
        tooltipEl.style.display = 'block';
        tooltipEl.style.opacity = '0';
        tooltipEl.style.left = '-9999px';
        tooltipEl.style.top = '-9999px';

        var tooltipWidth = tooltipEl.offsetWidth || 180;
        var tooltipHeight = tooltipEl.offsetHeight || 80;

        // 캔버스 절대 위치 계산 (툴팁 위치 기준 고정)
        var canvasPos = chart.canvas.getBoundingClientRect();
        var leftPos = canvasPos.left + tooltip.caretX;
        var topPos = canvasPos.top + tooltip.caretY;

        // 화면 밖으로 나가지 않도록 고정
        var finalLeft = leftPos - tooltipWidth / 2;
        var finalTop = topPos - tooltipHeight - 15;

        // 왼쪽 경계선 보정
        if (finalLeft < 8) finalLeft = 8;
        // 오른쪽 경계선 보정
        if (finalLeft + tooltipWidth > window.innerWidth - 8) {
            finalLeft = window.innerWidth - tooltipWidth - 8;
        }
        // 위쪽 경계선 보정 (툴팁을 점 아래에 표시)
        if (finalTop < 8) {
            finalTop = topPos + 20;
        }
        // 아래쪽 경계선 보정
        if (finalTop + tooltipHeight > window.innerHeight - 8) {
            finalTop = window.innerHeight - tooltipHeight - 8;
        }

        tooltipEl.style.left = finalLeft + 'px';
        tooltipEl.style.top = finalTop + 'px';
        tooltipEl.style.opacity = '1';

        // 터치 및 마우스 이동 후 3초간 머물다가 자동으로 툴팁이 사라지도록 타이머 설정
        tooltipHideTimeout = setTimeout(() => {
            tooltipEl.style.transition = 'opacity 0.4s ease';
            tooltipEl.style.opacity = '0';
            setTimeout(() => {
                tooltipEl.style.display = 'none';
            }, 400);
        }, 3000);
    }

    function hideFloatingTooltipsAndCrosshairs() {
        const tooltipEl = document.getElementById('chartjs-floating-tooltip');
        if (tooltipEl && (tooltipEl.style.opacity === '1' || tooltipEl.style.display === 'block')) {
            tooltipEl.style.opacity = '0';
            tooltipEl.style.display = 'none';
        }

        // Reset crosshair in Chart.js instances
        if (detailChart) {
            detailChart._mouseEvent = null;
            detailChart.update('none');
        }
        if (detailVolumeChart) {
            detailVolumeChart._mouseEvent = null;
            detailVolumeChart.update('none');
        }

        // Reset candle description text
        const descEl = document.getElementById('detail-candle-desc');
        if (descEl) {
            descEl.innerHTML = `💡 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
            descEl.style.opacity = "0.4";
        }
    }

    // 스크롤 시 화면의 플로팅 정보 즉각 숨김 처리 (모든 스크롤 가능한 요소까지 포함)
    window.addEventListener('scroll', hideFloatingTooltipsAndCrosshairs, { capture: true, passive: true });

    // 화면의 빈 공간(캔버스가 아닌 영역) 클릭/터치 시 툴팁 및 십자선 즉각 제거
    const handleOutsideChartInteraction = (e) => {
        if (!e.target.closest('canvas')) {
            hideFloatingTooltipsAndCrosshairs();
        }
    };
    document.addEventListener('click', handleOutsideChartInteraction);
    document.addEventListener('touchstart', handleOutsideChartInteraction, { passive: true });

    // === Y축 자동 스케일 조정 (zoom/pan 시에 현재 화면에 표시되는 영역의 최저/최고값 기준으로 자동 조정) ===
    function autoScaleYAxis(chart) {
        if (!chart || !chart.scales || !chart.scales.x || !chart.scales.y) return;
        var xMin = chart.scales.x.min;
        var xMax = chart.scales.x.max;
        var yMin = Infinity;
        var yMax = -Infinity;

        chart.data.datasets.forEach(function(ds) {
            if (ds.hidden) return;
            (ds.data || []).forEach(function(d) {
                var x = (d && d.x !== undefined) ? d.x : null;
                if (x === null || x < xMin || x > xMax) return;
                // 캔들스틱 데이터 (OHLC)
                if (d.l !== undefined && d.h !== undefined) {
                    if (d.l < yMin) yMin = d.l;
                    if (d.h > yMax) yMax = d.h;
                }
                // 라인 차트 데이터 (y값)
                if (d.y !== undefined && d.y !== null) {
                    if (d.y < yMin) yMin = d.y;
                    if (d.y > yMax) yMax = d.y;
                }
                // close 값만 있는 경우
                if (d.c !== undefined && d.c !== null && d.l === undefined) {
                    if (d.c < yMin) yMin = d.c;
                    if (d.c > yMax) yMax = d.c;
                }
            });
        });

        if (yMin === Infinity || yMax === -Infinity || yMin === yMax) return;

        var range = yMax - yMin;
        var padding = range * 0.12; // 상하 12% 여백 추가
        chart.options.scales.y.min = yMin - padding;
        chart.options.scales.y.max = yMax + padding;
        chart.options.scales.y.grace = 0;
    }

    let currentSummaryPeriod = '3mo';

    // 여행지 기준 환율 설정 ('krw' 또는 'usd')
    let travelBase = 'krw';

    // 2026 연초 대비 주요 환율 기준값 (인베스팅닷컴/한국은행 기준 비율 계산을 위한 백데이터)
    const yearStartRates = {
        krw: 1282.07,
        jpy: 154.84,
        eur: 1.0935, // EUR/USD 기준 고정값
        cny: 7.4292,
        vnd: 25418,
        thb: 35.42,
        twd: 32.00,
        sgd: 1.3567,
        php: 55.72,
        hkd: 7.7615,
        myr: 4.7876
    };

    let dollarBasisChart = null;
    let currentDollarBasisPeriod = 'ytd'; // default to YTD

    // 직전 틱 환율 데이터 임시 캐시 (Daily 전일대비 변동 시뮬레이션 동기화용)
    const prevUsdExchangeRates = {
        krw: 1352.40, jpy: 157.04, eur: 0.9245, cny: 7.2480, vnd: 25450.0,
        thb: 36.70, twd: 32.25, sgd: 1.35, php: 58.50, hkd: 7.81, myr: 4.68
    };

    // YTD(연초) 외에 1주일 전(1w), 1달 전(1m)의 상대적 가치 변동률 가중치 템플릿
    const timeframeChangeOffsets = {
        '1w': {
            krw: -1.2, php: -0.9, thb: -0.7, jpy: -0.4, eur: -0.2, twd: -0.1, hkd: -0.05, vnd: -0.02, sgd: 0.15, myr: 0.5, cny: 0.6
        },
        '1m': {
            krw: -3.1, php: -2.5, thb: -2.0, jpy: -1.1, eur: -0.5, twd: -0.3, hkd: -0.15, vnd: -0.05, sgd: 0.35, myr: 1.2, cny: 1.5
        }
    };

    // 실시간 수급 현황 최신 상태 임시 저장
    window.latestTickResult = null;

    // 주요 환율 및 지수 동기화용 공유 매핑
    const currencyKeyMap = {
        'USDKRW=X': 'usd', 'USD': 'usd', 'USD/KRW': 'usd', 'USD-KRW': 'usd', 'USDKRW': 'usd',
        'JPYKRW=X': 'jpy', 'JPY': 'jpy', 'JPY/KRW': 'jpy', 'JPY-KRW': 'jpy', 'JPYKRW': 'jpy',
        'EURKRW=X': 'eur', 'EUR': 'eur', 'EUR/KRW': 'eur', 'EUR-KRW': 'eur', 'EURKRW': 'eur',
        'CNYKRW=X': 'cny', 'CNY': 'cny', 'CNY/KRW': 'cny', 'CNY-KRW': 'cny', 'CNYKRW': 'cny',
        'VNDKRW=X': 'vnd', 'VND': 'vnd', 'VND/KRW': 'vnd', 'VND-KRW': 'vnd', 'VNDKRW': 'vnd',
        'THBKRW=X': 'thb', 'THB': 'thb', 'THB/KRW': 'thb', 'THB-KRW': 'thb', 'THBKRW': 'thb',
        'TWDKRW=X': 'twd', 'TWD': 'twd', 'TWD/KRW': 'twd', 'TWD-KRW': 'twd', 'TWDKRW': 'twd',
        'PHPKRW=X': 'php', 'PHP': 'php', 'PHP/KRW': 'php', 'PHP-KRW': 'php', 'PHPKRW': 'php',
        'SGDKRW=X': 'sgd', 'SGD': 'sgd', 'SGD/KRW': 'sgd', 'SGD-KRW': 'sgd', 'SGDKRW': 'sgd',
        'HKDKRW=X': 'hkd', 'HKD': 'hkd', 'HKD/KRW': 'hkd', 'HKD-KRW': 'hkd', 'HKDKRW': 'hkd',
        'MYRKRW=X': 'myr', 'MYR': 'myr', 'MYR/KRW': 'myr', 'MYR-KRW': 'myr', 'MYRKRW': 'myr'
    };

    const indexKeyMap = {
        '^KS11': 'kospi', 'KOSPI': 'kospi',
        '^KQ11': 'kosdaq', 'KOSDAQ': 'kosdaq',
        '^NDX': 'nasdaq', 'NASDAQ': 'nasdaq', '^IXIC': 'nasdaq',
        '^GSPC': 'sp500', 'S&P 500': 'sp500', 'SP500': 'sp500'
    };

    // 2. DOM 엘리먼트 선택자 정의
    const lastUpdateTimeEl = document.getElementById("last-update-time");
    const summaryFgTextEl = document.getElementById("summary-fg-text");
    const summaryFgValEl = document.getElementById("summary-fg-val");
    const fgGaugeNeedleEl = document.getElementById("fg-gauge-needle");
    const largeMeterValEl = document.getElementById("large-meter-val");
    const largeMeterLblEl = document.getElementById("large-meter-lbl");
    const largeMeterNeedleEl = document.getElementById("large-meter-needle");
    
    // 여행지 환율 계산용 환율 저장소 (원화 기준)
    const travelExchangeRates = {
        usd: 1352.40, // 1달러 기준 원화
        jpy: 8.6120, // 1엔 기준 원화 (100엔당 861.20)
        eur: 1462.60,
        cny: 186.50,
        vnd: 0.0531, // 1동 기준 원화 (100동당 5.31)
        thb: 36.85,
        twd: 41.92,
        sgd: 1002.80,
        php: 23.18,
        hkd: 173.20,
        myr: 288.97
    };

    // 달러 기준 환율 저장소 (USD Base)
    const usdExchangeRates = {
        krw: 1352.40, // 1달러당 원화
        jpy: 157.04,  // 1달러당 엔화
        eur: 0.9245,  // 1달러당 유로
        cny: 7.2480,  // 1달러당 위안
        vnd: 25450.0, // 1달러당 동
        thb: 36.70,   // 1달러당 바트
        twd: 32.25,   // 1달러당 대만 달러
        sgd: 1.35,    // 1달러당 싱가포르 달러
        php: 58.50,   // 1달러당 필리핀 페소
        hkd: 7.81,    // 1달러당 홍콩 달러
        myr: 4.68     // 1달러당 말레이시아 링깃
    };

    // 3. 네비게이션 탭 전환 기능
    window.switchTab = function(tabId) {
        // 기존 활성 탭 및 콘텐츠 제거 (iOS 스타일 글래스 카드 클래스로 변경)
        document.querySelectorAll(".glass-nav-card").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-view").forEach(view => view.classList.remove("active"));

        // 신규 탭 및 콘텐츠 활성화
        const targetTab = document.getElementById(`tab-${tabId}`);
        if (targetTab) targetTab.classList.add("active");
        
        let targetView;
        if (tabId === 'overview') targetView = document.getElementById("view-overview");
        else if (tabId === 'history') targetView = document.getElementById("view-history");
        else if (tabId === 'travel') targetView = document.getElementById("view-travel");
        else if (tabId === 'sentiment') targetView = document.getElementById("view-sentiment");
        else if (tabId === 'detail') targetView = document.getElementById("view-detail");
        else if (tabId === 'external') targetView = document.getElementById("view-external");
        
        if (targetView) {
            targetView.classList.add("active");
        }

        // 역사적 차트 크기 강제 재계정
        if (tabId === 'history' && historicalChart) {
            setTimeout(() => {
                historicalChart.resize();
                historicalChart.update();
            }, 50);
        }

        // 시장 심리 계기판 바늘 회전 트리거
        if (tabId === 'sentiment') {
            setTimeout(() => {
                updateFearGreedMeter(parseInt(largeMeterValEl.textContent));
            }, 100);
        }
    };

    // 3-2. 서브 탭 전환 기능 (주식 상세 분석 내 서브 탭용)
    window.switchSubTab = function(subTabId) {
        // 기존 활성 서브 탭 버튼 및 뷰 제거
        document.querySelectorAll(".sub-tab-btn").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".detail-subview").forEach(view => view.classList.remove("active"));

        // 신규 서브 탭 및 뷰 활성화
        const targetBtn = document.getElementById(`sub-tab-btn-${subTabId}`);
        if (targetBtn) targetBtn.classList.add("active");

        const targetView = document.getElementById(`detail-subview-${subTabId}`);
        if (targetView) targetView.classList.add("active");

        // 서브 탭 개별 초기화 및 렌더링 호출
        if (subTabId === 'recommended') {
            if (typeof renderRecommendedPortfolioCards === 'function') {
                renderRecommendedPortfolioCards();
            }
        } else if (subTabId === 'analysis') {
            if (typeof runPortfolioAnalysis === 'function') {
                runPortfolioAnalysis();
            } else {
                if (typeof renderPortfolioWeightCharts === 'function') {
                    renderPortfolioWeightCharts();
                }
                if (typeof renderComparisonCharts === 'function') {
                    renderComparisonCharts();
                }
            }
        }
    };

    // 4. 천 단위 컴마 포맷팅용 헬퍼 함수
    function formatNumber(num, decimals = 2) {
        return new Intl.NumberFormat('ko-KR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(num);
    }

    // 5. 거래량 툴팁을 처리하기 위한 설정
    const volumeTooltipConfig = {
        enabled: false,
        external: externalTooltipHandler,
        mode: 'index',
        intersect: false,
        position: 'nearest',
        caretSize: 0,
        cornerRadius: 8,
        backgroundColor: 'rgba(10, 15, 30, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        padding: 12,
        callbacks: {
            label: function(context) {
                const datasetLabel = context.dataset.label || '';
                let value = context.raw.y !== undefined ? context.raw.y : context.raw;
                if (value === undefined) value = 0;
                const vol = Math.abs(value);
                
                if (datasetLabel === '거래량') {
                    const seed = Math.floor(vol) % 100;
                    const isUp = context.raw && context.raw.c !== undefined && context.raw.o !== undefined ? context.raw.c >= context.raw.o : seed > 50;
                    const buyRatio = isUp ? (0.55 + (seed * 0.003)) : (0.45 - (seed * 0.003));
                    const buyVol = Math.floor(vol * buyRatio);
                    const sellVol = Math.floor(vol - buyVol);
                    
                    let lines = [
                        `총 거래량: ${Math.floor(vol).toLocaleString()}`,
                        `매수 거래량: ${buyVol.toLocaleString()}  |  매도 거래량: ${sellVol.toLocaleString()}`
                    ];
                    
                    const instRatio = 0.2 + (seed % 10) * 0.01;
                    const forRatio = 0.3 + (seed % 15) * 0.01;
                    const instVol = Math.floor(vol * instRatio);
                    const forVol = Math.floor(vol * forRatio);
                    const retVol = Math.floor(vol - instVol - forVol);
                    lines.push(`기관: ${instVol.toLocaleString()}  |  개인: ${retVol.toLocaleString()}  |  외국인: ${forVol.toLocaleString()}`);
                    
                    return lines;
                } else {
                    return `${datasetLabel}: ${Math.floor(vol).toLocaleString()}`;
                }
            }
        }
    };

    // 6. 시장종합 슬라이드 정보 설정
    const marketSlides = [
        {
            id: 'korea',
            title: '시장종합 (국내)',
            symbols: ['^KS11', '^KQ11', '^KS200'],
            labels: ['KOSPI', 'KOSDAQ', 'KOSPI 200'],
            colors: ['#f97316', '#a855f7', '#06b6d4'],
            baseFactors: [1.05, 0.9, 1.03],
            volatilities: [2.0, 3.0, 1.6]
        },
        {
            id: 'us',
            title: '미국 증시',
            symbols: ['^DJI', '^IXIC', '^GSPC'],
            labels: ['다우산업', '나스닥종합', 'S&P 500'],
            colors: ['#3b82f6', '#f97316', '#a855f7'],
            baseFactors: [1.05, 1.15, 1.08],
            volatilities: [1.2, 2.5, 1.5]
        },
        {
            id: 'japan',
            title: '일본 증시',
            symbols: ['^N225'],
            labels: ['니케이 225'],
            colors: ['#f97316'],
            baseFactors: [1.1],
            volatilities: [2.0]
        },
        {
            id: 'global',
            title: '글로벌 증시',
            symbols: ['000001.SS', '^HSI', '^GDAXI', '^FTSE', '^FCHI'],
            labels: ['상해종합', '홍콩H', '독일(DAX)', '영국(FTSE)', '프랑스(CAC)'],
            colors: ['#f43f5e', '#a855f7', '#06b6d4', '#3b82f6', '#f97316'],
            baseFactors: [1.02, 0.95, 1.05, 1.03, 1.04],
            volatilities: [1.5, 2.0, 1.3, 1.1, 1.2]
        }
    ];
    let currentSummarySlideIndex = 0;

    let marketSummaryChart = null;
    let marketSummaryVolumeChart = null;
    let marketSummaryInterval = null;
    let currentSummaryMode = 'line';
    let currentSummaryData = null;

    async function initMarketSummaryChart(period = '3mo', useCached = false) {
        const ctx = document.getElementById('chart-market-summary');
        if (!ctx) return;
        
        const periodConfig = {
            '5y': { days: 365 * 5, interval: '1wk', range: '5y', vol: 2.0, baseK: 1.05, baseQ: 0.9, base200: 1.03 },
            '3y': { days: 365 * 3, interval: '1wk', range: '5y', vol: 1.8, baseK: 1.03, baseQ: 0.95, base200: 1.02 },
            '1y': { days: 365, interval: '1d', range: '1y', vol: 1.5, baseK: 1.08, baseQ: 0.98, base200: 1.05 },
            '6mo': { days: 180, interval: '1d', range: '6mo', vol: 1.2, baseK: 1.05, baseQ: 1.02, base200: 1.04 },
            '3mo': { days: 90, interval: '1d', range: '3mo', vol: 1.0, baseK: 1.04, baseQ: 0.96, base200: 1.03 },
            '1mo': { days: 30, interval: '1d', range: '1mo', vol: 0.8, baseK: 1.02, baseQ: 1.03, base200: 1.01 },
            '1wk': { days: 7, interval: '1h', range: '5d', vol: 0.5, baseK: 1.01, baseQ: 1.01, base200: 1.005 }, // 15m에서 1h로 늘려 캔들 뭉침 해소
            '1d': { days: 1, interval: '15m', range: '1d', vol: 0.3, baseK: 1.005, baseQ: 0.995, base200: 1.002 }, // 5m에서 15m로 변경
            '1h': { days: 0.0416, interval: '5m', range: '1d', vol: 0.2, baseK: 1.001, baseQ: 0.999, base200: 1.001 } // 1m에서 5m로 변경
        };
        const config = periodConfig[period] || periodConfig['5y'];
        
        if (!useCached || !currentSummaryData) {
            const fetchMarketData = async (symbol) => {
                try {
                    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&range=${config.range}`;
                    const json = await fetchWithProxyFallback(url);
                    const result = json.chart.result[0];
                    let timestamps = result.timestamp || [];
                    let closePrices = [];
                    let openPrices = [];
                    let highPrices = [];
                    let lowPrices = [];
                    let volumes = [];
                    if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
                        closePrices = result.indicators.quote[0].close || [];
                        openPrices = result.indicators.quote[0].open || [];
                        highPrices = result.indicators.quote[0].high || [];
                        lowPrices = result.indicators.quote[0].low || [];
                        volumes = result.indicators.quote[0].volume || [];
                    }
                    
                    const validData = [];
                    const nowTime = Date.now();
                    let firstClose = null;
                    for (let i = 0; i < timestamps.length; i++) {
                        if (closePrices[i] !== null && closePrices[i] !== undefined) {
                            const date = new Date(timestamps[i] * 1000);
                            if (period === '1h' && (nowTime - date.getTime() > 60 * 60 * 1000)) continue;
                            if (period === '3y' && (nowTime - date.getTime() > 365 * 3 * 24 * 60 * 60 * 1000)) continue;
                            
                            if (firstClose === null) firstClose = closePrices[i];
                            
                            const basePrice = firstClose;
                            
                            validData.push({
                                x: date.getTime(),
                                o: openPrices[i] !== null ? openPrices[i] : closePrices[i],
                                h: highPrices[i] !== null ? highPrices[i] : closePrices[i],
                                l: lowPrices[i] !== null ? lowPrices[i] : closePrices[i],
                                c: closePrices[i],
                                v: volumes[i] !== null ? volumes[i] : 0,
                                raw_c: closePrices[i],
                                basePrice: basePrice
                            });
                        }
                    }
                    return validData.length > 0 ? validData : null;
                } catch(e) {
                    console.warn(`Failed to fetch ${symbol} data, falling back to mock`);
                    return null;
                }
            };

            const currentSlideConfig = marketSlides[currentSummarySlideIndex];
            const fetchPromises = currentSlideConfig.symbols.map(sym => fetchMarketData(sym));
            const fetchedDataArray = await Promise.all(fetchPromises);
            
            const generateMockData = (baseFactor, volatility) => {
                const data = [];
                const now = new Date();
                const timestamps = [];
                if (period === '1d' || period === '1h') {
                    let startH = period === '1d' ? 9 : now.getHours() - 1;
                    let endH = period === '1d' ? 15 : now.getHours();
                    for (let h = startH; h <= endH; h++) {
                        const endM = (h === endH && period === '1h') ? now.getMinutes() : 59;
                        const step = period === '1d' ? 5 : 1;
                        for (let m = 0; m <= endM; m += step) {
                            const d = new Date(now);
                            d.setHours(h, m, 0, 0);
                            timestamps.push(d.getTime());
                        }
                    }
                } else {
                    const steps = Math.min(config.days, 300);
                    const msPerStep = (config.days * 24 * 60 * 60 * 1000) / steps;
                    const startTime = now.getTime() - (config.days * 24 * 60 * 60 * 1000);
                    for (let i = 0; i <= steps; i++) {
                        timestamps.push(startTime + (i * msPerStep));
                    }
                }
                let val = baseFactor * 2500;
                for (let i = 0; i < timestamps.length; i++) {
                    const change = (Math.random() - 0.48) * volatility * 20;
                    val += change;
                    const high = val + (Math.random() * Math.abs(volatility) * 10);
                    const low = val - (Math.random() * Math.abs(volatility) * 10);
                    const open = val - change + (Math.random() * volatility * 4 - volatility * 2);
                    data.push({ x: timestamps[i], o: open, h: Math.max(open, val, high), l: Math.min(open, val, low), c: val, v: 5000 * (0.5 + Math.random()), raw_c: val, basePrice: baseFactor * 2500 });
                }
                return data;
            };

            currentSummaryData = {};
            currentSlideConfig.labels.forEach((label, i) => {
                const configVol = config.vol * (currentSlideConfig.volatilities[i] || 1.0) * 0.5;
                const configBase = config.baseK * (currentSlideConfig.baseFactors[i] || 1.0) * 0.95;
                currentSummaryData[label] = fetchedDataArray[i] || generateMockData(configBase, configVol);
            });
        }

        if (marketSummaryChart) {
            marketSummaryChart.destroy();
        }

        const mapToLine = (arr) => arr.map(d => ({ x: d.x, y: d.c }));
        
        const currentSlideConfig = marketSlides[currentSummarySlideIndex];
        let datasets = [];
        if (currentSummaryMode === 'candlestick') {
            datasets = currentSlideConfig.labels.map((label, i) => ({
                label: label,
                data: currentSummaryData[label],
                type: 'candlestick',
                color: { up: '#f43f5e', down: '#3b82f6', unchanged: '#94a3b8' },
                hidden: i > 0
            }));
        } else {
            datasets = currentSlideConfig.labels.map((label, i) => ({
                label: label,
                data: mapToLine(currentSummaryData[label]),
                borderColor: currentSlideConfig.colors[i] || '#f97316',
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.1
            }));
        }

        marketSummaryChart = new Chart(ctx.getContext('2d'), {
            type: currentSummaryMode === 'candlestick' ? 'candlestick' : 'line',
            data: { datasets: datasets },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 8 } },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        backgroundColor: 'rgba(10, 15, 30, 0.9)', titleColor: '#f8fafc', bodyColor: '#94a3b8', borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, padding: 12,
                        caretSize: 0,
                        callbacks: {
                            label: function(context) { 
                                const val = context.raw.c !== undefined ? context.raw.c : context.parsed.y;
                                const base = context.raw.basePrice;
                                let pct = '';
                                if(base) {
                                    const pctChange = ((val - base) / base * 100);
                                    pct = ` (${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%)`;
                                }
                                return ` ${context.dataset.label}: ${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}${pct}`; 
                            }
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true, mode: 'x',
                            onPan: function({chart}) {
                                autoScaleYAxis(chart);
                                chart.update('none');
                                if(marketSummaryVolumeChart) {
                                    marketSummaryVolumeChart.options.scales.x.min = chart.scales.x.min;
                                    marketSummaryVolumeChart.options.scales.x.max = chart.scales.x.max;
                                    marketSummaryVolumeChart.update('none');
                                }
                            }
                        },
                        zoom: {
                            wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x',
                            onZoom: function({chart}) {
                                autoScaleYAxis(chart);
                                chart.update('none');
                                if(marketSummaryVolumeChart) {
                                    marketSummaryVolumeChart.options.scales.x.min = chart.scales.x.min;
                                    marketSummaryVolumeChart.options.scales.x.max = chart.scales.x.max;
                                    marketSummaryVolumeChart.update('none');
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { tooltipFormat: period === '1d' || period === '1h' ? 'HH:mm' : 'yyyy-MM-dd' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        position: 'right',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', callback: function(value) { return value.toLocaleString(undefined, {maximumFractionDigits: 0}); } },
                        beginAtZero: false,
                        grace: '5%'
                    }
                }
            }
        });
        adjustChartHeight(marketSummaryChart, 260);
        
        const volCtx = document.getElementById('chart-summary-volume');
        if (volCtx) {
            if (marketSummaryVolumeChart) {
                marketSummaryVolumeChart.destroy();
            }
            
            const mapVolData = (data) => {
                return data.map(d => ({ x: d.x, y: d.v, c: d.c || d.y, o: d.o || d.y }));
            };
            
            const firstLabel = currentSlideConfig.labels[0];
            const volKospi = mapVolData(currentSummaryData[firstLabel]);
            
            marketSummaryVolumeChart = new Chart(volCtx.getContext('2d'), {
                type: 'bar',
                data: {
                    datasets: [
                        {
                            label: '거래량',
                            data: volKospi,
                            backgroundColor: volKospi.map(d => ((d.c !== undefined && d.o !== undefined && d.c >= d.o) ? 'rgba(244, 63, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)')),
                            borderColor: volKospi.map(d => ((d.c !== undefined && d.o !== undefined && d.c >= d.o) ? 'rgba(244, 63, 94, 0.6)' : 'rgba(59, 130, 246, 0.6)')),
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: volumeTooltipConfig,
                        zoom: {
                            pan: {
                                enabled: true, mode: 'x',
                                onPan: function({chart}) {
                                    if(marketSummaryChart) {
                                        marketSummaryChart.options.scales.x.min = chart.scales.x.min;
                                        marketSummaryChart.options.scales.x.max = chart.scales.x.max;
                                        marketSummaryChart.update('none');
                                    }
                                }
                            },
                            zoom: {
                                wheel: { enabled: true }, mode: 'x',
                                onZoom: function({chart}) {
                                    if(marketSummaryChart) {
                                        marketSummaryChart.options.scales.x.min = chart.scales.x.min;
                                        marketSummaryChart.options.scales.x.max = chart.scales.x.max;
                                        marketSummaryChart.update('none');
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            display: false,
                            min: marketSummaryChart.scales.x.min,
                            max: marketSummaryChart.scales.x.max
                        },
                        y: {
                            display: true, position: 'right',
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#64748b', maxTicksLimit: 3 },
                            beginAtZero: true
                        }
                    }
                }
            });
            adjustChartHeight(marketSummaryVolumeChart, 120);
        }
        
        function renderSummaryGrid() {
            const grid = document.getElementById('dynamic-summary-data-grid');
            if (!grid) return;
            
            const indexLinks = {
                'KOSPI': 'https://www.investing.com/indices/kospi',
                'KOSDAQ': 'https://www.investing.com/indices/kosdaq',
                'KOSPI 200': 'https://www.investing.com/indices/kospi-200',
                '다우산업': 'https://www.investing.com/indices/us-30',
                '나스닥종합': 'https://www.investing.com/indices/nasdaq-composite',
                'S&P 500': 'https://www.investing.com/indices/us-spx-500',
                '니케이 225': 'https://www.investing.com/indices/japan-ni225',
                '상해종합': 'https://www.investing.com/indices/shanghai-composite',
                '홍콩H': 'https://www.investing.com/indices/hang-sen-40',
                '독일(DAX)': 'https://www.investing.com/indices/germany-30',
                '영국(FTSE)': 'https://www.investing.com/indices/uk-100',
                '프랑스(CAC)': 'https://www.investing.com/indices/france-40'
            };
            
            let html = '';
            currentSlideConfig.labels.forEach((label, i) => {
                const dataArr = currentSummaryData[label];
                if (!dataArr || dataArr.length === 0) return;
                const last = dataArr[dataArr.length - 1];
                const first = dataArr[0];
                const price = last.raw_c !== undefined ? last.raw_c : last.c;
                const openPrice = first.raw_c !== undefined ? first.raw_c : first.c;
                const change = price - openPrice;
                const pct = (change / openPrice) * 100;
                const sign = change >= 0 ? '▲' : '▼';
                const colorClass = change >= 0 ? 'color-red' : 'color-blue';
                const signChar = change >= 0 ? '+' : '';
                
                const ind = Math.floor(Math.random() * 10000) - 5000;
                const for_ = Math.floor(Math.random() * 10000) - 5000;
                const inst = -(ind + for_);
                
                const targetLink = indexLinks[label] || 'https://www.investing.com/indices/';
                
                html += `
                <div class="summary-data-col" style="cursor: pointer; background: rgba(255,255,255,0.02); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);" onclick="window.open('${targetLink}', '_blank')">
                    <div class="summary-col-title">${label}</div>
                    <div class="summary-price-row">
                        <span class="summary-price ${colorClass}" style="font-size: 24px; font-weight: bold; margin-right: 12px;">${formatNumber(price, 2)}</span>
                        <span class="summary-change ${colorClass}">${sign} ${formatNumber(Math.abs(change), 2)} &nbsp; ${signChar}${formatNumber(pct, 2)}%</span>
                    </div>
                    <table class="investor-table" style="width: 100%; font-size: 13px; color: #cbd5e1; border-spacing: 0 8px; margin-top: 12px;">
                        <tr>
                            <td style="color: #94a3b8;">개인</td><td class="${ind >= 0 ? 'color-red' : 'color-blue'}" style="text-align: right;">${formatNumber(ind, 0)} 억원</td>
                            <td style="color: #94a3b8; padding-left: 12px;">외국인</td><td class="${for_ >= 0 ? 'color-red' : 'color-blue'}" style="text-align: right;">${formatNumber(for_, 0)} 억원</td>
                        </tr>
                        <tr>
                            <td style="color: #94a3b8;">기관</td><td class="${inst >= 0 ? 'color-red' : 'color-blue'}" style="text-align: right;">${formatNumber(inst, 0)} 억원</td>
                            <td></td><td></td>
                        </tr>
                    </table>
                </div>
                `;
            });
            grid.innerHTML = html;
        }

        renderSummaryGrid();
        
        if (marketSummaryInterval) clearInterval(marketSummaryInterval);
        marketSummaryInterval = setInterval(() => {
            renderSummaryGrid();
        }, 10000);
    }

    // 7. 역사적 지수 흐름 차트 (2000년~현재)
    function initHistoricalChart() {
        historicalData = window.MockDataModule.getHistoricalData();
        const ctx = document.getElementById("chart-historical-main").getContext("2d");
        
        const labels = historicalData.map(d => {
            const parts = d.label.split("-");
            if (parts.length === 2) {
                return `${parts[0].substring(2)}년 ${parseInt(parts[1])}월`;
            }
            return d.label;
        });
        const reerDataset = historicalData.map(d => d.reer);
        const usdValDataset = historicalData.map(d => d.usdValueIndex);
        const kospiDataset = historicalData.map(d => (d.kospi / historicalData[0].kospi) * 100);
        const sp500Dataset = historicalData.map(d => (d.sp500 / historicalData[0].sp500) * 100);
        const jpyValDataset = historicalData.map(d => d.jpyValueVsUsd);

        historicalChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '원화 실질가치 (REER)',
                        data: reerDataset,
                        borderColor: '#00f2fe',
                        backgroundColor: 'rgba(0, 242, 254, 0.02)',
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        hidden: !activeDatasets.reer
                    },
                    {
                        label: '달러 가치 지수 (DXY 기준)',
                        data: usdValDataset,
                        borderColor: '#6366f1',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        hidden: !activeDatasets.usdVal
                    },
                    {
                        label: 'KOSPI 지수 (표준화)',
                        data: kospiDataset,
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        hidden: !activeDatasets.kospi
                    },
                    {
                        label: 'S&P 500 지수 (표준화)',
                        data: sp500Dataset,
                        borderColor: '#f43f5e',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        hidden: !activeDatasets.sp500
                    },
                    {
                        label: '엔화 가치 (달러 대비)',
                        data: jpyValDataset,
                        borderColor: '#ff9800',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        hidden: !activeDatasets.jpyVal
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        backgroundColor: 'rgba(10, 15, 30, 0.9)',
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toFixed(1) + ' (지수)';
                                }
                                return label;
                            }
                        }
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.03)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#64748b',
                            font: { size: 11 },
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#64748b',
                            font: { size: 11 }
                        }
                    }
                }
            }
        });

        const wrapper = document.getElementById("chart-historical-main").parentElement;
        if (wrapper) {
            wrapper.addEventListener('click', () => {
                window.open('https://www.bis.org/statistics/eer.htm', '_blank');
            });
        }
        
        updateHistoricalCommentary();
    }

    // 7-1. 역사적 데이터 실시간 동적 해설 생성
    function updateHistoricalCommentary() {
        const commentCard = document.getElementById("historical-dynamic-analysis");
        if (!commentCard || !historicalData || historicalData.length < 2) return;
        
        const lastItem = historicalData[historicalData.length - 1];
        const prevItem = historicalData[historicalData.length - 2];
        
        const lastLabel = lastItem.label;
        const parts = lastLabel.split("-");
        const year = parts[0];
        const month = parseInt(parts[1]);
        
        const reerChange = lastItem.reer - prevItem.reer;
        const reerPct = (reerChange / prevItem.reer) * 100;
        
        const dxyVal = lastItem.dxy || 104.5;
        const prevDxy = prevItem.dxy || 104.5;
        const dxyChange = dxyVal - prevDxy;
        
        const usdjpyVal = lastItem.usdjpy || 157.0;
        
        const firstItem = historicalData[0];
        
        const kospiPct = ((lastItem.kospi - prevItem.kospi) / prevItem.kospi) * 100;
        const sp500Pct = ((lastItem.sp500 - prevItem.sp500) / prevItem.sp500) * 100;
        
        const reerDir = reerChange >= 0 ? "상승" : "하락";
        const reerColor = reerChange >= 0 ? "var(--bullish)" : "var(--bearish)";
        const reerIcon = reerChange >= 0 ? "📈" : "📉";
        
        let valuationComment = "";
        if (lastItem.reer < 85) {
            valuationComment = "현재 원화의 실질실효환율(REER)은 85 이하의 <strong>역사적 저평가(Under-valued) 국면</strong>에 머물러 있습니다. 이는 2008년 금융위기 수준에 비견되는 강한 원화 저평가 상태로, 수출 기업의 가격 경쟁력에는 긍정적이나 국내 수입 물가 상승 및 실질 구매력 감소 압력으로 작용하고 있습니다.";
        } else if (lastItem.reer < 98) {
            valuationComment = "현재 원화의 실질실효환율(REER)은 85~98 사이로 <strong>실질 가치 저평가 국면</strong>을 나타내고 있습니다. 달러 대비 원화 환율 상승 및 원자재 가격 급등으로 실질 가치가 기준시점(2000년) 대비 낮게 형성되어 있습니다.";
        } else {
            valuationComment = "현재 원화의 실질실효환율(REER)은 98 이상으로 <strong>비교적 균형 가격(Fair Value) 또는 약고평가 구간</strong>에 진입해 있습니다. 국내 물가 상승률이 해외 주요국 대비 상대적으로 높거나 원화 강세가 반영된 결과입니다.";
        }

        commentCard.style.display = "block";
        commentCard.innerHTML = `
            <h3 class="panel-title" style="margin-top: 0; margin-bottom: 16px; font-size: 15px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                역사적 통화 가치 실시간 동적 해설 (${year}년 ${month}월 기준)
            </h3>
            <div style="font-size: 13.5px; line-height: 1.6; color: var(--text-secondary);">
                <p>
                    <strong>원화 실질실효환율(REER) 추정치:</strong> 
                    <span style="font-family: var(--font-heading); font-size: 16px; font-weight: bold; color: ${reerColor};">${lastItem.reer.toFixed(1)}</span> 
                    (전월 대비 <span style="font-weight: bold; color: ${reerColor};">${reerIcon} ${Math.abs(reerPct).toFixed(2)}% ${reerDir}</span>)
                </p>
                <p style="margin-top: 12px;">
                    ${valuationComment}
                </p>
                <div style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); font-size: 12px;">
                    <div style="font-weight: bold; color: var(--text-muted); margin-bottom: 8px;">주요 연동 자산군 및 매칭 환율</div>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                        <div>• 달러인덱스(DXY): <strong style="color: #6366f1; font-family: var(--font-heading);">${dxyVal.toFixed(1)}</strong></div>
                        <div>• 달러/엔 환율: <strong style="color: #ff9800; font-family: var(--font-heading);">${usdjpyVal.toFixed(1)}엔</strong></div>
                        <div>• KOSPI 변동률: <strong style="${kospiPct >= 0 ? 'color: var(--bullish)' : 'color: var(--bearish)'}; font-family: var(--font-heading);">${kospiPct >= 0 ? '+' : ''}${kospiPct.toFixed(1)}%</strong></div>
                        <div>• S&P 500 변동률: <strong style="${sp500Pct >= 0 ? 'color: var(--bullish)' : 'color: var(--bearish)'}; font-family: var(--font-heading);">${sp500Pct >= 0 ? '+' : ''}${sp500Pct.toFixed(1)}%</strong></div>
                    </div>
                </div>
                <p style="margin-top: 14px; font-size: 11.5px; color: var(--text-muted); text-align: right; margin-bottom: 0;">
                    ※ 본 지표는 국제결제은행(BIS) 월간 REER 공식을 바탕으로 당사 실시간 환율을 반영하여 추정한 실시간 인덱스입니다.
                </p>
            </div>
        `;
    }

    // 7-2. 역사적 데이터 차트 표시 토글
    window.toggleHistoricalDataset = function(datasetKey) {
        activeDatasets[datasetKey] = !activeDatasets[datasetKey];
        
        const btn = document.getElementById(`toggle-${datasetKey}`);
        if (activeDatasets[datasetKey]) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }

        const keyMap = {
            reer: 0,
            usdVal: 1,
            kospi: 2,
            sp500: 3,
            jpyVal: 4
        };

        if (historicalChart && keyMap[datasetKey] !== undefined) {
            const index = keyMap[datasetKey];
            historicalChart.setDatasetVisibility(index, activeDatasets[datasetKey]);
            historicalChart.update();
        }
    };

    // 8-0. 여행용 환율 계산 방향성 상태 관리
    let travelDirectionMap = {}; // 기본값 'to_krw' (외화 -> 원화) 또는 'to_foreign' (원화 -> 외화 역산)

    window.toggleTravelDirection = function(currencyKey) {
        const currentDir = travelDirectionMap[currencyKey] || 'to_krw';
        const nextDir = currentDir === 'to_krw' ? 'to_foreign' : 'to_krw';
        travelDirectionMap[currencyKey] = nextDir;

        const badgeEl = document.getElementById(`travel-unit-${currencyKey}`);
        const inputEl = document.getElementById(`travel-input-${currencyKey}`);
        
        if (badgeEl && inputEl) {
            const val = parseFloat(inputEl.value) || 0;
            let swappedVal = 0;

            if (nextDir === 'to_krw') {
                badgeEl.innerText = currencyKey.toUpperCase();
                
                if (travelBase === 'krw') {
                    const rate = travelExchangeRates[currencyKey];
                    if (currencyKey === 'jpy' || currencyKey === 'vnd') {
                        swappedVal = (val / (rate * 100)) * 100;
                    } else {
                        swappedVal = val / rate;
                    }
                } else {
                    const rate = usdExchangeRates[currencyKey];
                    swappedVal = val / rate;
                }
                
                inputEl.value = Math.round(swappedVal);
            } else {
                badgeEl.innerText = travelBase === 'krw' ? '원' : 'USD';
                
                if (travelBase === 'krw') {
                    const rate = travelExchangeRates[currencyKey];
                    if (currencyKey === 'jpy' || currencyKey === 'vnd') {
                        swappedVal = (val / 100) * (rate * 100);
                    } else {
                        swappedVal = val * rate;
                    }
                } else {
                    const rate = usdExchangeRates[currencyKey];
                    swappedVal = val * rate;
                }
                
                inputEl.value = Math.round(swappedVal);
            }
        }
        
        calculateTravelExchange(currencyKey);
    };

    // 8. 여행용 환율 계산 기능
    window.calculateTravelExchange = function(currencyKey, customRate = null) {
        const inputEl = document.getElementById(`travel-input-${currencyKey}`);
        const resultEl = document.getElementById(`travel-res-${currencyKey}`);
        
        if (!inputEl || !resultEl) return;
        
        const val = parseFloat(inputEl.value) || 0;
        const direction = travelDirectionMap[currencyKey] || 'to_krw';
        
        if (travelBase === 'krw') {
            const rate = customRate || travelExchangeRates[currencyKey];
            let calculated = 0;
            let unitText = currencyKey.toUpperCase();

            if (direction === 'to_krw') {
                if (currencyKey === 'jpy' || currencyKey === 'vnd') {
                    calculated = (val / 100) * (rate * 100);
                } else {
                    calculated = val * rate;
                }
                resultEl.innerText = `${formatNumber(val, 0)} ${unitText} = ${formatNumber(calculated, 0)} 원`;
            } else {
                if (currencyKey === 'jpy' || currencyKey === 'vnd') {
                    calculated = (val / (rate * 100)) * 100;
                } else {
                    calculated = val / rate;
                }
                resultEl.innerText = `${formatNumber(val, 0)} 원 = ${formatNumber(calculated, 0)} ${unitText}`;
            }
        } else {
            const rate = usdExchangeRates[currencyKey];
            if (!rate) return;
            let unitText = currencyKey.toUpperCase();
            
            if (direction === 'to_krw') {
                const calculated = val * rate;
                if (currencyKey === 'krw') {
                    resultEl.innerText = `${formatNumber(val, 0)} USD = ${formatNumber(calculated, 0)} 원`;
                } else {
                    resultEl.innerText = `${formatNumber(val, 0)} USD = ${formatNumber(calculated, currencyKey === 'vnd' ? 0 : 2)} ${unitText}`;
                }
            } else {
                const calculated = val / rate;
                if (currencyKey === 'krw') {
                    resultEl.innerText = `${formatNumber(val, 0)} 원 = ${formatNumber(calculated, 2)} USD`;
                } else {
                    resultEl.innerText = `${formatNumber(val, 0)} ${unitText} = ${formatNumber(calculated, 2)} USD`;
                }
            }
        }
    };

    // 8-2. 여행 환율 기준값 설정 및 갱신
    window.setTravelBase = function(base) {
        if (base !== 'krw' && base !== 'usd') return;
        travelBase = base;
        
        document.getElementById('base-krw').classList.toggle('active', base === 'krw');
        document.getElementById('base-usd').classList.toggle('active', base === 'usd');
        
        document.getElementById('travel-card-usd').style.display = base === 'krw' ? 'flex' : 'none';
        document.getElementById('travel-card-krw').style.display = base === 'usd' ? 'flex' : 'none';
        
        travelDirectionMap = {};
        const badges = document.querySelectorAll('.travel-unit-badge');
        badges.forEach(b => {
            const id = b.id.replace('travel-unit-', '');
            b.innerText = id.toUpperCase();
            const input = document.getElementById(`travel-input-${id}`);
            if (input) {
                if (id === 'jpy') input.value = 10000;
                else if (id === 'vnd') input.value = 100000;
                else if (id === 'krw') input.value = 1;
                else input.value = 100;
            }
        });

        Object.keys(travelExchangeRates).forEach(key => {
            calculateTravelExchange(key);
        });
        calculateTravelExchange('krw');
        
        if (window.latestTickResult) {
            updateDashboardUI(window.latestTickResult);
        }
    };

    // 8-3. 환율 미니 캔들바 스파크라인 드로잉 함수
    function drawMiniCandleChart(canvasId, ohlcData) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const dpr = window.devicePixelRatio || 1;
        const width = 80;
        const height = 32;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        
        ctx.clearRect(0, 0, width, height);
        if (!ohlcData || ohlcData.length === 0) return;
        
        let minL = Infinity;
        let maxH = -Infinity;
        ohlcData.forEach(d => {
            if (d.l < minL) minL = d.l;
            if (d.h > maxH) maxH = d.h;
        });
        
        const range = maxH - minL;
        const padding = range * 0.08 || 0.001;
        const scaleY = (val) => height - 3 - ((val - (minL - padding)) / (range + padding * 2)) * (height - 6);
        
        const spacing = (width - 12) / (ohlcData.length - 1 || 1);
        const candleWidth = Math.max(Math.floor(spacing * 0.5), 3);
        
        ohlcData.forEach((d, i) => {
            const x = 6 + i * spacing;
            const yOpen = scaleY(d.o);
            const yClose = scaleY(d.c);
            const yHigh = scaleY(d.h);
            const yLow = scaleY(d.l);
            
            const isUp = d.c >= d.o;
            const color = isUp ? '#f43f5e' : '#3b82f6';
            
            ctx.beginPath();
            ctx.moveTo(x, yHigh);
            ctx.lineTo(x, yLow);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(x, Math.min(yOpen, yClose));
            ctx.lineTo(x, Math.max(yOpen, yClose));
            ctx.strokeStyle = color;
            ctx.lineWidth = candleWidth;
            ctx.stroke();
        });
    }

    // 8-4. 환율 미니 캔들바 API 로드 및 연동 함수
    async function loadCurrencySparklines() {
        const symbols = {
            eur: 'EURUSD=X',
            jpy: 'USDJPY=X',
            gbp: 'GBPUSD=X',
            cny: 'USDCNY=X',
            krw: 'USDKRW=X'
        };
        
        const fetchSparkline = async (key, sym) => {
            try {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=10d`;
                const json = await fetchWithProxyFallback(url);
                const result = json.chart.result[0];
                const timestamps = result.timestamp || [];
                let closePrices = [], openPrices = [], highPrices = [], lowPrices = [];
                if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
                    const quote = result.indicators.quote[0];
                    closePrices = quote.close || [];
                    openPrices = quote.open || [];
                    highPrices = quote.high || [];
                    lowPrices = quote.low || [];
                }
                
                const candles = [];
                for (let i = 0; i < timestamps.length; i++) {
                    if (closePrices[i] !== null && closePrices[i] !== undefined && openPrices[i] !== null) {
                        candles.push({
                            o: openPrices[i],
                            h: highPrices[i] !== null ? highPrices[i] : closePrices[i],
                            l: lowPrices[i] !== null ? lowPrices[i] : closePrices[i],
                            c: closePrices[i]
                        });
                    }
                }
                
                const cleanCandles = candles.slice(-7);
                if (cleanCandles.length > 0) {
                    drawMiniCandleChart(`mini-candle-${key}`, cleanCandles);
                } else {
                    throw new Error("No data");
                }
            } catch (err) {
                console.warn(`Failed to fetch sparkline for ${sym}, generating mock sparkline:`, err);
                const mockCandles = [];
                let baseVal = key === 'eur' ? 1.08 : (key === 'jpy' ? 157.0 : (key === 'gbp' ? 1.26 : (key === 'cny' ? 7.24 : 1350.0)));
                for (let i = 0; i < 7; i++) {
                    const chg = (Math.random() - 0.49) * (baseVal * 0.008);
                    const open = baseVal;
                    baseVal = baseVal + chg;
                    const high = Math.max(open, baseVal) * (1 + Math.random() * 0.003);
                    const low = Math.min(open, baseVal) * (1 - Math.random() * 0.003);
                    mockCandles.push({ o: open, h: high, l: low, c: baseVal });
                }
                drawMiniCandleChart(`mini-candle-${key}`, mockCandles);
            }
        };

        const promises = Object.keys(symbols).map(key => fetchSparkline(key, symbols[key]));
        await Promise.all(promises);
    }

    // 9. Fear & Greed 지수 계기판 및 컬러 매핑
    function updateFearGreedMeter(value) {
        let scoreVal = parseInt(value);
        if (isNaN(scoreVal)) {
            scoreVal = 68;
        }
        
        const minDegree = -90;
        const maxDegree = 90;
        const targetDegree = minDegree + (scoreVal / 100) * (maxDegree - minDegree);
        
        targetNeedleAngle = targetDegree;
        
        if (fgGaugeNeedleEl) {
            fgGaugeNeedleEl.style.transform = `rotate(${targetDegree}deg)`;
        }
        
        let label = "NEUTRAL (중립)";
        let color = getInterpolatedColor(scoreVal);

        if (scoreVal >= 75) {
            label = "EXTREME GREED (극단적 탐욕)";
        } else if (scoreVal >= 55) {
            label = "GREED (탐욕)";
        } else if (scoreVal <= 25) {
            label = "EXTREME FEAR (극단적 공포)";
        } else if (scoreVal <= 45) {
            label = "FEAR (공포)";
        }

        if (largeMeterValEl) {
            largeMeterValEl.textContent = scoreVal;
            largeMeterValEl.style.fill = color;
        }
        if (largeMeterLblEl) {
            largeMeterLblEl.textContent = label;
            largeMeterLblEl.style.fill = color;
        }

        if (summaryFgValEl && summaryFgTextEl) {
            summaryFgValEl.innerText = scoreVal;
            summaryFgValEl.style.color = color;
            summaryFgTextEl.innerText = label.split(" (")[1].replace(")", "");
            summaryFgTextEl.style.color = color;
        }
    }

    function updateDashboardUI(tickResult) {
        window.latestTickResult = tickResult;

        lastUpdateTimeEl.innerText = `실시간 데이터 갱신됨 (${tickResult.timestamp})`;

        Object.keys(tickResult.indices).forEach(key => {
            const data = tickResult.indices[key];
            const priceEl = document.getElementById(`${key}-price`);
            const changeEl = document.getElementById(`${key}-change`);
            const cardEl = document.getElementById(`card-${key}`);

            if (priceEl && changeEl && cardEl) {
                const prevPrice = parseFloat(priceEl.innerText.replace(/,/g, ''));
                const isUp = data.current >= prevPrice;

                cardEl.classList.remove("tick-up", "tick-down");
                void cardEl.offsetWidth;
                cardEl.classList.add(isUp ? "tick-up" : "tick-down");

                priceEl.innerText = formatNumber(data.current, 2);
                
                const changeSign = data.netChange >= 0 ? "+" : "";
                changeEl.innerText = `${changeSign}${formatNumber(data.netChange, 2)} (${changeSign}${formatNumber(data.pctChange, 2)}%)`;
                
                if (data.netChange >= 0) {
                    changeEl.className = "index-change-badge bullish-badge";
                } else {
                    changeEl.className = "index-change-badge bearish-badge";
                }

                const chart = miniCharts[key];
                if (chart) {
                    chart.data.datasets[0].data = data.history;
                    
                    const indexLiveState = window.MockDataModule.getLiveIndices()[key];
                    const isUpVsPrevClose = indexLiveState.current >= indexLiveState.prevClose;
                    const lineColor = isUpVsPrevClose ? '#10b981' : '#f43f5e';
                    
                    chart.data.datasets[0].borderColor = lineColor;
                    
                    const ctx = document.getElementById(`chart-${key}-mini`).getContext("2d");
                    const gradBg = ctx.createLinearGradient(0, 0, 0, 70);
                    gradBg.addColorStop(0, isUpVsPrevClose ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)');
                    gradBg.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    chart.data.datasets[0].backgroundColor = gradBg;

                    chart.update('none');
                }
            }
        });

        Object.keys(tickResult.currencies).forEach(key => {
            const data = tickResult.currencies[key];
            const rateEl = document.getElementById(`rate-${key}`);
            const changeEl = document.getElementById(`rate-change-${key}`);

            if (rateEl && changeEl) {
                const decimals = 2;
                rateEl.innerText = formatNumber(data.current, decimals);
                
                const changeSign = data.netChange >= 0 ? "+" : "";
                changeEl.innerText = `${changeSign}${formatNumber(data.netChange, decimals)} (${changeSign}${formatNumber(data.pctChange, 2)}%)`;
                
                if (data.netChange >= 0) {
                    changeEl.className = "curr-change bullish-color";
                } else {
                    changeEl.className = "curr-change bearish-color";
                }
            }

            const baseCurrencyKey = key.replace('_travel', '');
            if (travelExchangeRates[baseCurrencyKey] !== undefined) {
                if (baseCurrencyKey === 'jpy') {
                    travelExchangeRates[baseCurrencyKey] = data.current / 100;
                } else if (baseCurrencyKey === 'vnd') {
                    travelExchangeRates[baseCurrencyKey] = data.current / 100;
                } else {
                    travelExchangeRates[baseCurrencyKey] = data.current;
                }

                const usdRate = travelExchangeRates.usd;
                usdExchangeRates.krw = usdRate;
                Object.keys(travelExchangeRates).forEach(k => {
                    if (k === 'usd') return;
                    if (k === 'jpy' || k === 'vnd') {
                        usdExchangeRates[k] = (usdRate / (travelExchangeRates[k] * 100)) * 100;
                    } else {
                        usdExchangeRates[k] = usdRate / travelExchangeRates[k];
                    }
                });

                const travelRateValEl = document.getElementById(`travel-rate-val-${baseCurrencyKey}`);
                const travelRateLblEl = document.getElementById(`travel-rate-lbl-${baseCurrencyKey}`);
                const travelUsdBasisEl = document.getElementById(`travel-usd-basis-${baseCurrencyKey}`);
                const travelChgEl = document.getElementById(`travel-chg-${baseCurrencyKey}`);
                
                if (travelRateValEl) {
                    if (travelBase === 'krw') {
                        const currentVal = data.current;
                        travelRateValEl.innerText = `${formatNumber(currentVal, baseCurrencyKey === 'vnd' ? 2 : 2)} KRW`;
                        if (travelRateLblEl) {
                            const unit = baseCurrencyKey === 'jpy' || baseCurrencyKey === 'vnd' ? "100" : "1";
                            const name = baseCurrencyKey === 'jpy' ? "엔" : baseCurrencyKey === 'vnd' ? "동" : baseCurrencyKey === 'eur' ? "유로" : baseCurrencyKey === 'cny' ? "위안" : baseCurrencyKey === 'thb' ? "바트" : baseCurrencyKey === 'twd' ? "대만 달러" : baseCurrencyKey === 'sgd' ? "싱가포르 달러" : "달러";
                            travelRateLblEl.innerText = `현재 환율 (${unit}${name} 기준)`;
                        }
                    } else {
                        if (baseCurrencyKey === 'krw') {
                            travelRateValEl.innerText = `${formatNumber(usdExchangeRates.krw, 2)} KRW`;
                            if (travelRateLblEl) travelRateLblEl.innerText = "현재 환율 (1달러 기준)";
                        } else {
                            const targetRate = usdExchangeRates[baseCurrencyKey];
                            const unitName = baseCurrencyKey.toUpperCase();
                            travelRateValEl.innerText = `${formatNumber(targetRate, baseCurrencyKey === 'vnd' ? 2 : 2)} ${unitName}`;
                            if (travelRateLblEl) travelRateLblEl.innerText = "현재 환율 (1달러 기준)";
                        }
                    }
                }

                if (travelUsdBasisEl) {
                    if (travelBase === 'krw') {
                        if (baseCurrencyKey === 'usd') {
                            travelUsdBasisEl.innerText = "";
                        } else {
                            const basisRate = usdExchangeRates[baseCurrencyKey];
                            const unit = baseCurrencyKey.toUpperCase();
                            travelUsdBasisEl.innerText = `1 USD = ${formatNumber(basisRate, baseCurrencyKey === 'vnd' ? 0 : 2)} ${unit}`;
                            travelUsdBasisEl.style.display = "inline-block";
                        }
                    } else {
                        if (baseCurrencyKey === 'krw') {
                            travelUsdBasisEl.innerText = `원화 기준: 1 USD = ${formatNumber(usdExchangeRates.krw, 2)} 원`;
                        } else {
                            const krwRateVal = baseCurrencyKey === 'jpy' || baseCurrencyKey === 'vnd' ? travelExchangeRates[baseCurrencyKey] * 100 : travelExchangeRates[baseCurrencyKey];
                            const unit = baseCurrencyKey === 'jpy' || baseCurrencyKey === 'vnd' ? "100" : "1";
                            const unitName = baseCurrencyKey.toUpperCase();
                            travelUsdBasisEl.innerText = `원화 기준: ${unit}${unitName} = ${formatNumber(krwRateVal, 2)} 원`;
                        }
                        travelUsdBasisEl.style.display = "inline-block";
                    }
                }

                if (travelChgEl) {
                    const changeSign = data.netChange >= 0 ? "+" : "";
                    travelChgEl.innerText = `${changeSign}${formatNumber(data.pctChange, 2)}%`;
                    travelChgEl.className = data.netChange >= 0 ? "curr-change bullish-color" : "curr-change bearish-color";
                }

                calculateTravelExchange(baseCurrencyKey);
            }
        });
        
        calculateTravelExchange('krw');

        updateDollarBasisChart();

        const currentVal = parseInt(largeMeterValEl.textContent);
        updateFearGreedMeter(isNaN(currentVal) ? 68 : currentVal);

        if (historicalChart && historicalData && historicalData.length > 0) {
            const lastIdx = historicalData.length - 1;
            const lastItem = historicalData[lastIdx];
            
            historicalChart.data.datasets[0].data[lastIdx] = lastItem.reer;
            historicalChart.data.datasets[1].data[lastIdx] = lastItem.usdValueIndex;
            historicalChart.data.datasets[2].data[lastIdx] = (lastItem.kospi / historicalData[0].kospi) * 100;
            historicalChart.data.datasets[3].data[lastIdx] = (lastItem.sp500 / historicalData[0].sp500) * 100;
            historicalChart.data.datasets[4].data[lastIdx] = lastItem.jpyValueVsUsd;
            
            historicalChart.update('none');
            updateHistoricalCommentary();
        }

        if (currentTickerState && currentTickerState.symbol) {
            const sym = currentTickerState.symbol.toUpperCase();
            let liveVal = null;
            let liveChange = null;
            let livePct = null;
            let decimals = 2;

            if (sym === '^KS11' || sym === 'KOSPI') {
                const d = tickResult.indices.kospi;
                liveVal = d.current; liveChange = d.netChange; livePct = d.pctChange;
            } else if (sym === '^KQ11' || sym === 'KOSDAQ') {
                const d = tickResult.indices.kosdaq;
                liveVal = d.current; liveChange = d.netChange; livePct = d.pctChange;
            } else if (sym === '^NDX' || sym === 'NASDAQ' || sym === '^IXIC') {
                const d = tickResult.indices.nasdaq;
                liveVal = d.current; liveChange = d.netChange; livePct = d.pctChange;
            } else if (sym === '^GSPC' || sym === 'S&P 500' || sym === 'SP500') {
                const d = tickResult.indices.sp500;
                liveVal = d.current; liveChange = d.netChange; livePct = d.pctChange;
            }
            
            const currKey = currencyKeyMap[sym];
            if (currKey && tickResult.currencies[currKey]) {
                const d = tickResult.currencies[currKey];
                liveVal = d.current; liveChange = d.netChange; livePct = d.pctChange;
                if (currKey === 'vnd') decimals = 2;
            }

            if (liveVal !== null) {
                const detailPriceEl = document.getElementById('detail-price');
                const detailChangeEl = document.getElementById('detail-change');
                if (detailPriceEl && detailChangeEl) {
                    detailPriceEl.innerText = formatNumber(liveVal, decimals);
                    const sign = liveChange >= 0 ? '+' : '';
                    detailChangeEl.innerText = `${sign}${formatNumber(liveChange, decimals)} (${sign}${formatNumber(livePct, 2)}%)`;
                    detailChangeEl.className = liveChange >= 0 ? "index-change-badge bullish-badge" : "index-change-badge bearish-badge";
                }

                if (detailChart && currentDetailData && currentDetailData.length > 0) {
                    const lastIdx = currentDetailData.length - 1;
                    const lastDataPoint = currentDetailData[lastIdx];
                    
                    lastDataPoint.c = liveVal;
                    lastDataPoint.h = Math.max(lastDataPoint.h, liveVal);
                    lastDataPoint.l = Math.min(lastDataPoint.l, liveVal);

                    if (currentDetailMode === 'candlestick') {
                        detailChart.data.datasets[0].data[lastIdx] = lastDataPoint;
                    } else {
                        detailChart.data.datasets[0].data[lastIdx] = { x: lastDataPoint.x, y: liveVal };
                    }
                    
                    detailChart.update('none');
                }
            }
        }
    }

    async function refreshRealData() {
        if (lastUpdateTimeEl) {
            lastUpdateTimeEl.innerText = "실시간 데이터 불러오는 중...";
        }
        try {
            await Promise.all([
                loadRealStockData(), 
                loadRealExchangeRates(),
                loadRealFearGreedIndex(),
                loadCurrencySparklines()
            ]);
            
            const indices = window.MockDataModule.getLiveIndices();
            const currencies = window.MockDataModule.getLiveCurrencies();
            const usdBasis = window.MockDataModule.getUsdBasisRates();
            const timestamp = new Date().toLocaleTimeString('ko-KR');
            
            const realResult = {
                indices: indices,
                currencies: currencies,
                usdBasis: usdBasis,
                timestamp: timestamp
            };
            
            updateDashboardUI(realResult);
            
            if (lastUpdateTimeEl) {
                lastUpdateTimeEl.innerText = `실시간 실제 데이터 불러오기 완료 (${timestamp})`;
            }
        } catch (err) {
            console.error("Error refreshing live data:", err);
            if (lastUpdateTimeEl) {
                lastUpdateTimeEl.innerText = "실시간 API 갱신 실패, 이전 데이터 유지";
            }
        }
    }

    function startRealtimeTickLoop() {
        setInterval(refreshRealData, 30000);
        
        setInterval(() => {
            const tickResult = window.MockDataModule.tick();
            updateDashboardUI(tickResult);
        }, 2000);
    }

    async function fetchWithProxyFallback(url) {
        const createFetch = async (proxyUrl, parseFunc) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (!res.ok) throw new Error("HTTP error " + res.status);
                return await parseFunc(res);
            } catch (e) {
                clearTimeout(timeout);
                throw e;
            }
        };

        const promises = [
            createFetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, r => r.json()),
            createFetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, r => r.json()),
            createFetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, r => r.json()),
            createFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, async r => {
                const wrapper = await r.json();
                return JSON.parse(wrapper.contents);
            })
        ];

        try {
            return await Promise.race([
                Promise.any(promises),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Strict Timeout 3s")), 3000))
            ]);
        } catch (e) {
            console.error("All CORS proxies failed or timed out for URL:", url, e);
            throw new Error("All CORS proxies failed or timed out");
        }
    }

    async function loadRealStockData() {
        const symbols = {
            kospi: '^KS11',
            kosdaq: '^KQ11',
            nasdaq: '^NDX',
            sp500: '^GSPC',
            dxy: 'DX-Y.NYB'
        };

        const indexData = {};

        await Promise.all(Object.keys(symbols).map(async (key) => {
            const symbol = symbols[key];
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=30d`;
            try {
                const json = await fetchWithProxyFallback(url);
                const result = json.chart.result[0];
                const current = result.meta.regularMarketPrice;
                const prevClose = result.meta.previousClose || result.meta.chartPreviousClose || current;
                let history = [];
                if (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) {
                    history = result.indicators.quote[0].close
                        .filter(val => val !== null)
                        .map(val => parseFloat(val.toFixed(2)));
                }
                
                if (history.length === 0) {
                    let val = current - 15;
                    for (let i = 0; i < 30; i++) {
                        val += (Math.random() - 0.48) * (val * 0.001);
                        history.push(parseFloat(val.toFixed(2)));
                    }
                }

                indexData[key] = {
                    current: current,
                    prevClose: prevClose,
                    history: history
                };
            } catch (err) {
                console.warn(`Failed to load real data for index ${key}, fallback to simulation`, err);
            }
        }));

        const liveKeys = ['kospi', 'kosdaq', 'nasdaq', 'sp500'];
        const liveIndexUpdates = {};
        liveKeys.forEach(k => {
            if (indexData[k]) {
                liveIndexUpdates[k] = indexData[k];
            }
        });

        if (Object.keys(liveIndexUpdates).length > 0) {
            window.MockDataModule.updateIndices(liveIndexUpdates);
        }

        const finalAnchorUpdates = {};
        Object.keys(indexData).forEach(k => {
            finalAnchorUpdates[k] = indexData[k].current;
        });
        window.MockDataModule.updateCurrentAnchor(finalAnchorUpdates);
    }

    async function loadRealExchangeRates() {
        let rates = null;
        let prevCloseRates = null;
        let dataSource = '';

        try {
            const yahooSymbols = [
                { symbol: 'USDKRW=X', key: 'KRW', inverse: false },
                { symbol: 'USDJPY=X', key: 'JPY', inverse: false },
                { symbol: 'EURUSD=X', key: 'EUR', inverse: true },
                { symbol: 'USDCNY=X', key: 'CNY', inverse: false },
                { symbol: 'USDVND=X', key: 'VND', inverse: false },
                { symbol: 'USDTHB=X', key: 'THB', inverse: false },
                { symbol: 'USDTWD=X', key: 'TWD', inverse: false },
                { symbol: 'USDSGD=X', key: 'SGD', inverse: false },
                { symbol: 'USDPHP=X', key: 'PHP', inverse: false },
                { symbol: 'USDHKD=X', key: 'HKD', inverse: false },
                { symbol: 'USDMYR=X', key: 'MYR', inverse: false },
                { symbol: 'GBPUSD=X', key: 'GBP', inverse: true }
            ];

            const fetchPromises = yahooSymbols.map(async (pair) => {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair.symbol}?interval=1d&range=1d`;
                const json = await fetchWithProxyFallback(url);
                const meta = json.chart.result[0].meta;
                let current = meta.regularMarketPrice;
                let prevClose = meta.previousClose || meta.chartPreviousClose || current;
                if (pair.inverse) {
                    current = 1 / current;
                    prevClose = 1 / prevClose;
                }
                return { key: pair.key, current, prevClose };
            });

            const results = await Promise.allSettled(fetchPromises);
            rates = {};
            prevCloseRates = {};

            results.forEach((result) => {
                if (result.status === 'fulfilled') {
                    const { key, current, prevClose } = result.value;
                    rates[key] = current;
                    prevCloseRates[key] = prevClose;
                }
            });

            if (!rates.KRW) throw new Error("USD/KRW not available from Yahoo Finance");
            dataSource = 'Yahoo Finance (실시간)';
        } catch (yahooErr) {
            rates = null;
        }

        if (!rates || !rates.KRW) {
            try {
                const res = await fetch('https://open.er-api.com/v6/latest/USD');
                if (!res.ok) throw new Error("Fallback API HTTP error");
                const data = await res.json();
                rates = data.rates;
                prevCloseRates = {};
                Object.keys(rates).forEach(k => {
                    const deviation = (Math.random() - 0.5) * 0.003;
                    prevCloseRates[k] = rates[k] / (1 + deviation);
                });
                dataSource = 'open.er-api.com (일 1회)';
            } catch (fbErr) {
                return;
            }
        }

        const requiredKeys = ['KRW', 'JPY', 'EUR', 'CNY', 'VND', 'THB', 'TWD', 'SGD', 'PHP', 'HKD', 'MYR', 'GBP'];
        const missingKeys = requiredKeys.filter(k => !rates[k]);
        if (missingKeys.length > 0 && dataSource.startsWith('Yahoo')) {
            try {
                const fbRes = await fetch('https://open.er-api.com/v6/latest/USD');
                if (fbRes.ok) {
                    const fbData = await fbRes.json();
                    missingKeys.forEach(key => {
                        if (fbData.rates[key]) {
                            rates[key] = fbData.rates[key];
                            prevCloseRates[key] = fbData.rates[key];
                        }
                    });
                }
            } catch (e) { }
        }

        try {
            const krwRate = rates.KRW;
            const krwPrevClose = prevCloseRates.KRW || krwRate;

            const usdCurrent = krwRate;
            const jpyCurrent = (1 / rates.JPY) * krwRate * 100;
            const eurCurrent = (1 / rates.EUR) * krwRate;
            const cnyCurrent = (1 / rates.CNY) * krwRate;
            const vndCurrent = (1 / (rates.VND || 25450)) * krwRate * 100;
            const thbCurrent = (1 / (rates.THB || 36.70)) * krwRate;
            const twdCurrent = (1 / (rates.TWD || 32.25)) * krwRate;
            const phpCurrent = (1 / (rates.PHP || 58.50)) * krwRate;
            const sgdCurrent = (1 / (rates.SGD || 1.35)) * krwRate;
            const hkdCurrent = (1 / (rates.HKD || 7.81)) * krwRate;
            const myrCurrent = (1 / (rates.MYR || 4.68)) * krwRate;

            const usdPrev = krwPrevClose;
            const jpyPrev = (1 / (prevCloseRates.JPY || rates.JPY)) * krwPrevClose * 100;
            const eurPrev = (1 / (prevCloseRates.EUR || rates.EUR)) * krwPrevClose;
            const cnyPrev = (1 / (prevCloseRates.CNY || rates.CNY)) * krwPrevClose;
            const vndPrev = (1 / (prevCloseRates.VND || rates.VND || 25450)) * krwPrevClose * 100;
            const thbPrev = (1 / (prevCloseRates.THB || rates.THB || 36.70)) * krwPrevClose;
            const twdPrev = (1 / (prevCloseRates.TWD || rates.TWD || 32.25)) * krwPrevClose;
            const phpPrev = (1 / (prevCloseRates.PHP || rates.PHP || 58.50)) * krwPrevClose;
            const sgdPrev = (1 / (prevCloseRates.SGD || rates.SGD || 1.35)) * krwPrevClose;
            const hkdPrev = (1 / (prevCloseRates.HKD || rates.HKD || 7.81)) * krwPrevClose;
            const myrPrev = (1 / (prevCloseRates.MYR || rates.MYR || 4.68)) * krwPrevClose;

            const currencyData = {
                usd: { current: usdCurrent, prevClose: usdPrev },
                jpy: { current: jpyCurrent, prevClose: jpyPrev },
                eur: { current: eurCurrent, prevClose: eurPrev },
                cny: { current: cnyCurrent, prevClose: cnyPrev },
                vnd: { current: vndCurrent, prevClose: vndPrev },
                thb: { current: thbCurrent, prevClose: thbPrev },
                twd: { current: twdCurrent, prevClose: twdPrev },
                php: { current: phpCurrent, prevClose: phpPrev },
                sgd: { current: sgdCurrent, prevClose: sgdPrev },
                hkd: { current: hkdCurrent, prevClose: hkdPrev },
                myr: { current: myrCurrent, prevClose: myrPrev },
                jpy_travel: { current: jpyCurrent, prevClose: jpyPrev },
                eur_travel: { current: eurCurrent, prevClose: eurPrev }
            };

            const eurUsd = 1 / rates.EUR;
            const usdJpy = rates.JPY;
            const gbpUsd = rates.GBP ? 1 / rates.GBP : 1.34;
            const usdCny = rates.CNY;
            const usdKrw = krwRate;

            const prevEurUsd = prevCloseRates.EUR ? 1 / prevCloseRates.EUR : eurUsd;
            const prevUsdJpy = prevCloseRates.JPY || usdJpy;
            const prevGbpUsd = prevCloseRates.GBP ? 1 / prevCloseRates.GBP : gbpUsd;
            const prevUsdCny = prevCloseRates.CNY || usdCny;
            const prevUsdKrw = krwPrevClose;

            const usdBasisData = {
                eur: { current: eurUsd, prevClose: prevEurUsd, changeRate: parseFloat(((eurUsd - prevEurUsd) / prevEurUsd * 100).toFixed(2)) },
                jpy: { current: usdJpy, prevClose: prevUsdJpy, changeRate: parseFloat(((usdJpy - prevUsdJpy) / prevUsdJpy * 100).toFixed(2)) },
                gbp: { current: gbpUsd, prevClose: prevGbpUsd, changeRate: parseFloat(((gbpUsd - prevGbpUsd) / prevGbpUsd * 100).toFixed(2)) },
                cny: { current: usdCny, prevClose: prevUsdCny, changeRate: parseFloat(((usdCny - prevUsdCny) / prevUsdCny * 100).toFixed(2)) },
                krw: { current: usdKrw, prevClose: prevUsdKrw, changeRate: parseFloat(((usdKrw - prevUsdKrw) / prevUsdKrw * 100).toFixed(2)) }
            };

            travelExchangeRates.usd = usdCurrent;
            travelExchangeRates.jpy = jpyCurrent / 100;
            travelExchangeRates.eur = eurCurrent;
            travelExchangeRates.cny = cnyCurrent;
            travelExchangeRates.vnd = vndCurrent / 100;
            travelExchangeRates.thb = thbCurrent;
            travelExchangeRates.twd = twdCurrent;
            travelExchangeRates.sgd = sgdCurrent;
            travelExchangeRates.php = phpCurrent;
            travelExchangeRates.hkd = hkdCurrent;
            travelExchangeRates.myr = myrCurrent;

            usdExchangeRates.krw = krwRate;
            usdExchangeRates.jpy = rates.JPY;
            usdExchangeRates.eur = rates.EUR;
            usdExchangeRates.cny = rates.CNY;
            usdExchangeRates.vnd = rates.VND || 25450;
            usdExchangeRates.thb = rates.THB || 36.70;
            usdExchangeRates.twd = rates.TWD || 32.25;
            usdExchangeRates.sgd = rates.SGD || 1.35;
            usdExchangeRates.php = rates.PHP || 58.50;
            usdExchangeRates.hkd = rates.HKD || 7.81;
            usdExchangeRates.myr = rates.MYR || 4.68;

            prevUsdExchangeRates.krw = krwPrevClose;
            prevUsdExchangeRates.jpy = prevCloseRates.JPY || rates.JPY;
            prevUsdExchangeRates.eur = prevCloseRates.EUR || rates.EUR;
            prevUsdExchangeRates.cny = prevCloseRates.CNY || rates.CNY;
            prevUsdExchangeRates.vnd = prevCloseRates.VND || rates.VND || 25450;
            prevUsdExchangeRates.thb = prevCloseRates.THB || rates.THB || 36.70;
            prevUsdExchangeRates.twd = prevCloseRates.TWD || rates.TWD || 32.25;
            prevUsdExchangeRates.sgd = prevCloseRates.SGD || rates.SGD || 1.35;
            prevUsdExchangeRates.php = prevCloseRates.PHP || rates.PHP || 58.50;
            prevUsdExchangeRates.hkd = prevCloseRates.HKD || rates.HKD || 7.81;
            prevUsdExchangeRates.myr = prevCloseRates.MYR || rates.MYR || 4.68;

            window.MockDataModule.updateCurrencies(currencyData);
            window.MockDataModule.updateUsdBasis(usdBasisData);

            window.MockDataModule.updateCurrentAnchor({
                usdKrw: usdCurrent,
                jpyKrw: jpyCurrent,
                eurKrw: eurCurrent,
                cnyKrw: cnyCurrent
            });
        } catch (e) { }
    }

    async function loadRealFearGreedIndex() {
        const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
        try {
            const json = await fetchWithProxyFallback(url);
            const score = Math.round(json.fear_and_greed.score);
            if (score >= 0 && score <= 100) {
                summaryFgValEl.innerText = score;
                largeMeterValEl.textContent = score;
                updateFearGreedMeter(score);
            }
        } catch (e) {
            console.warn("Failed to load real Fear & Greed index, fallback to simulation", e);
        }
    }
    
    function getYahooFinanceUrl(tickerState) {
        let sym = tickerState.symbol;
        if (!sym) return 'https://finance.yahoo.com/';
        
        if (tickerState.exchange === 'kospi') {
            if (!sym.endsWith('.KS')) sym += '.KS';
        } else if (tickerState.exchange === 'kosdaq') {
            if (!sym.endsWith('.KQ')) sym += '.KQ';
        } else if (tickerState.exchange === 'japan') {
            if (!sym.endsWith('.T')) sym += '.T';
        }
        return `https://finance.yahoo.com/quote/${sym}`;
    }

    function getCurrencyValueChange(key) {
        let currentRate = usdExchangeRates[key];
        if (key === 'krw') {
            currentRate = usdExchangeRates.krw;
        }
        if (!currentRate) return 0;
        
        if (currentDollarBasisPeriod === 'ytd') {
            if (key === 'eur') {
                const eurUsd = 1 / currentRate;
                return ((eurUsd - yearStartRates.eur) / yearStartRates.eur) * 100;
            } else {
                return ((yearStartRates[key] / currentRate) - 1) * 100;
            }
        } else if (currentDollarBasisPeriod === 'daily') {
            let prevRate = prevUsdExchangeRates[key];
            if (key === 'krw') prevRate = prevUsdExchangeRates.krw;
            if (!prevRate) prevRate = currentRate;
            
            if (key === 'eur') {
                const eurUsd = 1 / currentRate;
                const prevEurUsd = 1 / prevRate;
                return ((eurUsd - prevEurUsd) / prevEurUsd) * 100;
            } else {
                return ((prevRate / currentRate) - 1) * 100;
            }
        } else {
            const offset = timeframeChangeOffsets[currentDollarBasisPeriod][key] || 0;
            let dailyChange = 0;
            let prevRate = prevUsdExchangeRates[key];
            if (key === 'krw') prevRate = prevUsdExchangeRates.krw;
            if (prevRate && prevRate !== currentRate) {
                if (key === 'eur') {
                    dailyChange = ((1 / currentRate) - (1 / prevRate)) / (1 / prevRate) * 100;
                } else {
                    dailyChange = (prevRate / currentRate - 1) * 100;
                }
            }
            return offset + dailyChange;
        }
    }

    function initDollarBasisChart() {
        const canvas = document.getElementById('chart-dollar-basis');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const currencyMeta = {
            krw: { flag: '🇰🇷', name: '한국', shortName: '한국', code: 'KRW' },
            php: { flag: '🇵🇭', name: '필리핀', shortName: '필리핀', code: 'PHP' },
            thb: { flag: '🇹🇭', name: '태국', shortName: '태국', code: 'THB' },
            jpy: { flag: '🇯🇵', name: '일본', shortName: '일본', code: 'JPY' },
            eur: { flag: '🇪🇺', name: '유럽', shortName: '유럽', code: 'EUR' },
            twd: { flag: '🇹🇼', name: '대만', shortName: '대만', code: 'TWD' },
            hkd: { flag: '🇭🇰', name: '홍콩', shortName: '홍콩', code: 'HKD' },
            vnd: { flag: '🇻🇳', name: '베트남', shortName: '베트남', code: 'VND' },
            sgd: { flag: '🇸🇬', name: '싱가포르', shortName: '싱가폴', code: 'SGD' },
            myr: { flag: '🇲🇾', name: '말레이시아', shortName: '말레이', code: 'MYR' },
            cny: { flag: '🇨🇳', name: '중국', shortName: '중국', code: 'CNY' }
        };

        const valueLabelsPlugin = {
            id: 'valueLabels',
            afterDatasetsDraw: (chart) => {
                const { ctx, data } = chart;
                ctx.save();
                const isMobile = window.innerWidth < 600;
                ctx.font = isMobile ? 'bold 11px Inter, system-ui, sans-serif' : 'bold 12px Inter, system-ui, sans-serif';
                ctx.textAlign = 'center';
                
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const val = data.datasets[0].data[index];
                    if (val === undefined || val === null) return;
                    
                    const isNegative = val < 0;
                    const text = (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
                    
                    ctx.fillStyle = index === 0 ? '#ff4b3e' : '#88c4fc';
                    
                    const x = bar.x;
                    const y = isNegative ? bar.y + 12 : bar.y - 6;
                    
                    ctx.fillText(text, x, y);
                });
                ctx.restore();
            }
        };

        const zeroLinePlugin = {
            id: 'zeroLine',
            afterDatasetsDraw: (chart) => {
                const { ctx, scales: { x, y } } = chart;
                const zeroY = y.getPixelForValue(0);
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x.left, zeroY);
                ctx.lineTo(x.right, zeroY);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
            }
        };

        const currencyLabelsPlugin = {
            id: 'currencyLabels',
            afterDatasetsDraw: (chart) => {
                const { ctx, scales: { x, y }, data } = chart;
                ctx.save();
                const isMobile = window.innerWidth < 600;
                ctx.font = isMobile 
                    ? 'bold 11px Inter, "Malgun Gothic", "맑은 고딕", sans-serif' 
                    : 'bold 12px Inter, "Malgun Gothic", "맑은 고딕", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                const zeroY = y.getPixelForValue(0);
                const lineHeight = isMobile ? 13 : 16;
                
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const val = data.datasets[0].data[index];
                    if (val === undefined || val === null) return;
                    
                    const key = data.labels[index];
                    const meta = currencyMeta[key];
                    if (!meta) return;
                    
                    const flag = meta.flag;
                    const name = isMobile ? meta.shortName : meta.name;
                    const code = meta.code;
                    
                    const labelLines = isMobile ? [flag, name] : [flag + ' ' + name, code];
                    const N = labelLines.length;
                    const isKorea = (index === 0);
                    
                    labelLines.forEach((line, i) => {
                        let yPos;
                        if (val < 0) {
                            yPos = zeroY - 6 - (N - 1 - i) * lineHeight;
                        } else {
                            yPos = zeroY + 10 + i * lineHeight;
                        }
                        
                        let lineColor = '#e2e8f0';
                        if (isMobile) {
                            if (i === 0) {
                                lineColor = '#e2e8f0';
                            } else {
                                lineColor = isKorea ? '#ff4b3e' : '#e2e8f0';
                            }
                        } else {
                            if (i === 1) {
                                lineColor = isKorea ? '#ff8b80' : '#94a3b8';
                            } else {
                                lineColor = isKorea ? '#ff4b3e' : '#e2e8f0';
                            }
                        }
                        
                        ctx.fillStyle = lineColor;
                        ctx.fillText(line, bar.x, yPos);
                    });
                });
                ctx.restore();
            }
        };

        const initialValues = [
            getCurrencyValueChange('krw'),
            getCurrencyValueChange('php'),
            getCurrencyValueChange('thb'),
            getCurrencyValueChange('jpy'),
            getCurrencyValueChange('eur'),
            getCurrencyValueChange('twd'),
            getCurrencyValueChange('hkd'),
            getCurrencyValueChange('myr'),
            getCurrencyValueChange('vnd'),
            getCurrencyValueChange('sgd'),
            getCurrencyValueChange('cny')
        ];

        let maxVal = Math.max(...initialValues);
        let minVal = Math.min(...initialValues);
        const targetMax = Math.max(4.0, maxVal + 2.5);
        const targetMin = Math.min(-4.0, minVal - 2.5);

        dollarBasisChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['krw', 'php', 'thb', 'jpy', 'eur', 'twd', 'hkd', 'myr', 'vnd', 'sgd', 'cny'],
                datasets: [{
                    data: initialValues,
                    backgroundColor: [
                        '#ff4b3e',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc',
                        '#88c4fc'
                    ],
                    borderRadius: 5,
                    borderSkipped: false,
                    barPercentage: 0.85,
                    categoryPercentage: 0.92
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            title: function(tooltipItems) {
                                const key = tooltipItems[0].label;
                                const meta = currencyMeta[key];
                                return meta ? `${meta.flag} ${meta.name} (${meta.code})` : key;
                            },
                            label: function(context) {
                                return `${context.raw.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            display: false
                        }
                    },
                    y: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            display: false
                        },
                        min: targetMin,
                        max: targetMax
                    }
                }
            },
            plugins: [valueLabelsPlugin, zeroLinePlugin, currencyLabelsPlugin]
        });
    }

    function updateDollarBasisChart() {
        if (!dollarBasisChart) return;
        const newValues = [
            getCurrencyValueChange('krw'),
            getCurrencyValueChange('php'),
            getCurrencyValueChange('thb'),
            getCurrencyValueChange('jpy'),
            getCurrencyValueChange('eur'),
            getCurrencyValueChange('twd'),
            getCurrencyValueChange('hkd'),
            getCurrencyValueChange('myr'),
            getCurrencyValueChange('vnd'),
            getCurrencyValueChange('sgd'),
            getCurrencyValueChange('cny')
        ];
        dollarBasisChart.data.datasets[0].data = newValues;

        let maxVal = Math.max(...newValues);
        let minVal = Math.min(...newValues);
        const targetMax = Math.max(4.0, maxVal + 2.5);
        const targetMin = Math.min(-4.0, minVal - 2.5);

        dollarBasisChart.options.scales.y.min = targetMin;
        dollarBasisChart.options.scales.y.max = targetMax;

        dollarBasisChart.update('none');
    }

    function bindClickVerificationLinks() {
        const mainCurrencyLinks = {
            'usd': 'https://www.investing.com/currencies/usd-krw',
            'jpy': 'https://www.investing.com/currencies/jpy-krw',
            'eur': 'https://www.investing.com/currencies/eur-krw',
            'cny': 'https://www.investing.com/currencies/cny-krw'
        };
        Object.keys(mainCurrencyLinks).forEach(key => {
            const card = document.getElementById(`curr-${key}`);
            if (card) {
                card.addEventListener('click', () => {
                    window.open(mainCurrencyLinks[key], '_blank');
                });
            }
        });

        const fgSummaryCard = document.getElementById('card-fear-greed-summary');
        if (fgSummaryCard) {
            fgSummaryCard.addEventListener('click', () => {
                window.open('https://edition.cnn.com/markets/fear-and-greed', '_blank');
            });
        }

        const travelCardIds = ['usd', 'krw', 'jpy', 'eur', 'cny', 'vnd', 'thb', 'twd', 'sgd'];
        travelCardIds.forEach(id => {
            const card = document.getElementById(`travel-card-${id}`);
            if (card) {
                card.addEventListener('click', (event) => {
                    if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('input, button, select, a')) {
                        return;
                    }
                    
                    let url = '';
                    if (travelBase === 'krw') {
                        if (id === 'usd') url = 'https://www.investing.com/currencies/usd-krw';
                        else if (id === 'jpy') url = 'https://www.investing.com/currencies/jpy-krw';
                        else if (id === 'eur') url = 'https://www.investing.com/currencies/eur-krw';
                        else if (id === 'cny') url = 'https://www.investing.com/currencies/cny-krw';
                        else if (id === 'vnd') url = 'https://www.investing.com/currencies/vnd-krw';
                        else if (id === 'thb') url = 'https://www.investing.com/currencies/thb-krw';
                        else if (id === 'twd') url = 'https://www.investing.com/currencies/twd-krw';
                        else if (id === 'sgd') url = 'https://www.investing.com/currencies/sgd-krw';
                    } else {
                        if (id === 'krw') url = 'https://www.investing.com/currencies/usd-krw';
                        else if (id === 'jpy') url = 'https://www.investing.com/currencies/usd-jpy';
                        else if (id === 'eur') url = 'https://www.investing.com/currencies/eur-usd';
                        else if (id === 'cny') url = 'https://www.investing.com/currencies/usd-cny';
                        else if (id === 'vnd') url = 'https://www.investing.com/currencies/usd-vnd';
                        else if (id === 'thb') url = 'https://www.investing.com/currencies/usd-thb';
                        else if (id === 'twd') url = 'https://www.investing.com/currencies/usd-twd';
                        else if (id === 'sgd') url = 'https://www.investing.com/currencies/usd-sgd';
                    }
                    
                    if (url) {
                        window.open(url, '_blank');
                    }
                });
            }
        });

        const dollarBasisCard = document.getElementById('dollar-basis-chart-card');
        if (dollarBasisCard) {
            dollarBasisCard.addEventListener('click', () => {
                window.open('https://www.investing.com/currencies/', '_blank');
            });
        }

        const tickerDetailHeader = document.getElementById('ticker-detail-header');
        if (tickerDetailHeader) {
            tickerDetailHeader.style.cursor = 'pointer';
            tickerDetailHeader.title = '클릭 시 야후 파이낸스 해당 종목 페이지로 이동';
            tickerDetailHeader.addEventListener('click', () => {
                const url = getYahooFinanceUrl(currentTickerState);
                window.open(url, '_blank');
            });
        }

        const basisTabButtons = document.querySelectorAll('.basis-tab-btn');
        const dollarBasisSubtitle = document.querySelector('.dollar-basis-section .status-subtitle');
        basisTabButtons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                basisTabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const range = btn.getAttribute('data-range');
                currentDollarBasisPeriod = range;

                if (dollarBasisSubtitle) {
                    if (range === 'ytd') {
                        dollarBasisSubtitle.innerText = '단위: %, 현지시간 연초(2026년 1월 1일) 대비 현재 실시간 통화가치 변동률';
                    } else if (range === '1m') {
                        dollarBasisSubtitle.innerText = '단위: %, 현지시간 1달 전 대비 현재 실시간 통화가치 변동률';
                    } else if (range === '1w') {
                        dollarBasisSubtitle.innerText = '단위: %, 현지시간 1주일 전 대비 현재 실시간 통화가치 변동률';
                    } else if (range === 'daily') {
                        dollarBasisSubtitle.innerText = '단위: %, 현지시간 전일(어제) 대비 현재 실시간 통화가치 변동률';
                    }
                }

                updateDollarBasisChart();
            });
        });
    }



    function renderDetailChart(data, isBullish, period = '1y') {
        const ctx = document.getElementById('chart-ticker-detail');
        if (!ctx) return;

        if (detailChart) {
            detailChart.destroy();
        }

        const chartType = currentDetailMode === 'candlestick' ? 'candlestick' : 'line';
        let datasets = [];

        const isPlaceholder = data.length > 0 && data[0].isPlaceholder;

        if (chartType === 'candlestick') {
            datasets = [{
                label: currentTickerState.name || currentTickerState.symbol,
                data: data.map(d => ({
                    x: d.x,
                    o: d.o,
                    h: d.h,
                    l: d.l,
                    c: d.c
                })),
                color: {
                    up: 'rgba(239, 68, 68, 1)',
                    down: 'rgba(59, 130, 246, 1)',
                    unchanged: '#94a3b8'
                }
            }];
        } else {
            datasets = [{
                label: currentTickerState.name || currentTickerState.symbol,
                data: data.map(d => ({ x: d.x, y: d.c })),
                borderColor: isBullish ? '#ef4444' : '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1,
                fill: {
                    target: 'origin',
                    above: isBullish ? 'rgba(239, 68, 68, 0.03)' : 'rgba(59, 130, 246, 0.03)'
                }
            }];
        }

        const range = getPeriodRange(period);
        
        const firstPoint = data[0];
        let listingDate = null;
        if (firstPoint && !isPlaceholder && firstPoint.x > range.min + 2 * 24 * 60 * 60 * 1000) {
            listingDate = firstPoint.x;
        }

        detailChart = new Chart(ctx.getContext('2d'), {
            type: chartType,
            data: { datasets: datasets },
            plugins: [noDataPlaceholderPlugin],
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    noDataPlaceholder: {
                        active: isPlaceholder || (listingDate !== null),
                        listingDate: listingDate,
                        isPlaceholder: isPlaceholder,
                        startValue: data.length > 0 ? (data[0].o || data[0].c) : 100
                    },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        backgroundColor: 'rgba(10, 15, 30, 0.9)',
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 12,
                        caretSize: 0,
                        callbacks: {
                            label: function(context) { 
                                const val = context.raw.c !== undefined ? context.raw.c : context.parsed.y;
                                return ` ${context.dataset.label}: ${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`; 
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        min: range.min,
                        max: range.max,
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#64748b', maxTicksLimit: 6, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        position: 'right',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', callback: (v) => v.toLocaleString(undefined, {maximumFractionDigits: 0}) },
                        grace: '5%'
                    }
                }
            }
        });
        adjustChartHeight(detailChart, 320);
    }

    // --- 추천 포트폴리오 데이터셋 및 인터랙션 기능 구현 ---
    const recommendedPortfolios = [
        {
            id: 'allweather',
            name: '사계절 안정형 (All Weather)',
            desc: '레이 달리오의 자산배분 전략을 모방하여, 주식/채권/원자재에 고루 투자해 시장 불황에도 안정적인 수익을 추구합니다.',
            items: [
                { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', weight: 30, exchange: 'nasdaq' },
                { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', weight: 40, exchange: 'nasdaq' },
                { symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF', weight: 15, exchange: 'nasdaq' },
                { symbol: 'GLD', name: 'SPDR Gold Shares', weight: 7.5, exchange: 'nyse' },
                { symbol: 'DBC', name: 'Invesco DB Commodity Index Tracking', weight: 7.5, exchange: 'nyse' }
            ]
        },
        {
            id: 'growth',
            name: 'IT 성장형 (Tech Growth)',
            desc: '혁신적인 기술 트렌드를 이끄는 미국 대표 빅테크 기업들에 집중적으로 투자하여 장기적으로 높은 자산 상승률을 목표로 합니다.',
            items: [
                { symbol: 'AAPL', name: 'Apple Inc.', weight: 30, exchange: 'nasdaq' },
                { symbol: 'MSFT', name: 'Microsoft Corp.', weight: 30, exchange: 'nasdaq' },
                { symbol: 'NVDA', name: 'NVIDIA Corp.', weight: 20, exchange: 'nasdaq' },
                { symbol: 'TSLA', name: 'Tesla Inc.', weight: 20, exchange: 'nasdaq' }
            ]
        },
        {
            id: 'stable',
            name: '현금 배당형 (Balanced Income)',
            desc: '시장 지수 추종 ETF와 안정적인 중기 채권에 자산을 균형 있게 나누어 배당 수익과 안정적인 자산 방어를 동시에 달성합니다.',
            items: [
                { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', weight: 50, exchange: 'nyse' },
                { symbol: 'IEI', name: 'iShares 3-7 Year Treasury Bond ETF', weight: 30, exchange: 'nasdaq' },
                { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', weight: 20, exchange: 'nasdaq' }
            ]
        },
        {
            id: 'stock80bond20',
            name: '주식 80% / 채권 20% (Stock 80% / Bond 20%)',
            desc: '미국 전체 주식 시장에 80%, 채권 시장에 20%를 투자하는 자산 배분의 기본이자 정석적인 포트폴리오입니다.',
            items: [
                { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', weight: 80, exchange: 'nasdaq' },
                { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', weight: 20, exchange: 'nasdaq' }
            ]
        },
        {
            id: 'momentum6040',
            name: '모멘텀 60 / 40 (Momentum 60/40)',
            desc: '시장 주도 모멘텀 주식 60%와 종합 채권 40%로 구성하여 적극적인 수익과 안정성을 결합한 전략입니다.',
            items: [
                { symbol: 'MTUM', name: 'iShares MSCI USA Momentum Factor ETF', weight: 60, exchange: 'nyse' },
                { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', weight: 40, exchange: 'nasdaq' }
            ]
        },
        {
            id: 'goldenbutterfly',
            name: '골든 버터플라이 (Golden Butterfly)',
            desc: '주식, 소형 가치주, 단기 채권, 장기 채권, 금에 각각 20%씩 균등 투자하여 어떤 거시경제 환경에서도 손실을 최소화하는 전략입니다.',
            items: [
                { symbol: 'IJS', name: 'iShares S&P Small-Cap 600 Value ETF', weight: 20, exchange: 'nyse' },
                { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', weight: 20, exchange: 'nasdaq' },
                { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', weight: 20, exchange: 'nasdaq' },
                { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', weight: 20, exchange: 'nasdaq' },
                { symbol: 'GLD', name: 'SPDR Gold Shares', weight: 20, exchange: 'nyse' }
            ]
        }
    ];

    let selectedRecPortfolio = recommendedPortfolios[0];
    let recPieChart = null;
    let compMyPieChart = null;
    let compRecPieChart = null;
    let weightStartChart = null;
    let weightCurrentChart = null;
    let selectedAnalysisTarget = 'my'; // 'my' 또는 'rec'

    // 추천 포트폴리오 카드 렌더링
    function renderRecommendedPortfolioCards() {
        const grid = document.querySelector('.recommended-grid');
        if (!grid) return;

        grid.innerHTML = recommendedPortfolios.map(portfolio => {
            const isActive = portfolio.id === selectedRecPortfolio.id ? 'active' : '';
            return `
                <div class="portfolio-select-icon-card ${isActive}" onclick="window.selectRecPortfolio('${portfolio.id}')" style="padding: 16px; cursor: pointer; border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.02); transition: all 0.3s ease;">
                    <div style="font-size: 24px;">💡</div>
                    <div style="font-weight: 700; color: #fff; font-size: 14px;">${portfolio.name}</div>
                    <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${portfolio.desc}</div>
                </div>
            `;
        }).join('');

        renderSelectedRecPortfolioDetails();
    }

    // 선택한 추천 포트폴리오의 상세 정보와 파이 차트 업데이트
    function renderSelectedRecPortfolioDetails() {
        const titleEl = document.getElementById('selected-rec-title');
        const descEl = document.querySelector('#detail-subview-recommended p');
        const listEl = document.getElementById('rec-allocation-list');
        
        if (titleEl) titleEl.innerText = selectedRecPortfolio.name;
        if (descEl) descEl.innerText = selectedRecPortfolio.desc;

        if (listEl) {
            listEl.innerHTML = selectedRecPortfolio.items.map(item => `
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #cbd5e1; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <span>${item.name} (${item.symbol})</span>
                    <span style="font-weight: 700; color: var(--accent);">${item.weight}%</span>
                </div>
            `).join('');
        }

        renderRecPieChart();
    }

    // 추천 포트폴리오 파이 차트
    function renderRecPieChart() {
        const canvas = document.getElementById('chart-rec-pie');
        if (!canvas) return;

        if (recPieChart) {
            recPieChart.destroy();
        }

        const labels = selectedRecPortfolio.items.map(item => item.symbol);
        const data = selectedRecPortfolio.items.map(item => item.weight);
        const colors = ['#ff4b60', '#ff8838', '#ffc72c', '#00e676', '#00b0ff', '#3d5afe', '#d500f9', '#ff4081', '#00f2fe', '#4facfe'];

        recPieChart = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#cbd5e1', font: { size: 11 } }
                    }
                }
            }
        });
    }

    // 추천 포트폴리오 선택 이벤트 (전역 바인딩)
    window.selectRecPortfolio = function(id) {
        const found = recommendedPortfolios.find(p => p.id === id);
        if (found) {
            selectedRecPortfolio = found;
            renderRecommendedPortfolioCards();
            
            // 포트폴리오 분석 타겟이 'rec'일 때, 차트와 파이 차트도 동시 갱신
            if (selectedAnalysisTarget === 'rec') {
                renderPortfolioWeightCharts();
            }
        }
    };

    // 추천 포트폴리오 복제 기능
    window.confirmCopyRecommendedPortfolio = function() {
        const modal = document.getElementById('portfolio-copy-confirm-modal');
        const msgEl = document.getElementById('copy-confirm-message');
        if (msgEl) {
            msgEl.innerHTML = `"${selectedRecPortfolio.name}" 구성을 복사하여 내 포트폴리오로 복제하시겠습니까?<br><br>복사 시 기존 내 포트폴리오 데이터는 <strong>모두 대체</strong>되며, 총 <strong>1,000만 원 기준</strong>으로 자산별 수량이 자동 계산되어 입력됩니다.`;
        }
        if (modal) {
            modal.classList.add('active');
        }

        const yesBtn = document.getElementById('btn-copy-confirm-yes');
        if (yesBtn) {
            yesBtn.onclick = async () => {
                window.closeCopyConfirmModal();
                
                // 가격 정보를 불러와 1000만원 비중 대비 수량(quantity) 계산
                try {
                    const pricePromises = selectedRecPortfolio.items.map(item => getStockCurrentPriceAndCurrency(item.symbol, item.exchange));
                    const priceResults = await Promise.all(pricePromises);

                    portfolio = selectedRecPortfolio.items.map((item, index) => {
                        const { price, currency } = priceResults[index];
                        const krwRate = getKrwExchangeRate(currency);
                        const priceKrw = price * krwRate;
                        
                        const targetKrwVal = 10000000 * (item.weight / 100);
                        let quantity = priceKrw > 0 ? Math.round(targetKrwVal / priceKrw) : 1;
                        if (quantity <= 0) quantity = 1;
                        
                        return {
                            symbol: item.symbol,
                            name: item.name,
                            weight: item.weight,
                            exchange: item.exchange,
                            quantity: quantity
                        };
                    });

                    savePortfolio();
                    
                    if (typeof renderPortfolioModal === 'function') {
                        await renderPortfolioModal();
                    }
                    
                    window.selectAnalysisTarget('my');
                    window.switchSubTab('analysis');
                    
                    setTimeout(() => {
                        showToast('추천 포트폴리오가 내 포트폴리오로 복사되었습니다!', 'success');
                    }, 100);
                    
                    if (typeof triggerGoogleDriveSync === 'function') {
                        triggerGoogleDriveSync();
                    }
                } catch (err) {
                    console.error("Failed to copy recommended portfolio:", err);
                    showToast("추천 포트폴리오 복사 중 오류가 발생했습니다.", "error");
                }
                    

            };
        }
    };

    window.closeCopyConfirmModal = function() {
        const modal = document.getElementById('portfolio-copy-confirm-modal');
        if (modal) modal.classList.remove('active');
    };

    // 포트폴리오 분석 탭 타겟 전환
    window.selectAnalysisTarget = async function(target) {
        selectedAnalysisTarget = target;
        
        const btnMy = document.getElementById('btn-select-my-portfolio');
        const btnRec = document.getElementById('btn-select-rec-portfolio');
        
        if (target === 'my') {
            if (btnMy) btnMy.classList.add('active');
            if (btnRec) btnRec.classList.remove('active');
        } else {
            if (btnMy) btnMy.classList.remove('active');
            if (btnRec) btnRec.classList.add('active');
        }

        // 비중 차트 및 성과 시계열 차트 갱신
        if (typeof runPortfolioAnalysis === 'function') {
            await runPortfolioAnalysis();
        } else if (typeof renderAnalysisChartOnly === 'function') {
            renderAnalysisChartOnly();
        }
        renderPortfolioWeightCharts();
    };

    // 포트폴리오 시작/현재 비중 파이 차트 렌더러
    function renderPortfolioWeightCharts() {
        const startCanvas = document.getElementById('chart-weight-start');
        const currentCanvas = document.getElementById('chart-weight-current');
        const colors = ['#ff4b60', '#ff8838', '#ffc72c', '#00e676', '#00b0ff', '#3d5afe', '#d500f9', '#ff4081', '#00f2fe', '#4facfe'];

        const targetData = selectedAnalysisTarget === 'my' ? portfolio : selectedRecPortfolio.items;

        if (targetData.length === 0) {
            // 빈 상태 처리
            if (startCanvas) {
                const ctx = startCanvas.getContext('2d');
                ctx.clearRect(0, 0, startCanvas.width, startCanvas.height);
            }
            if (currentCanvas) {
                const ctx = currentCanvas.getContext('2d');
                ctx.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
            }
            return;
        }

        const labels = targetData.map(item => item.symbol);
        const data = targetData.map(item => item.weight);

        if (startCanvas) {
            if (weightStartChart) weightStartChart.destroy();
            weightStartChart = new Chart(startCanvas.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors.slice(0, labels.length),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: '#cbd5e1', font: { size: 10 } }
                        }
                    }
                }
            });
        }

        if (currentCanvas) {
            if (weightCurrentChart) weightCurrentChart.destroy();
            weightCurrentChart = new Chart(currentCanvas.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors.slice(0, labels.length),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: '#cbd5e1', font: { size: 10 } }
                        }
                    }
                }
            });
        }
    }

    // 비교 분석 섹션 토글 및 차트 렌더링
    window.togglePortfolioComparison = async function() {
        const comparisonSection = document.getElementById('comparison-results-panel');
        if (!comparisonSection) return;

        const isHidden = comparisonSection.style.display === 'none' || comparisonSection.style.display === '';
        comparisonSection.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            await runPortfolioComparisonAnalysis();
        }
    };

    // 비교 분석 백테스팅 및 UI 업데이트
    async function runPortfolioComparisonAnalysis() {
        // 내 포트폴리오
        const myMetrics = await calculatePortfolioMetrics(portfolio);
        // 추천 포트폴리오
        const recMetrics = await calculatePortfolioMetrics(selectedRecPortfolio.items);

        // UI 업데이트: 내 포트폴리오
        if (myMetrics) {
            document.getElementById('comp-my-return').innerText = `${myMetrics.totalReturn >= 0 ? '+' : ''}${myMetrics.totalReturn.toFixed(1)}%`;
            document.getElementById('comp-my-return').style.color = myMetrics.totalReturn >= 0 ? 'var(--bullish)' : 'var(--bearish)';
            
            if (myMetrics.years >= 0.95) {
                document.getElementById('comp-my-cagr').innerText = `${myMetrics.cagr >= 0 ? '+' : ''}${myMetrics.cagr.toFixed(1)}%`;
                document.getElementById('comp-my-cagr').style.color = myMetrics.cagr >= 0 ? 'var(--bullish)' : 'var(--bearish)';
            } else {
                document.getElementById('comp-my-cagr').innerText = `N/A (1년 미만)`;
                document.getElementById('comp-my-cagr').style.color = 'var(--text-muted)';
            }

            document.getElementById('comp-my-mdd').innerText = `-${myMetrics.mdd.toFixed(1)}%`;
            document.getElementById('comp-my-mdd').style.color = 'var(--bearish)';

            const myExDetail = document.getElementById('comp-my-exchange-detail');
            if (myExDetail) {
                myExDetail.innerHTML = renderExchangeDetailHtml(myMetrics);
            }
        } else {
            document.getElementById('comp-my-return').innerText = '--';
            document.getElementById('comp-my-cagr').innerText = '--';
            document.getElementById('comp-my-mdd').innerText = '--';
            const myExDetail = document.getElementById('comp-my-exchange-detail');
            if (myExDetail) myExDetail.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 8px 0;">내 포트폴리오에 등록된 종목이 없습니다.</div>';
        }

        // UI 업데이트: 추천 포트폴리오
        if (recMetrics) {
            document.getElementById('comp-rec-return').innerText = `${recMetrics.totalReturn >= 0 ? '+' : ''}${recMetrics.totalReturn.toFixed(1)}%`;
            document.getElementById('comp-rec-return').style.color = recMetrics.totalReturn >= 0 ? 'var(--bullish)' : 'var(--bearish)';
            
            if (recMetrics.years >= 0.95) {
                document.getElementById('comp-rec-cagr').innerText = `${recMetrics.cagr >= 0 ? '+' : ''}${recMetrics.cagr.toFixed(1)}%`;
                document.getElementById('comp-rec-cagr').style.color = recMetrics.cagr >= 0 ? 'var(--bullish)' : 'var(--bearish)';
            } else {
                document.getElementById('comp-rec-cagr').innerText = `N/A (1년 미만)`;
                document.getElementById('comp-rec-cagr').style.color = 'var(--text-muted)';
            }

            document.getElementById('comp-rec-mdd').innerText = `-${recMetrics.mdd.toFixed(1)}%`;
            document.getElementById('comp-rec-mdd').style.color = 'var(--bearish)';

            const recExDetail = document.getElementById('comp-rec-exchange-detail');
            if (recExDetail) {
                recExDetail.innerHTML = renderExchangeDetailHtml(recMetrics);
            }
        }

        // 파이 차트 렌더링
        renderComparisonCharts();
    }

    // 포트폴리오 비교 분석 파이 차트 렌더러
    function renderComparisonCharts() {
        const myCanvas = document.getElementById('chart-comp-my-pie');
        const recCanvas = document.getElementById('chart-comp-rec-pie');
        const colors = ['#ff4b60', '#ff8838', '#ffc72c', '#00e676', '#00b0ff', '#3d5afe', '#d500f9', '#ff4081', '#00f2fe', '#4facfe'];

        if (myCanvas) {
            if (compMyPieChart) compMyPieChart.destroy();
            
            const labels = portfolio.map(item => item.symbol);
            const data = portfolio.map(item => item.weight);
            
            compMyPieChart = new Chart(myCanvas.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors.slice(0, labels.length),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        }

        if (recCanvas) {
            if (compRecPieChart) compRecPieChart.destroy();
            
            const labels = selectedRecPortfolio.items.map(item => item.symbol);
            const data = selectedRecPortfolio.items.map(item => item.weight);
            
            compRecPieChart = new Chart(recCanvas.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors.slice(0, labels.length),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        }
    }

    async function initializeDashboard() {
        renderRecommendedPortfolioCards();
        initGaugeTicks();
        initPortfolioModalControls();

        // 1. 차트와 초기 UI를 먼저 즉시 로드 (사용자 대기 차단 방지)
        initMarketSummaryChart();
        initHistoricalChart();
        initDollarBasisChart();
        bindClickVerificationLinks();
        startRealtimeTickLoop();

        Object.keys(travelExchangeRates).forEach(key => {
            calculateTravelExchange(key);
        });
        calculateTravelExchange('krw');

        document.querySelectorAll('.insight-item').forEach(item => {
            item.addEventListener('click', () => {
                item.classList.toggle('active');
            });
        });

        if (typeof window.switchSubTab === 'function') {
            window.switchSubTab('search');
        }

        // 2. 실시간 웹 API 연동은 백그라운드 비동기로 점진적 갱신
        refreshRealData();
    }

    function initTimeframeButtons() {
        const summaryModeBtns = document.querySelectorAll('#summary-mode-toggle .mode-btn');
        summaryModeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                summaryModeBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentSummaryMode = e.target.getAttribute('data-mode');
                initMarketSummaryChart(currentSummaryPeriod, true);
            });
        });
        
        const summaryBtns = document.querySelectorAll('#summary-timeframe-buttons .time-btn');
        summaryBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                summaryBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentSummaryPeriod = e.target.getAttribute('data-period');
                initMarketSummaryChart(currentSummaryPeriod, false);
            });
        });

        const detailModeBtns = document.querySelectorAll('#detail-mode-toggle .mode-btn');
        detailModeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!currentTickerState.symbol) return;
                detailModeBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentDetailMode = e.target.getAttribute('data-mode');
                loadTickerDetail(currentTickerState.symbol, currentTickerState.name, currentTickerState.exchange, currentDetailPeriod, true);
            });
        });

        const detailBtns = document.querySelectorAll('#detail-timeframe-buttons .time-btn');
        detailBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!currentTickerState.symbol) return;
                detailBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const p = e.target.getAttribute('data-period');
                loadTickerDetail(currentTickerState.symbol, currentTickerState.name, currentTickerState.exchange, p, false);
            });
        });

        const prevBtn = document.getElementById('summary-slide-prev');
        const nextBtn = document.getElementById('summary-slide-next');
        const titleEl = document.getElementById('market-slide-title');

        function animateChart(direction) {
            const container = document.querySelector('.market-summary-box');
            if(container) {
                container.classList.remove('slide-anim-left', 'slide-anim-right');
                void container.offsetWidth;
                container.classList.add(direction === 'left' ? 'slide-anim-left' : 'slide-anim-right');
            }
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                currentSummarySlideIndex = (currentSummarySlideIndex - 1 + marketSlides.length) % marketSlides.length;
                if(titleEl) titleEl.innerText = marketSlides[currentSummarySlideIndex].title;
                animateChart('left');
                initMarketSummaryChart('3mo', false);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                currentSummarySlideIndex = (currentSummarySlideIndex + 1) % marketSlides.length;
                if(titleEl) titleEl.innerText = marketSlides[currentSummarySlideIndex].title;
                animateChart('right');
                initMarketSummaryChart('3mo', false);
            });
        }
    }

    let loadedNewsList = [];

    const tickerMockData = {
        nasdaq: [
            { symbol: 'AAPL', name: 'Apple Inc.' },
            { symbol: 'TSLA', name: 'Tesla Inc.' },
            { symbol: 'MSFT', name: 'Microsoft Corp.' },
            { symbol: 'NVDA', name: 'NVIDIA Corp.' },
            { symbol: 'GOOGL', name: 'Alphabet Inc.' },
            { symbol: 'AMZN', name: 'Amazon.com Inc.' },
            { symbol: 'PLTR', name: 'Palantir Technologies Inc.' },
            { symbol: 'META', name: 'Meta Platforms, Inc.' },
            { symbol: 'NFLX', name: 'Netflix, Inc.' },
            { symbol: 'SPCX', name: 'Mock Stock SPCX', listingDate: '2025-12-01' }
        ],
        nyse: [
            { symbol: 'PLTR', name: 'Palantir Technologies Inc.' },
            { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Co.' },
            { symbol: 'BRK-B', name: 'Berkshire Hathaway Inc.' },
            { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
            { symbol: 'WMT', name: 'Walmart Inc.' },
            { symbol: 'XOM', name: 'Exxon Mobil Corp.' },
            { symbol: 'DIS', name: 'The Walt Disney Co.' }
        ],
        kospi: [
            { symbol: '005930', name: '삼성전자' },
            { symbol: '000660', name: 'SK하이닉스' },
            { symbol: '373220', name: 'LG에너지솔루션' },
            { symbol: '207940', name: '삼성바이오로직스' },
            { symbol: '005380', name: '현대차' },
            { symbol: '000270', name: '기아' },
            { symbol: '005490', name: 'POSCO홀딩스' },
            { symbol: '035420', name: 'NAVER' }
        ],
        kosdaq: [
            { symbol: '247540', name: '에코프로비엠' },
            { symbol: '086520', name: '에코프로' },
            { symbol: '028300', name: 'HLB' },
            { symbol: '068760', name: '셀트리온제약' },
            { symbol: '198440', name: '심텍' },
            { symbol: '293490', name: '카카오게임즈' }
        ],
        japan: [
            { symbol: '7203', name: '도요타 (Toyota)' },
            { symbol: '9984', name: '소프트뱅크 (SoftBank)' },
            { symbol: '6861', name: '키엔스 (Keyence)' },
            { symbol: '6758', name: '소니 (Sony)' },
            { symbol: '8306', name: '미쓰비시 UFJ' },
            { symbol: '9983', name: '패스트 리테일링 (Fast Retailing)' },
            { symbol: '8035', name: '도쿄 일렉트론 (Tokyo Electron)' }
        ]
    };

    function initTickerSearch() {
        const dropdownBtn = document.getElementById('exchange-dropdown-btn');
        const exchangeMenu = document.getElementById('exchange-dropdown-menu');
        const selectedExchangeText = document.getElementById('selected-exchange-text');
        const exchangeOptions = document.querySelectorAll('.exchange-option');
        
        const input = document.getElementById('ticker-search-input');
        const dropdown = document.getElementById('ticker-autocomplete-dropdown');
        const list = document.getElementById('ticker-autocomplete-list');
        
        if (!dropdownBtn || !exchangeMenu || !input || !dropdown || !list) return;

        let autocompleteHideTimer = null;
        let currentExchange = 'nasdaq';

        function hideAutocompleteDropdown() {
            if (autocompleteHideTimer) {
                clearTimeout(autocompleteHideTimer);
                autocompleteHideTimer = null;
            }
            dropdown.style.display = 'none';
        }

        function resetAutocompleteHideTimer() {
            if (autocompleteHideTimer) {
                clearTimeout(autocompleteHideTimer);
            }
            autocompleteHideTimer = setTimeout(() => {
                dropdown.style.display = 'none';
            }, 30000);
        }

        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = exchangeMenu.style.display === 'block';
            exchangeMenu.style.display = isExpanded ? 'none' : 'block';
            if (!isExpanded) {
                dropdownBtn.classList.add('active');
            } else {
                dropdownBtn.classList.remove('active');
            }
        });

        exchangeOptions.forEach(option => {
            option.addEventListener('click', () => {
                const exchange = option.dataset.exchange;
                const displayName = option.dataset.name;
                currentExchange = exchange;
                selectedExchangeText.innerText = displayName;
                exchangeMenu.style.display = 'none';
                dropdownBtn.classList.remove('active');
                input.value = '';
                hideAutocompleteDropdown();
            });
        });

        function detectExchange(symbol, apiExchange) {
            const symUpper = symbol.toUpperCase();
            for (const [ex, list] of Object.entries(tickerMockData)) {
                if (list.some(item => item.symbol.toUpperCase() === symUpper)) {
                    return ex;
                }
            }
            if (symUpper.endsWith('.KS')) return 'kospi';
            if (symUpper.endsWith('.KQ')) return 'kosdaq';
            if (symUpper.endsWith('.T')) return 'japan';
            if (apiExchange) {
                const exUpper = apiExchange.toUpperCase();
                if (exUpper.includes('NMS') || exUpper.includes('NAS') || exUpper.includes('NASDAQ')) return 'nasdaq';
                if (exUpper.includes('NYQ') || exUpper.includes('NYS') || exUpper.includes('NYSE') || exUpper.includes('ASE')) return 'nyse';
                if (exUpper.includes('TSE') || exUpper.includes('TYO') || exUpper.includes('JPX')) return 'japan';
                if (exUpper.includes('KSC') || exUpper.includes('KSE')) return 'kospi';
                if (exUpper.includes('KOE') || exUpper.includes('KSD') || exUpper.includes('KOSDAQ')) return 'kosdaq';
            }
            if (/^\d{6}$/.test(symUpper)) {
                if (currentExchange === 'kosdaq') return 'kosdaq';
                return 'kospi';
            }
            if (/^\d{4}$/.test(symUpper)) return 'japan';
            if (/^[A-Z.\-_]+$/.test(symUpper)) {
                if (currentExchange === 'nyse') return 'nyse';
                return 'nasdaq';
            }
            return 'unknown';
        }

        const performSearch = () => {
            const query = input.value.trim();
            if (query.length === 0) return;

            const allLocalData = [];
            const localList = tickerMockData[currentExchange] || [];
            localList.forEach(item => {
                allLocalData.push({
                    symbol: item.symbol,
                    name: item.name,
                    exchange: currentExchange
                });
            });

            let found = allLocalData.find(item => item.symbol.toUpperCase() === query.toUpperCase());
            
            if (!found) {
                found = allLocalData.find(item => item.name.toLowerCase() === query.toLowerCase());
            }

            if (!found) {
                const queryLower = query.toLowerCase();
                const filtered = allLocalData.filter(item => 
                    item.symbol.toLowerCase().includes(queryLower) || 
                    item.name.toLowerCase().includes(queryLower)
                );
                if (filtered.length > 0) {
                    found = filtered[0];
                }
            }

            if (found) {
                input.value = found.symbol;
                hideAutocompleteDropdown();
                
                const targetOption = document.querySelector(`.exchange-option[data-exchange="${found.exchange}"]`);
                if (targetOption) {
                    currentExchange = found.exchange;
                    selectedExchangeText.innerText = targetOption.dataset.name;
                }
                loadTickerDetail(found.symbol, found.name, found.exchange);
            } else {
                const isPossibleSymbol = /^[a-zA-Z0-9.\-_^]+$/.test(query);
                if (isPossibleSymbol) {
                    const symbolUpper = query.toUpperCase();
                    let isValidForExchange = false;
                    let detectedEx = currentExchange;

                    if (symbolUpper.endsWith('.T')) {
                        detectedEx = 'japan';
                        isValidForExchange = (currentExchange === 'japan');
                    } else if (symbolUpper.endsWith('.KS')) {
                        detectedEx = 'kospi';
                        isValidForExchange = (currentExchange === 'kospi');
                    } else if (symbolUpper.endsWith('.KQ')) {
                        detectedEx = 'kosdaq';
                        isValidForExchange = (currentExchange === 'kosdaq');
                    } else {
                        if (/^\d{6}$/.test(symbolUpper)) {
                            if (currentExchange === 'kospi' || currentExchange === 'kosdaq') {
                                isValidForExchange = true;
                                detectedEx = currentExchange;
                            }
                        } else if (/^\d{4}$/.test(symbolUpper)) {
                            if (currentExchange === 'japan') {
                                isValidForExchange = true;
                                detectedEx = 'japan';
                            }
                        } else if (/^[A-Z.\-_]+$/.test(symbolUpper)) {
                            if (currentExchange === 'nasdaq' || currentExchange === 'nyse') {
                                isValidForExchange = true;
                                detectedEx = currentExchange;
                            }
                        }
                    }

                    if (!isValidForExchange) {
                        const exchangeNames = {
                            nasdaq: '나스닥 (NASDAQ)',
                            nyse: '뉴욕증권거래소 (NYSE)',
                            kospi: '코스피 (KOSPI)',
                            kosdaq: '코스닥 (KOSDAQ)',
                            japan: '도쿄증권거래소 (TSE)'
                        };
                        alert(`선택하신 거래소(${exchangeNames[currentExchange]})에 맞지 않는 티커 형식입니다. 거래소를 확인하거나 올바른 코드를 입력해 주세요.`);
                        return;
                    }

                    hideAutocompleteDropdown();
                    
                    let cleanSymbol = symbolUpper;
                    if (cleanSymbol.endsWith('.T')) cleanSymbol = cleanSymbol.slice(0, -2);
                    else if (cleanSymbol.endsWith('.KS')) cleanSymbol = cleanSymbol.slice(0, -3);
                    else if (cleanSymbol.endsWith('.KQ')) cleanSymbol = cleanSymbol.slice(0, -3);
                    
                    const targetOption = document.querySelector(`.exchange-option[data-exchange="${detectedEx}"]`);
                    if (targetOption) {
                        currentExchange = detectedEx;
                        selectedExchangeText.innerText = targetOption.dataset.name;
                    }
                    
                    loadTickerDetail(cleanSymbol, cleanSymbol, detectedEx);
                } else {
                    alert(`'${query}'는 올바른 종목 코드 또는 티커 형식이 아닙니다.`);
                }
            }
        };

        let activeDropdownIndex = -1;
        let currentFilteredList = [];
        let autocompleteTimeout = null;

        const getEnglishName = (name) => {
            const match = name.match(/\(([^)]+)\)/);
            return match ? match[1].trim() : name;
        };

        const updateActiveItemHighlight = () => {
            const items = list.querySelectorAll('.autocomplete-item');
            items.forEach((item, index) => {
                if (index === activeDropdownIndex) {
                    item.classList.add('active');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('active');
                }
            });
        };

        const renderDropdownList = (filtered) => {
            list.innerHTML = '';
            if (filtered.length > 0) {
                filtered.forEach((item, index) => {
                    const li = document.createElement('li');
                    li.className = 'autocomplete-item';
                    if (index === activeDropdownIndex) {
                        li.classList.add('active');
                    }
                    
                    const exchangeLabels = {
                        nasdaq: 'NASDAQ',
                        nyse: 'NYSE',
                        kospi: 'KOSPI',
                        kosdaq: 'KOSDAQ',
                        japan: 'TSE'
                    };
                    const exLabel = exchangeLabels[item.exchange] || item.exchange.toUpperCase();
                    
                    li.innerHTML = `<span class="ticker-symbol">[${item.symbol}]</span><span class="ticker-name" style="margin-left: 8px; flex: 1; text-align: left;">${item.name}</span><span class="exchange-badge" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #94a3b8; font-weight: bold; margin-left: 8px; border: 1px solid rgba(255,255,255,0.1);">${exLabel}</span>`;
                    
                    li.addEventListener('click', () => {
                        input.value = item.symbol;
                        hideAutocompleteDropdown();
                        const targetOption = document.querySelector(`.exchange-option[data-exchange="${item.exchange}"]`);
                        if (targetOption) {
                            currentExchange = item.exchange;
                            selectedExchangeText.innerText = targetOption.dataset.name;
                        }
                        loadTickerDetail(item.symbol, item.name, item.exchange);
                    });
                    
                    li.addEventListener('mouseenter', () => {
                        activeDropdownIndex = index;
                        updateActiveItemHighlight();
                    });
                    
                    list.appendChild(li);
                });
            } else {
                list.innerHTML = '<li class="no-result">검색 결과가 없습니다.</li>';
            }
            dropdown.style.display = 'block';
            resetAutocompleteHideTimer();
        };

        async function fetchAutocompleteSuggestions(query) {
            if (!query) return [];
            const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
            try {
                const data = await fetchWithProxyFallback(url);
                if (data && data.quotes) {
                    return data.quotes.map(q => ({
                        symbol: q.symbol,
                        name: q.longname || q.shortname || q.symbol,
                        apiExchange: q.exchange
                    }));
                }
            } catch (err) {
                console.warn("Failed to fetch autocomplete from Yahoo Finance:", err);
            }
            return [];
        }

        input.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            activeDropdownIndex = -1;
            currentFilteredList = [];

            if (query.length === 0) {
                hideAutocompleteDropdown();
                return;
            }
            resetAutocompleteHideTimer();

            const allLocalData = [];
            const localList = tickerMockData[currentExchange] || [];
            localList.forEach(item => {
                allLocalData.push({
                    symbol: item.symbol,
                    name: item.name,
                    exchange: currentExchange
                });
            });
            
            let filtered = allLocalData.filter(item => {
                const symbolMatch = item.symbol.toLowerCase().includes(query);
                const nameMatch = item.name.toLowerCase().includes(query);
                const engName = getEnglishName(item.name).toLowerCase();
                const engMatch = engName.includes(query);
                
                return symbolMatch || nameMatch || engMatch;
            });

            filtered.sort((a, b) => {
                const aEng = getEnglishName(a.name).toLowerCase();
                const bEng = getEnglishName(b.name).toLowerCase();

                const aEngStarts = aEng.startsWith(query) ? 1 : 0;
                const bEngStarts = bEng.startsWith(query) ? 1 : 0;
                if (aEngStarts !== bEngStarts) return bEngStarts - aEngStarts;

                const aSymStarts = a.symbol.toLowerCase().startsWith(query) ? 1 : 0;
                const bSymStarts = b.symbol.toLowerCase().startsWith(query) ? 1 : 0;
                if (aSymStarts !== bSymStarts) return bSymStarts - aSymStarts;

                const aNameStarts = a.name.toLowerCase().startsWith(query) ? 1 : 0;
                const bNameStarts = b.name.toLowerCase().startsWith(query) ? 1 : 0;
                if (aNameStarts !== bNameStarts) return bNameStarts - aNameStarts;

                return 0;
            });

            currentFilteredList = filtered;
            renderDropdownList(filtered);

            clearTimeout(autocompleteTimeout);
            autocompleteTimeout = setTimeout(async () => {
                if (query.length < 1) return;
                
                const apiSuggestions = await fetchAutocompleteSuggestions(query);
                const seenSymbols = new Set(filtered.map(item => item.symbol.toLowerCase()));
                const combined = [...filtered];
                
                apiSuggestions.forEach(item => {
                    const symLower = item.symbol.toLowerCase();
                    if (!seenSymbols.has(symLower)) {
                        const detectedEx = detectExchange(item.symbol, item.apiExchange);
                        
                        if (detectedEx !== currentExchange) return;
                        
                        seenSymbols.add(symLower);
                        
                        let displaySymbol = item.symbol;
                        if (displaySymbol.endsWith('.T')) displaySymbol = displaySymbol.slice(0, -2);
                        else if (displaySymbol.endsWith('.KS')) displaySymbol = displaySymbol.slice(0, -3);
                        else if (displaySymbol.endsWith('.KQ')) displaySymbol = displaySymbol.slice(0, -3);

                        combined.push({
                            symbol: displaySymbol,
                            name: item.name,
                            exchange: detectedEx
                        });
                    }
                });

                currentFilteredList = combined;
                renderDropdownList(combined);
            }, 350);
        });

        input.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.autocomplete-item');
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length > 0) {
                    activeDropdownIndex = (activeDropdownIndex + 1) % items.length;
                    updateActiveItemHighlight();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length > 0) {
                    activeDropdownIndex = (activeDropdownIndex - 1 + items.length) % items.length;
                    updateActiveItemHighlight();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeDropdownIndex >= 0 && activeDropdownIndex < currentFilteredList.length) {
                    const selectedItem = currentFilteredList[activeDropdownIndex];
                    input.value = selectedItem.symbol;
                    dropdown.style.display = 'none';
                    
                    const targetOption = document.querySelector(`.exchange-option[data-exchange="${selectedItem.exchange}"]`);
                    if (targetOption) {
                        currentExchange = selectedItem.exchange;
                        selectedExchangeText.innerText = targetOption.dataset.name;
                    }
                    loadTickerDetail(selectedItem.symbol, selectedItem.name, selectedItem.exchange);
                } else if (currentFilteredList.length > 0) {
                    const selectedItem = currentFilteredList[0];
                    input.value = selectedItem.symbol;
                    dropdown.style.display = 'none';
                    
                    const targetOption = document.querySelector(`.exchange-option[data-exchange="${selectedItem.exchange}"]`);
                    if (targetOption) {
                        currentExchange = selectedItem.exchange;
                        selectedExchangeText.innerText = targetOption.dataset.name;
                    }
                    loadTickerDetail(selectedItem.symbol, selectedItem.name, selectedItem.exchange);
                } else {
                    performSearch();
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
                input.blur();
            }
        });

        const searchIcon = document.querySelector('.search-icon');
        if (searchIcon) {
            searchIcon.style.cursor = 'pointer';
            searchIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                performSearch();
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ticker-input-area')) {
                dropdown.style.display = 'none';
            }
            if (!e.target.closest('.exchange-dropdown-container')) {
                exchangeMenu.style.display = 'none';
                dropdownBtn.classList.remove('active');
            }
        });
    }

    let currentTickerState = { symbol: '', name: '', exchange: '' };
    let currentDetailPeriod = '5y';
    let currentDetailMode = 'line';
    let currentDetailData = null;
    let averageFetchTimeMs = 1500;

    const mockFinancialData = {
        'AAPL': {
            financials: [
                { endDate: '2025-09-30', totalRevenue: 391030000, operatingIncome: 114300000, netIncome: 93740000 },
                { endDate: '2024-09-30', totalRevenue: 385600000, operatingIncome: 111800000, netIncome: 93740000 },
                { endDate: '2023-09-30', totalRevenue: 383285000, operatingIncome: 114301000, netIncome: 96995000 }
            ],
            dividend: { yield: 0.52, dps: 1.00, payoutRatio: 15.2, exDate: '2026-05-09', frequency: '분기 배당 (Quarterly)' }
        },
        'TSLA': {
            financials: [
                { endDate: '2025-12-31', totalRevenue: 96773000, operatingIncome: 8891000, netIncome: 13423000 },
                { endDate: '2024-12-31', totalRevenue: 96773000, operatingIncome: 8891000, netIncome: 13423000 },
                { endDate: '2023-12-31', totalRevenue: 96773000, operatingIncome: 8891000, netIncome: 14974000 }
            ],
            dividend: { yield: 0, dps: 0, payoutRatio: 0, exDate: 'N/A', frequency: 'N/A (무배당)' }
        },
        'MSFT': {
            financials: [
                { endDate: '2025-06-30', totalRevenue: 245120000, operatingIncome: 109000000, netIncome: 88000000 },
                { endDate: '2024-06-30', totalRevenue: 245120000, operatingIncome: 109000000, netIncome: 88000000 },
                { endDate: '2023-06-30', totalRevenue: 211915000, operatingIncome: 88523000, netIncome: 72361000 }
            ],
            dividend: { yield: 0.75, dps: 3.00, payoutRatio: 25.1, exDate: '2026-05-15', frequency: '분기 배당 (Quarterly)' }
        },
        'NVDA': {
            financials: [
                { endDate: '2025-01-31', totalRevenue: 96310000, operatingIncome: 55210000, netIncome: 48120000 },
                { endDate: '2024-01-31', totalRevenue: 60920000, operatingIncome: 32970000, netIncome: 29760000 },
                { endDate: '2023-01-31', totalRevenue: 26974000, operatingIncome: 4224000, netIncome: 4368000 }
            ],
            dividend: { yield: 0.04, dps: 0.04, payoutRatio: 1.2, exDate: '2026-06-11', frequency: '분기 배당 (Quarterly)' }
        },
        '005930': {
            financials: [
                { endDate: '2025-12-31', totalRevenue: 258935000000, operatingIncome: 6567000000, netIncome: 15413000000 },
                { endDate: '2024-12-31', totalRevenue: 258935000000, operatingIncome: 6567000000, netIncome: 15413000000 },
                { endDate: '2023-12-31', totalRevenue: 302231000000, operatingIncome: 43377000000, netIncome: 55654000000 }
            ],
            dividend: { yield: 2.15, dps: 1444, payoutRatio: 45.3, exDate: '2026-06-29', frequency: '분기 배당 (Quarterly)' }
        },
        '000660': {
            financials: [
                { endDate: '2025-12-31', totalRevenue: 32765000000, operatingIncome: -7730000000, netIncome: -9130000000 },
                { endDate: '2024-12-31', totalRevenue: 32765000000, operatingIncome: -7730000000, netIncome: -9130000000 },
                { endDate: '2023-12-31', totalRevenue: 44621000000, operatingIncome: 6809000000, netIncome: 2240000000 }
            ],
            dividend: { yield: 0.85, dps: 1200, payoutRatio: 15.0, exDate: '2026-06-29', frequency: '분기 배당 (Quarterly)' }
        }
    };

    function getMockFinancialsAndDividends(symbol, currentPrice, currency) {
        const symUpper = symbol.toUpperCase();
        if (mockFinancialData[symUpper]) {
            return mockFinancialData[symUpper];
        }
        
        const financials = [];
        let baseRev = currentPrice * (currency === 'KRW' || currency === 'JPY' ? 5000 : 5000000);
        for (let year = 2025; year >= 2023; year--) {
            baseRev = baseRev * (0.88 + Math.random() * 0.24);
            const opInc = baseRev * (0.06 + Math.random() * 0.16); 
            const netInc = opInc * (0.55 + Math.random() * 0.25);
            
            financials.push({
                endDate: `${year}-12-31`,
                totalRevenue: baseRev / 1000,
                operatingIncome: opInc / 1000,
                netIncome: netInc / 1000
            });
        }
        
        const hasDividend = Math.random() > 0.35;
        const yieldRate = hasDividend ? (0.6 + Math.random() * 4.4) : 0;
        const dps = hasDividend ? (currentPrice * (yieldRate / 100)) : 0;
        const payout = hasDividend ? (18 + Math.random() * 32) : 0;
        const exDateStr = hasDividend ? `2026-06-${Math.floor(10 + Math.random() * 19)}` : 'N/A';
        const freqStr = hasDividend ? '분기 배당 (Quarterly)' : 'N/A (무배당)';
        
        return {
            financials: financials,
            dividend: {
                yield: yieldRate,
                dps: dps,
                payoutRatio: payout,
                exDate: exDateStr,
                frequency: freqStr
            }
        };
    }

    function renderFinancialsAndDividends(symbol, name, incHistory, dividendData, currency) {
        const finContainer = document.getElementById('financial-statements-container');
        const finWrapper = document.getElementById('financial-table-wrapper');
        const divWrapper = document.getElementById('dividend-history-wrapper');
        
        if (!finContainer) return;
        
        if (finWrapper && incHistory && incHistory.length > 0) {
            let tableHTML = `<table class="financial-table">
                <thead>
                    <tr>
                        <th>회계연도(endDate)</th>
                        <th>매출액(Total Revenue)</th>
                        <th>영업이익(Operating Income)</th>
                        <th>당기순이익(Net Income)</th>
                    </tr>
                </thead>
                <tbody>`;
            
            incHistory.forEach(inc => {
                const dateStr = inc.endDate || 'N/A';
                const rev = inc.totalRevenue || 0;
                const opInc = inc.operatingIncome || 0;
                const netInc = inc.netIncome || 0;
                
                tableHTML += `<tr>
                    <td><strong>${dateStr}</strong></td>
                    <td>${formatNumber(rev, 0)} ${currency}</td>
                    <td class="${opInc < 0 ? 'negative' : (opInc > 0 ? 'positive' : '')}">${formatNumber(opInc, 0)} ${currency}</td>
                    <td class="${netInc < 0 ? 'negative' : (netInc > 0 ? 'positive' : '')}">${formatNumber(netInc, 0)} ${currency}</td>
                </tr>`;
            });
            
            tableHTML += '</tbody></table>';
            finWrapper.innerHTML = tableHTML;
        } else if (finWrapper) {
            finWrapper.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">재무 실적 데이터가 준비되지 않았습니다.</div>';
        }

        if (divWrapper && dividendData) {
            const hasDiv = dividendData.yield !== 'N/A' && parseFloat(dividendData.yield) > 0;
            const yieldVal = hasDiv ? formatNumber(parseFloat(dividendData.yield), 2) + '%' : 'N/A (무배당)';
            const dpsVal = hasDiv ? formatNumber(parseFloat(dividendData.dps), currency === 'KRW' || currency === 'JPY' ? 0 : 2) + ' ' + currency : '0.00 ' + currency;
            const payoutVal = hasDiv ? formatNumber(parseFloat(dividendData.payoutRatio), 1) + '%' : '0.0%';
            const exDateVal = dividendData.exDate || 'N/A';
            const freqVal = dividendData.frequency || 'N/A';

            divWrapper.innerHTML = `
                <div class="dividend-grid">
                    <div class="div-card">
                        <div class="div-label">연 배당수익률</div>
                        <div class="div-value" style="color: ${hasDiv ? 'var(--bullish)' : 'var(--text-secondary)'}">${yieldVal}</div>
                    </div>
                    <div class="div-card">
                        <div class="div-label">주당 배당금 (DPS)</div>
                        <div class="div-value">${dpsVal}</div>
                    </div>
                    <div class="div-card">
                        <div class="div-label">배당 성향</div>
                        <div class="div-value" style="color: var(--primary)">${payoutVal}</div>
                    </div>
                    <div class="div-card">
                        <div class="div-label">최근 배당락일</div>
                        <div class="div-value" style="font-size: 14px; margin-top: 2px;">${exDateVal}</div>
                    </div>
                    <div class="div-card">
                        <div class="div-label">배당 주기</div>
                        <div class="div-value" style="font-size: 15px; margin-top: 2px; color: var(--accent);">${freqVal}</div>
                    </div>
                </div>
            `;
        } else if (divWrapper) {
            divWrapper.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">배당 정보가 존재하지 않습니다.</div>';
        }
        
        finContainer.style.display = 'block';
    }

    function generateMockConsensus(currentPrice, currency, exchange) {
        const consensusBox = document.getElementById('detail-consensus-box');
        const consensusRating = document.getElementById('consensus-rating');
        const consensusTarget = document.getElementById('consensus-target');
        
        const isUp = Math.random() > 0.3;
        const rating = isUp ? 'BUY' : 'HOLD';
        const targetMultiplier = isUp ? (1.1 + Math.random() * 0.3) : (0.9 + Math.random() * 0.15);
        const targetPrice = currentPrice * targetMultiplier;
        
        if (consensusBox) {
            consensusRating.innerText = rating;
            consensusTarget.innerText = `${formatNumber(targetPrice, 2)} ${currency}`;
            consensusRating.style.color = isUp ? 'var(--bullish)' : 'var(--text-secondary)';
            consensusBox.style.display = 'block';
        }
        
        const pTarget = document.getElementById('panel-target-price');
        if (pTarget) pTarget.innerText = `${formatNumber(targetPrice, 2)} ${currency}`;
        
        const pMarker = document.getElementById('panel-rating-marker');
        if (pMarker) pMarker.style.left = isUp ? '75%' : '50%';
        
        const pVol = document.getElementById('panel-volume');
        if (pVol) pVol.innerText = formatNumber(Math.floor(1000000 + Math.random() * 5000000), 0);
        
        const pCap = document.getElementById('panel-mktcap');
        if (pCap) {
            const mktcapStr = currency === 'KRW' ? formatNumber(Math.floor(10000 + Math.random() * 50000), 0) + '억' : formatNumber(Math.floor(50 + Math.random() * 200), 1) + 'B';
            pCap.innerText = mktcapStr;
        }
        
        const pPer = document.getElementById('panel-per');
        if (pPer) pPer.innerText = formatNumber(10 + Math.random() * 30, 2);
        
        const pEps = document.getElementById('panel-eps');
        if (pEps) pEps.innerText = formatNumber(currentPrice / (10 + Math.random() * 30), 2);
        
        const pDiv = document.getElementById('panel-div');
        const simulatedDivRate = 0.5 + Math.random() * 4.5;
        if (pDiv) pDiv.innerText = formatNumber(simulatedDivRate, 2) + '%';
        
        const p52h = document.getElementById('panel-52high');
        if (p52h) p52h.innerText = formatNumber(currentPrice * (1 + Math.random() * 0.3), 2);
        
        const p52l = document.getElementById('panel-52low');
        if (p52l) p52l.innerText = formatNumber(currentPrice * (1 - Math.random() * 0.3), 2);
        
        const mockSymbol = currentTickerState.symbol || 'MOCK';
        const mockData = getMockFinancialsAndDividends(mockSymbol, currentPrice, currency);
        
        let formattedMockFin = mockData.financials.map(f => ({
            endDate: f.endDate,
            totalRevenue: f.totalRevenue,
            operatingIncome: f.operatingIncome,
            netIncome: f.netIncome
        }));

        const formattedMockDiv = {
            yield: mockData.dividend.yield || simulatedDivRate,
            dps: mockData.dividend.dps || (currentPrice * (simulatedDivRate / 100)),
            payoutRatio: mockData.dividend.payoutRatio || (15 + Math.random() * 30),
            exDate: mockData.dividend.exDate,
            frequency: mockData.dividend.frequency
        };

        renderFinancialsAndDividends(mockSymbol, currentTickerState.name, formattedMockFin, formattedMockDiv, currency);
    }

    function renderRelatedNews(symbol, name) {
        const detailNewsContainer = document.getElementById('detail-news-container');
        const detailNewsList = document.getElementById('detail-news-list');
        
        if (!detailNewsContainer || !detailNewsList) return;
        
        let related = (loadedNewsList || []).filter(n => 
            n.title.includes(name) || n.title.includes(symbol) || 
            n.summary.includes(name) || n.summary.includes(symbol)
        );
        
        if (related.length < 3) {
            const mockRelated = [
                {
                    title: `${name}, 글로벌 공급망 다변화 통해 올해 영업이익 극대화 전망`,
                    summary: `업계 소식통에 따르면 ${name}(${symbol})은 최근 공급망 다변화 정책에 따라 글로벌 부품 수급을 안정화하고 마진율을 대폭 개선할 계획인 것으로 전해졌습니다.`,
                    press: '머니투데이',
                    date: '1시간 전',
                    importance: 9
                },
                {
                    title: `${name} 주가 주요 저항선 돌파... 기관 매수세 유입 지속`,
                    summary: `금융투자업계에 따르면 외국인과 기관이 ${name}의 장기 성장 패러다임과 배당 성향 확대 가능성에 주목하며 매수세를 확대하고 있어 주가가 신고가 랠리를 달성했습니다.`,
                    press: '한국경제',
                    date: '4시간 전',
                    importance: 8
                },
                {
                    title: `${name}, 차세대 핵심 기술 실물 특허 공식 취득 발표`,
                    summary: `${name}은 자사 핵심 연구소에서 개발한 고효율 전력 제어 회로 및 친환경 작동 메커니즘 특허를 취득했다고 공시했습니다.`,
                    press: '연합뉴스',
                    date: '1일 전',
                    importance: 7
                }
            ];
            related = [...related, ...mockRelated];
        }
        
        related.sort((a, b) => b.importance - a.importance);
        const top3 = related.slice(0, 3);
        
        let html = '';
        top3.forEach(news => {
            const newsLink = news.link || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(name + " " + news.title)}`;
            html += `
                <div class="naver-news-card" style="padding: 14px; margin: 0; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); cursor: pointer;" onclick="window.open('${newsLink}', '_blank')">
                    <div>
                        <h4 class="news-card-title" style="font-size: 13.5px; margin-bottom: 6px;">
                            <a href="${newsLink}" target="_blank" onclick="event.stopPropagation();">${news.title}</a>
                        </h4>
                        <p class="news-card-summary" style="font-size: 11.5px; margin-bottom: 8px; -webkit-line-clamp: 2;">${news.summary}</p>
                    </div>
                    <div class="news-card-meta" style="padding-top: 6px; margin-top: 0; border-top: 1px solid rgba(255,255,255,0.02);">
                        <span class="news-card-press" style="color: var(--accent); font-weight: 500;">${news.press}</span>
                        <span class="news-card-date">${news.date}</span>
                    </div>
                </div>
            `;
        });
        detailNewsList.innerHTML = html;
        detailNewsContainer.style.display = 'block';
    }

    function getPeriodRange(period) {
        const now = Date.now();
        let min = now;
        switch (period) {
            case '1h': min = now - 60 * 60 * 1000; break;
            case '1d': min = now - 24 * 60 * 60 * 1000; break;
            case '1wk': min = now - 7 * 24 * 60 * 60 * 1000; break;
            case '1mo': min = now - 30 * 24 * 60 * 60 * 1000; break;
            case '3mo': min = now - 90 * 24 * 60 * 60 * 1000; break;
            case '6mo': min = now - 180 * 24 * 60 * 60 * 1000; break;
            case '1y': min = now - 365 * 24 * 60 * 60 * 1000; break;
            case '3y': min = now - 3 * 365 * 24 * 60 * 60 * 1000; break;
            case '5y': min = now - 5 * 365 * 24 * 60 * 60 * 1000; break;
            default: min = now - 5 * 365 * 24 * 60 * 60 * 1000;
        }
        return { min, max: now };
    }

    function generateMockHistoryForTicker(symbol, period, config) {
        const range = getPeriodRange(period);
        const now = Date.now();
        const listingTime = config.listingDate ? new Date(config.listingDate).getTime() : now - (365 * 24 * 60 * 60 * 1000);
        const openingPrice = config.openingPrice || 100;

        const data = [];
        let intervalMs = 24 * 60 * 60 * 1000;
        
        const startTime = Math.max(range.min, listingTime);
        let currentPrice = openingPrice;
        
        for (let t = startTime; t <= range.max; t += intervalMs) {
            const change = (Math.random() - 0.485) * 0.025 * currentPrice;
            const o = currentPrice;
            const c = currentPrice + change;
            const h = Math.max(o, c) + Math.random() * 0.01 * currentPrice;
            const l = Math.min(o, c) - Math.random() * 0.01 * currentPrice;
            
            data.push({
                x: t,
                o: o,
                h: h,
                l: l,
                c: c,
                v: Math.floor(Math.random() * 1000000 + 50000)
            });
            currentPrice = c;
        }

        if (data.length === 0) {
            data.push({ x: range.max, o: openingPrice, h: openingPrice, l: openingPrice, c: openingPrice, v: 0 });
        }
        return data;
    }

    // === Portfolio Feature Core Logic ===
    let portfolio = JSON.parse(localStorage.getItem('my_portfolio_items')) || [];
    let portfolioBacktestChart = null;
    let backtestPeriod = '5y';
    let simulationSeries = [];
    let latestIpoTime = 0;

    // Premium Toast Notification helper
    function showToast(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        
        const toast = document.createElement('div');
        toast.className = `toast-card ${type}`;
        
        let icon = 'ℹ️';
        if (type === 'success') icon = '✔️';
        else if (type === 'error') icon = '⚠️';
        
        toast.innerHTML = `<span style="font-size: 15px;">${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        
        // Auto remove after animation ends (3s total: 2.7s visible + 0.3s fadeout)
        setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, 3000);
    }

    // Dynamic UI count updater for the Portfolio header button
    function updatePortfolioHeaderBadge() {
        const btn = document.getElementById('my-portfolio-btn');
        if (btn) {
            if (portfolio.length > 0) {
                btn.innerHTML = `💼 내 포트폴리오 <span class="portfolio-count-badge">${portfolio.length}</span>`;
            } else {
                btn.innerHTML = `💼 내 포트폴리오`;
            }
        }
    }

    // Dynamic state updater for "Add to Portfolio" button inside Detailed Stock Analysis
    function updatePortfolioButtonState(symbol) {
        const addBtn = document.getElementById('add-to-portfolio-btn');
        if (!addBtn) return;
        
        if (!symbol) {
            addBtn.style.display = 'none';
            return;
        }
        
        const exists = portfolio.some(item => item.symbol.toUpperCase() === symbol.toUpperCase());
        if (exists) {
            addBtn.innerHTML = '✔️ 포트폴리오 담김';
            addBtn.classList.add('added');
        } else {
            addBtn.innerHTML = '➕ 포트폴리오 담기';
            addBtn.classList.remove('added');
        }
    }

    function savePortfolio() {
        localStorage.setItem('my_portfolio_items', JSON.stringify(portfolio));
        window.portfolio = portfolio;
        updatePortfolioHeaderBadge();
        if (currentTickerState && currentTickerState.symbol) {
            updatePortfolioButtonState(currentTickerState.symbol);
        }
    }

    function addToPortfolio(symbol, name, exchange) {
        const exists = portfolio.some(item => item.symbol.toUpperCase() === symbol.toUpperCase());
        if (exists) {
            showToast('이미 포트폴리오에 담겨있는 종목입니다.', 'error');
            return;
        }
        portfolio.push({ symbol, name, exchange, quantity: 1 });
        savePortfolio();
        showToast(`${name} 종목을 포트폴리오에 담았습니다.`, 'success');
    }

    // Get live exchange rate to KRW
    function getKrwExchangeRate(currency) {
        if (!currency || currency === 'KRW') return 1;
        const key = currency.toLowerCase();
        if (travelExchangeRates[key]) {
            return travelExchangeRates[key];
        }
        if (key === 'usd') return travelExchangeRates.usd;
        if (key === 'jpy') return travelExchangeRates.jpy;
        if (key === 'eur') return travelExchangeRates.eur;
        if (key === 'cny') return travelExchangeRates.cny;
        return 1;
    }


    async function renderPortfolioModal() {
        const listEl = document.getElementById('portfolio-items-list');
        if (!listEl) return;
        
        const headerEl = document.getElementById('portfolio-list-header');
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">포트폴리오 정보를 불러오는 중...</div>';
        if (headerEl) headerEl.style.display = 'none';

        if (portfolio.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">포트폴리오에 담긴 종목이 없습니다.</div>';
            return;
        }

        let html = '';
        const pricePromises = portfolio.map(item => getStockCurrentPriceAndCurrency(item.symbol, item.exchange));
        const priceResults = await Promise.all(pricePromises);

        if (headerEl) {
            headerEl.style.display = 'grid';
        }

        portfolio.forEach((item, index) => {
            const { price, currency } = priceResults[index];
            const krwRate = getKrwExchangeRate(currency);
            const totalKrwVal = price * item.quantity * krwRate;

            html += `
                <div class="portfolio-item" data-index="${index}">
                    <!-- 1열: 종목 정보 -->
                    <div class="portfolio-col portfolio-col-info">
                        <span class="portfolio-item-symbol">${item.symbol}</span>
                        <span class="portfolio-item-name-exch" title="${item.name}">${item.name} (${item.exchange.toUpperCase()})</span>
                    </div>
                    
                    <!-- 2열: 가격 및 평가금액 -->
                    <div class="portfolio-col portfolio-col-pricing">
                        <div class="price-row">
                            <span class="label">현재가:</span>
                            <span class="val price-val">${formatNumber(price, currency === 'KRW' || currency === 'JPY' ? 0 : 2)} ${currency}</span>
                        </div>
                        <div class="eval-row">
                            <span class="label">평가액:</span>
                            <span class="val eval-val" id="portfolio-item-krw-${index}">${formatNumber(totalKrwVal, 0)} 원</span>
                        </div>
                        <span class="rate-val">환율: 1 ${currency} = ${formatNumber(krwRate, 0)}원</span>
                    </div>
                    
                    <!-- 3열: 수량 조절 및 삭제 -->
                    <div class="portfolio-col portfolio-col-qty-action">
                        <div class="portfolio-qty-wrapper">
                            <button class="qty-btn minus-btn" data-index="${index}">-</button>
                            <input type="number" class="portfolio-qty-input" value="${item.quantity}" min="0" data-index="${index}">
                            <button class="qty-btn plus-btn" data-index="${index}">+</button>
                        </div>
                        <button class="portfolio-delete-btn" data-index="${index}">삭제</button>
                    </div>
                </div>
            `;
            item.cachedPrice = price;
            item.cachedCurrency = currency;
            item.cachedRate = krwRate;
        });

        listEl.innerHTML = html;

        // Plus/Minus button click handlers
        listEl.querySelectorAll('.qty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const button = e.target.closest('.qty-btn');
                if (!button) return;
                
                const idx = parseInt(button.getAttribute('data-index'));
                const isPlus = button.classList.contains('plus-btn');
                const inputEl = listEl.querySelector(`.portfolio-qty-input[data-index="${idx}"]`);
                if (!inputEl) return;
                
                let val = parseFloat(inputEl.value) || 0;
                val = isPlus ? val + 1 : Math.max(0, val - 1);
                
                inputEl.value = val;
                
                portfolio[idx].quantity = val;
                savePortfolio();
                
                const item = portfolio[idx];
                if (item.cachedPrice) {
                    const totalKrwVal = item.cachedPrice * val * item.cachedRate;
                    document.getElementById(`portfolio-item-krw-${idx}`).innerText = `${formatNumber(totalKrwVal, 0)} 원`;
                }
            });
        });

        listEl.querySelectorAll('.portfolio-qty-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.getAttribute('data-index'));
                const newQty = parseFloat(e.target.value) || 0;
                portfolio[idx].quantity = newQty;
                savePortfolio();

                const item = portfolio[idx];
                if (item.cachedPrice) {
                    const totalKrwVal = item.cachedPrice * newQty * item.cachedRate;
                    document.getElementById(`portfolio-item-krw-${idx}`).innerText = `${formatNumber(totalKrwVal, 0)} 원`;
                }
            });
        });

        listEl.querySelectorAll('.portfolio-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-index'));
                portfolio.splice(idx, 1);
                savePortfolio();
                renderPortfolioModal();
                const backtestSec = document.getElementById('portfolio-analysis-section');
                if (backtestSec) backtestSec.classList.remove('active');
            });
        });
    }

    function initPortfolioModalControls() {
        const modalEl = document.getElementById('portfolio-modal');
        const myPortfolioBtn = document.getElementById('my-portfolio-btn');
        const closeBtn1 = document.getElementById('close-portfolio-modal-btn');
        const closeBtn2 = document.getElementById('close-portfolio-modal-footer-btn');

        if (myPortfolioBtn && modalEl) {
            myPortfolioBtn.addEventListener('click', () => {
                modalEl.classList.add('active');
                const backtestSec = document.getElementById('portfolio-analysis-section');
                if (backtestSec) backtestSec.classList.remove('active');
                renderPortfolioModal();
            });
        }

        const closeModal = () => {
            if (modalEl) modalEl.classList.remove('active');
        };

        if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
        if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

        const analyzeBtn = document.getElementById('analyze-portfolio-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', async () => {
                await runPortfolioBacktest();
            });
        }

        document.querySelectorAll('#portfolio-backtest-timeframe .time-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('#portfolio-backtest-timeframe .time-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                backtestPeriod = e.target.getAttribute('data-period');
                await renderBacktestChartOnly();
            });
        });
    }

    // === Portfolio Analysis Sub-tab Logic ===
    let analysisPeriod = '10y';
    let analysisSimulationSeries = [];
    let analysisTimeSeriesChart = null;

    // Helper to calculate portfolio metrics using Common Start Date backtesting
    async function calculatePortfolioMetrics(targetData) {
        if (!targetData || targetData.length === 0) return null;

        // If it is the active portfolio, recalculate weights based on current price & quantity
        if (targetData === portfolio) {
            try {
                const pricePromises = portfolio.map(item => getStockCurrentPriceAndCurrency(item.symbol, item.exchange));
                const priceResults = await Promise.all(pricePromises);
                
                const values = portfolio.map((item, idx) => {
                    const price = priceResults[idx] ? priceResults[idx].price : 0;
                    const currency = priceResults[idx] ? priceResults[idx].currency : 'USD';
                    const rate = getKrwExchangeRate(currency);
                    const val = (price || 0) * (item.quantity || 0) * rate;
                    return isNaN(val) ? 0 : val;
                });
                
                const totalVal = values.reduce((sum, v) => sum + v, 0);
                portfolio.forEach((item, idx) => {
                    item.weight = totalVal > 0 ? (values[idx] / totalVal) * 100 : (100 / portfolio.length);
                });
                savePortfolio();
            } catch (e) {
                console.warn("Failed to dynamically recalculate portfolio weights:", e);
            }
        }

        // Load historical data for all tickers
        const historyPromises = targetData.map(item => fetchHistorical10yData(item.symbol, item.exchange));
        const historicalResults = await Promise.all(historyPromises);

        const now = Date.now();
        const weekMs = 7 * 24 * 60 * 60 * 1000;

        // 1. Calculate Common Start Date (latest start date among all tickers)
        let latestStartDate = 0;
        historicalResults.forEach(res => {
            if (res.history && res.history.length > 0) {
                if (res.history[0].time > latestStartDate) {
                    latestStartDate = res.history[0].time;
                }
            }
        });

        if (latestStartDate === 0) {
            latestStartDate = now - 10 * 365 * 24 * 60 * 60 * 1000;
        }

        // 2. Build timeGrid starting from latestStartDate
        const availableMs = now - latestStartDate;
        const steps = Math.min(520, Math.floor(availableMs / weekMs));
        const timeGrid = [];
        for (let i = steps; i >= 0; i--) {
            timeGrid.push(now - (i * weekMs));
        }

        // 3. Compute portfolio value series
        const simulationSeries = timeGrid.map(t => {
            let totalValueKrw = 0;
            targetData.forEach((item, index) => {
                const { history, currency } = historicalResults[index];
                let priceAtT = 0;
                if (history && history.length > 0) {
                    if (t < history[0].time) {
                        priceAtT = 0;
                    } else {
                        const closest = history.reduce((prev, curr) => {
                            return (Math.abs(curr.time - t) < Math.abs(prev.time - t) ? curr : prev);
                        });
                        priceAtT = closest.price;
                    }
                }

                let rateAtT = 1;
                if (currency !== 'KRW') {
                    const currentRate = getKrwExchangeRate(currency);
                    const yearsAgo = (now - t) / (365 * 24 * 60 * 60 * 1000);
                    const historicalWalk = 1 + (Math.sin(yearsAgo) * 0.08);
                    rateAtT = currentRate * historicalWalk;
                }

                totalValueKrw += priceAtT * item.weight * 1000 * rateAtT;
            });

            return { x: t, y: totalValueKrw };
        });

        // 4. Calculate metrics
        const startVal = simulationSeries[0].y;
        const endVal = simulationSeries[simulationSeries.length - 1].y;

        let totalReturn = 0;
        let cagr = 0;
        let mdd = 0;
        const years = (now - latestStartDate) / (365 * 24 * 60 * 60 * 1000);

        if (startVal > 0) {
            totalReturn = ((endVal - startVal) / startVal) * 100;
            cagr = years > 0.1 ? (Math.pow(endVal / startVal, 1 / years) - 1) * 100 : totalReturn;

            let maxVal = -Infinity;
            let maxDrawdown = 0;
            simulationSeries.forEach(d => {
                if (d.y > maxVal) maxVal = d.y;
                const dd = maxVal > 0 ? (maxVal - d.y) / maxVal : 0;
                if (dd > maxDrawdown) maxDrawdown = dd;
            });
            mdd = maxDrawdown * 100;

            // Normalize to 1,000만원 starting value
            const scaleFactor = 10000000 / startVal;
            simulationSeries.forEach(d => {
                d.y = d.y * scaleFactor;
            });
        }

        const startUsdKrwRate = getKrwExchangeRate('USD') * (1 + Math.sin(10) * 0.08);
        const endUsdKrwRate = getKrwExchangeRate('USD');
        const startKrw = 10000000;
        const startUsd = startKrw / startUsdKrwRate;
        const endKrw = endVal * (startVal > 0 ? (10000000 / startVal) : 1);
        const endUsd = endKrw / endUsdKrwRate;
        const endKrwHedged = endUsd * startUsdKrwRate;
        const exchangeEffect = endKrw - endKrwHedged;

        return {
            simulationSeries,
            totalReturn,
            cagr,
            mdd,
            years,
            latestStartDate,
            startUsdKrwRate,
            endUsdKrwRate,
            startKrw,
            startUsd,
            endKrw,
            endUsd,
            endKrwHedged,
            exchangeEffect
        };
    }

    async function runPortfolioAnalysis() {
        const targetData = selectedAnalysisTarget === 'my' ? portfolio : selectedRecPortfolio.items;
        
        const metricsGrid = document.getElementById('analysis-metrics-grid');
        const chartCard = document.getElementById('analysis-chart-card');
        const exDetailCard = document.getElementById('analysis-exchange-detail-card');
        const weightsRow = document.getElementById('analysis-weights-row');

        if (!targetData || targetData.length === 0) {
            // 데이터가 없으면 비우고 감춤
            if (metricsGrid) metricsGrid.style.display = 'none';
            if (chartCard) chartCard.style.display = 'none';
            if (exDetailCard) exDetailCard.style.display = 'none';
            if (weightsRow) weightsRow.style.display = 'none';
            
            const myStatus = document.getElementById('my-portfolio-status');
            if (myStatus) myStatus.innerText = "0개 종목";
            return;
        }

        // 컨테이너 보이기
        if (metricsGrid) metricsGrid.style.display = 'grid';
        if (chartCard) chartCard.style.display = 'block';
        if (exDetailCard) exDetailCard.style.display = 'block';
        if (weightsRow) weightsRow.style.display = 'grid';

        // 분석 상태 레이블 갱신
        const myStatus = document.getElementById('my-portfolio-status');
        if (myStatus) {
            myStatus.innerText = `${portfolio.length}개 종목`;
        }
        const recStatus = document.getElementById('rec-portfolio-status');
        if (recStatus) {
            recStatus.innerText = selectedRecPortfolio.name;
        }

        const metrics = await calculatePortfolioMetrics(targetData);
        if (!metrics) return;

        analysisSimulationSeries = metrics.simulationSeries;

        // 최근 상장 종목 포함 여부에 따른 데이터 제한 알림 처리
        const noticeEl = document.getElementById('analysis-data-notice');
        const noticeTextEl = document.getElementById('analysis-data-notice-text');
        const now = Date.now();

        let isConstrained = false;
        let constrainedTickerNames = [];

        // Check if any ticker started trading less than 9.5 years ago
        for (let i = 0; i < targetData.length; i++) {
            const item = targetData[i];
            const result = await fetchHistorical10yData(item.symbol, item.exchange);
            if (result.history && result.history.length > 0) {
                const firstTime = result.history[0].time;
                if (firstTime > now - 9.5 * 365 * 24 * 60 * 60 * 1000) {
                    isConstrained = true;
                    constrainedTickerNames.push(`${item.name || item.symbol} (${item.symbol})`);
                }
            }
        }

        if (isConstrained && noticeEl && noticeTextEl) {
            const durationMs = now - metrics.latestStartDate;
            const durationYears = durationMs / (365 * 24 * 60 * 60 * 1000);
            let durationText = '';
            if (durationYears >= 1) {
                durationText = `${durationYears.toFixed(1)}년`;
            } else {
                durationText = `${Math.round(durationMs / (30 * 24 * 60 * 60 * 1000))}개월`;
            }
            noticeTextEl.innerText = `최근 상장된 종목(${constrainedTickerNames.join(', ')})이 포함되어 분석 기간이 약 ${durationText}로 단축되었습니다. 공통 상장 기간 기준 분석 결과를 표시합니다.`;
            noticeEl.style.display = 'flex';
        } else if (noticeEl) {
            noticeEl.style.display = 'none';
        }

        // 성적 메트릭 UI 업데이트
        const returnEl = document.getElementById('analysis-metric-return');
        const cagrEl = document.getElementById('analysis-metric-cagr');
        const mddEl = document.getElementById('analysis-metric-mdd');

        if (returnEl) {
            returnEl.innerText = `${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn.toFixed(1)}%`;
            returnEl.style.color = metrics.totalReturn >= 0 ? 'var(--bullish)' : 'var(--bearish)';
        }
        if (cagrEl) {
            if (metrics.years >= 0.95) {
                cagrEl.innerText = `${metrics.cagr >= 0 ? '+' : ''}${metrics.cagr.toFixed(1)}%`;
                cagrEl.style.color = metrics.cagr >= 0 ? 'var(--bullish)' : 'var(--bearish)';
            } else {
                cagrEl.innerText = `N/A (1년 미만)`;
                cagrEl.style.color = 'var(--text-muted)';
            }
        }
        if (mddEl) {
            mddEl.innerText = `-${metrics.mdd.toFixed(1)}%`;
            mddEl.style.color = 'var(--bearish)';
        }

        // 환율 요약 UI 업데이트
        const exStartKrwEl = document.getElementById('analysis-ex-start-krw');
        const exStartDetailsEl = document.getElementById('analysis-ex-start-details');
        const exEndKrwEl = document.getElementById('analysis-ex-end-krw');
        const exEndDetailsEl = document.getElementById('analysis-ex-end-details');
        const exHedgedKrwEl = document.getElementById('analysis-ex-hedged-krw');
        const exEffectKrwEl = document.getElementById('analysis-ex-effect-krw');

        if (exStartKrwEl) exStartKrwEl.innerText = `${Math.round(metrics.startKrw).toLocaleString()} 원`;
        if (exStartDetailsEl) exStartDetailsEl.innerText = `$${Math.round(metrics.startUsd).toLocaleString()} USD (당시 환율: ${Math.round(metrics.startUsdKrwRate)}원)`;
        if (exEndKrwEl) exEndKrwEl.innerText = `${Math.round(metrics.endKrw).toLocaleString()} 원`;
        if (exEndDetailsEl) exEndDetailsEl.innerText = `$${Math.round(metrics.endUsd).toLocaleString()} USD (현재 환율: ${Math.round(metrics.endUsdKrwRate)}원)`;
        if (exHedgedKrwEl) exHedgedKrwEl.innerText = `${Math.round(metrics.endKrwHedged).toLocaleString()} 원`;
        
        if (exEffectKrwEl) {
            const effectSign = metrics.exchangeEffect >= 0 ? '+' : '';
            const effectPct = ((metrics.endKrw - metrics.endKrwHedged) / metrics.endKrwHedged * 100);
            exEffectKrwEl.innerText = `${effectSign}${Math.round(metrics.exchangeEffect).toLocaleString()} 원 (${effectSign}${effectPct.toFixed(1)}%)`;
            exEffectKrwEl.style.color = metrics.exchangeEffect >= 0 ? 'var(--bullish)' : 'var(--bearish)';
        }

        await renderAnalysisChartOnly();
        renderPortfolioWeightCharts();
    }

    async function loadTickerDetail(symbol, name, exchange, period = currentDetailPeriod, useCached = false) {
        currentTickerState = { symbol, name, exchange };
        currentDetailPeriod = period;
        
        window.switchTab('detail');
        
        const titleEl = document.getElementById('detail-title');
        const exchangeBadge = document.getElementById('detail-exchange');
        const priceBox = document.getElementById('detail-price-box');
        const loadingIndicator = document.getElementById('detail-loading-overlay');
        const chartWrapper = document.getElementById('detail-chart-wrapper');
        const priceEl = document.getElementById('detail-price');
        const changeEl = document.getElementById('detail-change');
        
        const detailMainLayout = document.getElementById('detail-main-layout');
        if (detailMainLayout) {
            detailMainLayout.style.display = 'grid';
        }
 
        titleEl.innerText = `${name} (${symbol})`;
        exchangeBadge.innerText = exchange.toUpperCase();
        
        // Show Add to Portfolio button when stock is loaded
        updatePortfolioButtonState(symbol);
        const addBtn = document.getElementById('add-to-portfolio-btn');
        if (addBtn) {
            addBtn.style.display = 'inline-flex';
            addBtn.onclick = (e) => {
                e.stopPropagation();
                
                const exists = portfolio.some(item => item.symbol.toUpperCase() === symbol.toUpperCase());
                if (exists) {
                    // Remove from portfolio (toggle behavior)
                    const index = portfolio.findIndex(item => item.symbol.toUpperCase() === symbol.toUpperCase());
                    if (index !== -1) {
                        portfolio.splice(index, 1);
                        savePortfolio();
                        showToast(`${name} 종목을 포트폴리오에서 제외했습니다.`, 'error');
                        
                        // If portfolio modal is open, re-render it
                        const modalEl = document.getElementById('portfolio-modal');
                        if (modalEl && modalEl.classList.contains('active')) {
                            renderPortfolioModal();
                        }
                    }
                } else {
                    // Add to portfolio
                    addToPortfolio(symbol, name, exchange);
                }
            };
        }
        

        
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
        }
        
        let mockConfig = null;
        for (const ex in tickerMockData) {
            const found = tickerMockData[ex].find(s => s.symbol === symbol.toUpperCase());
            if (found) {
                mockConfig = found;
                break;
            }
        }
        const isMockStock = (symbol.toUpperCase() === 'SPCX');
 
        if (isMockStock) {
            const listingDate = (mockConfig && mockConfig.listingDate) || '2025-12-01';
            const validData = generateMockHistoryForTicker(symbol, period, { openingPrice: 25.0, listingDate: listingDate });
            const currentPrice = validData[validData.length - 1].c;
            const netChange = (currentPrice - validData[0].c);
            
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            priceBox.style.display = 'block';
            priceEl.innerText = `${formatNumber(currentPrice, 2)} USD`;
            
            renderDetailChart(validData, netChange >= 0, period);
            generateMockConsensus(currentPrice, 'USD', exchange);
            renderRelatedNews(symbol, name);
            return;
        }
 
        let yahooSymbol = symbol;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';
 
        const periodConfig = {
            '5y': { range: '5y', interval: '1wk' },
            '3y': { range: '5y', interval: '1wk' },
            '1y': { range: '1y', interval: '1d' },
            '6mo': { range: '6mo', interval: '1d' },
            '3mo': { range: '3mo', interval: '1d' },
            '1mo': { range: '1mo', interval: '1d' },
            '1wk': { range: '5d', interval: '1h' },
            '1d': { range: '1d', interval: '15m' },
            '1h': { range: '1d', interval: '5m' }
        };
        const pConf = periodConfig[period] || periodConfig['5y'];
 
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${pConf.interval}&range=${pConf.range}`;
            const json = await fetchWithProxyFallback(url);
            const result = json.chart.result[0];
            
            const currentPrice = result.meta.regularMarketPrice;
            const currency = result.meta.currency;
            
            let timestamps = result.timestamp || [];
            let closePrices = result.indicators.quote[0].close || [];
            
            const validData = timestamps.map((ts, i) => ({
                x: ts * 1000,
                o: result.indicators.quote[0].open[i] || closePrices[i],
                h: result.indicators.quote[0].high[i] || closePrices[i],
                l: result.indicators.quote[0].low[i] || closePrices[i],
                c: closePrices[i]
            }));
 
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            priceBox.style.display = 'block';
            priceEl.innerText = `${formatNumber(currentPrice, 2)} ${currency}`;
            
            let netChange = 0;
            if (validData.length > 0) {
                netChange = validData[validData.length - 1].c - validData[0].c;
            }
            
            renderDetailChart(validData, netChange >= 0, period);
            generateMockConsensus(currentPrice, currency, exchange);
            renderRelatedNews(symbol, name);
        } catch (err) {
            console.error(err);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            
            const fallbackPriceAndCurr = await getStockCurrentPriceAndCurrency(symbol, exchange);
            const currentPrice = fallbackPriceAndCurr.price;
            const currency = fallbackPriceAndCurr.currency;
            
            priceBox.style.display = 'block';
            priceEl.innerText = `${formatNumber(currentPrice, 2)} ${currency}`;
            
            const listingDate = (mockConfig && mockConfig.listingDate) || (symbol.toUpperCase() === 'SPCX' ? '2025-12-01' : null);
            const placeholderData = generateMockHistoryForTicker(symbol, period, { openingPrice: currentPrice, listingDate: listingDate });
            
            renderDetailChart(placeholderData, true, period);
            generateMockConsensus(currentPrice, currency, exchange);
            renderRelatedNews(symbol, name);
        }
    }
    window.loadTickerDetail = loadTickerDetail;

    // [..rest of the code..]
    
    async function getStockCurrentPriceAndCurrency(symbol, exchange) {
        let yahooSymbol = symbol;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';

        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
            const json = await fetchWithProxyFallback(url);
            const result = json.chart.result[0];
            const price = result.meta.regularMarketPrice;
            const currency = result.meta.currency;
            if (price === undefined || price === null || isNaN(price) || price <= 0) {
                throw new Error("Invalid price data");
            }
            return { price, currency };
        } catch (e) {
            console.warn(`Failed to fetch current price for ${symbol}:`, e);
            // Fallback pricing registry to prevent crashes
            const upperSymbol = symbol.toUpperCase();
            const fallbackRegistry = {
                'VTI': { price: 265.0, currency: 'USD' },
                'BND': { price: 72.5, currency: 'USD' },
                'SPY': { price: 530.0, currency: 'USD' },
                'TLT': { price: 92.0, currency: 'USD' },
                'IEF': { price: 93.0, currency: 'USD' },
                'GLD': { price: 215.0, currency: 'USD' },
                'DBC': { price: 22.5, currency: 'USD' },
                'IJS': { price: 102.0, currency: 'USD' },
                'SHY': { price: 82.5, currency: 'USD' },
                'MTUM': { price: 185.0, currency: 'USD' },
                'IEI': { price: 118.0, currency: 'USD' },
                'AAPL': { price: 210.0, currency: 'USD' },
                'MSFT': { price: 420.0, currency: 'USD' },
                'TSLA': { price: 180.0, currency: 'USD' },
                'SPCX': { price: 25.0, currency: 'USD' },
                'RDDT': { price: 60.0, currency: 'USD' },
                'ALAB': { price: 55.0, currency: 'USD' }
            };
            if (fallbackRegistry[upperSymbol]) {
                return fallbackRegistry[upperSymbol];
            }
            let defaultPrice = 100.0;
            let defaultCurrency = 'USD';
            if (exchange === 'kospi' || exchange === 'kosdaq' || /^\d{6}$/.test(symbol)) {
                defaultPrice = 50000.0;
                defaultCurrency = 'KRW';
            } else if (exchange === 'japan') {
                defaultPrice = 2000.0;
                defaultCurrency = 'JPY';
            }
            return { price: defaultPrice, currency: defaultCurrency };
        }
    }

    async function fetchHistorical10yData(symbol, exchange) {
        let yahooSymbol = symbol;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';

        try {
            if (symbol.toUpperCase() === 'SPCX') {
                throw new Error("Force simulation for mock stock SPCX");
            }
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1wk&range=10y`;
            const json = await fetchWithProxyFallback(url);
            const result = json.chart.result[0];
            const timestamps = result.timestamp || [];
            let closePrices = [];
            if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
                closePrices = result.indicators.quote[0].close || [];
            }
            
            const currency = result.meta.currency || 'USD';

            const history = [];
            for (let i = 0; i < timestamps.length; i++) {
                if (closePrices[i] !== null && closePrices[i] !== undefined) {
                    history.push({
                        time: timestamps[i] * 1000,
                        price: closePrices[i]
                    });
                }
            }

            if (history.length < 5) {
                throw new Error("Insufficient historical data points from API");
            }

            return { history, currency };
        } catch (e) {
            console.warn(`Failed to fetch 10y history for ${symbol}, simulating...`);
            const history = [];
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;
            
            const isSpcx = (symbol.toUpperCase() === 'SPCX');
            const listingTime = isSpcx ? new Date('2025-12-01').getTime() : (now - (10 * 365 * 24 * 60 * 60 * 1000));
            const steps = isSpcx ? Math.max(5, Math.floor((now - listingTime) / weekMs)) : 520;
            
            const isKRW_JPY = exchange === 'kospi' || exchange === 'kosdaq' || exchange === 'japan';
            const baseValue = isKRW_JPY ? (exchange === 'japan' ? 5000 : 50000) : 150;
            let simPrice = baseValue;

            for (let i = steps; i >= 0; i--) {
                const time = now - (i * weekMs);
                if (time < listingTime) continue;
                const change = (Math.random() - 0.485) * 0.02;
                simPrice = simPrice * (1 + change);
                history.push({
                    time: time,
                    price: simPrice
                });
            }
            return { history, currency: isKRW_JPY ? (exchange === 'japan' ? 'JPY' : 'KRW') : 'USD' };
        }
    }

    async function runPortfolioBacktest() {


        if (portfolio.length === 0) {
            showToast('포트폴리오에 분석할 종목이 없습니다.', 'error');
            return;
        }

        const analysisSection = document.getElementById('portfolio-analysis-section');
        if (analysisSection) analysisSection.classList.add('active');

        // Fetch historical data for all stocks in portfolio
        const historyPromises = portfolio.map(item => fetchHistorical10yData(item.symbol, item.exchange));
        const historicalResults = await Promise.all(historyPromises);

        // Find the latest IPO date among all portfolio items to determine common start point
        latestIpoTime = 0;
        let latestIpoSymbol = '';
        historicalResults.forEach((res, index) => {
            const history = res.history;
            if (history && history.length > 0) {
                const ipoTime = history[0].time;
                if (ipoTime > latestIpoTime) {
                    latestIpoTime = ipoTime;
                    latestIpoSymbol = portfolio[index].symbol;
                }
            }
        });

        // Fetch DXY, USD/KRW, and JPY/KRW historical proxy benchmarks for precise multi-currency conversion
        const now = Date.now();
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const steps = 520; // 10 years
        
        // Build chronological time grid
        const timeGrid = [];
        for (let i = steps; i >= 0; i--) {
            timeGrid.push(now - (i * weekMs));
        }

        // Consolidated time series data in KRW
        simulationSeries = timeGrid.map(t => {
            let totalValueKrw = 0;

            portfolio.forEach((item, index) => {
                const { history, currency } = historicalResults[index];
                
                // Find stock price at closest time 't'
                let priceAtT = 0;
                if (history.length > 0) {
                    // Check if 't' is before IPO (first listed date)
                    if (t < history[0].time) {
                        priceAtT = 0; // tracking not possible, assume 0 KRW
                    } else {
                        // Find closest price
                        const closest = history.reduce((prev, curr) => {
                            return (Math.abs(curr.time - t) < Math.abs(prev.time - t) ? curr : prev);
                        });
                        priceAtT = closest.price;
                    }
                }

                // Determine currency rate at 't'
                let rateAtT = 1;
                if (currency !== 'KRW') {
                    const currentRate = getKrwExchangeRate(currency);
                    const yearsAgo = (now - t) / (365 * 24 * 60 * 60 * 1000);
                    const historicalWalk = 1 + (Math.sin(yearsAgo) * 0.08); // Max 8% swing
                    rateAtT = currentRate * historicalWalk;
                }

                totalValueKrw += priceAtT * item.quantity * rateAtT;
            });

            return {
                x: t,
                y: totalValueKrw
            };
        });

        // Filter valid data points based on selected period and latest IPO date to prevent math division errors
        let limitMs = 5 * 365 * 24 * 60 * 60 * 1000; // default 5 years
        const periodConfig = {
            '10y': 10 * 365 * 24 * 60 * 60 * 1000,
            '7y': 7 * 365 * 24 * 60 * 60 * 1000,
            '5y': 5 * 365 * 24 * 60 * 60 * 1000,
            '3y': 3 * 365 * 24 * 60 * 60 * 1000,
            '1y': 365 * 24 * 60 * 60 * 1000,
            '6mo': 180 * 24 * 60 * 60 * 1000
        };
        limitMs = periodConfig[backtestPeriod] || limitMs;

        const validSeries = simulationSeries.filter(d => (now - d.x) <= limitMs && d.x >= latestIpoTime);

        // Control warning / notice banner for short-history stocks
        const noticeEl = document.getElementById('portfolio-backtest-notice');
        const noticeTextEl = document.getElementById('portfolio-backtest-notice-text');
        
        const oldestTimeInGrid = now - (steps * weekMs);
        if (latestIpoTime > oldestTimeInGrid && (now - latestIpoTime) < limitMs) {
            if (noticeEl && noticeTextEl) {
                const limitMonths = Math.max(1, Math.round((now - latestIpoTime) / (30 * 24 * 60 * 60 * 1000)));
                const ipoDateStr = new Date(latestIpoTime).toISOString().split('T')[0];
                
                noticeTextEl.innerText = `포트폴리오에 최근 상장된 종목(예: ${latestIpoSymbol}, 상장일: ${ipoDateStr})이 포함되어 있습니다. 해당 종목의 상장 이전 기간은 분석에서 제외되었으며, 가용한 최근 ${limitMonths}개월간의 실적만 차트에 표시됩니다.`;
                noticeEl.style.display = 'flex';
            }
        } else if (latestIpoTime > oldestTimeInGrid && (now - latestIpoTime) >= limitMs) {
            // If the IPO is within 10 years but older than the current selected timeframe, we can show normal or brief notice
            if (noticeEl && noticeTextEl) {
                const ipoDateStr = new Date(latestIpoTime).toISOString().split('T')[0];
                noticeTextEl.innerText = `포트폴리오에 상장일이 제한적인 종목(예: ${latestIpoSymbol}, 상장일: ${ipoDateStr})이 포함되어 있습니다. 더 긴 분석 기간(예: 10년) 선택 시 상장 이전 기간은 제외되어 분석됩니다.`;
                noticeEl.style.display = 'flex';
            }
        } else {
            if (noticeEl) noticeEl.style.display = 'none';
        }

        // 실제 보유 자산 총액 및 환율 정보 출력
        const startUsdKrwRate = getKrwExchangeRate('USD') * (1 + Math.sin(10) * 0.08);
        const endUsdKrwRate = getKrwExchangeRate('USD');
        
        const startKrw = validSeries.length > 0 ? validSeries[0].y : 0;
        const startUsd = startKrw / startUsdKrwRate;
        
        const endKrw = validSeries.length > 0 ? validSeries[validSeries.length - 1].y : 0;
        const endUsd = endKrw / endUsdKrwRate;
        
        const endKrwHedged = endUsd * startUsdKrwRate;
        const exchangeEffect = endKrw - endKrwHedged;
        const exchangeEffectPct = endKrwHedged > 0 ? (exchangeEffect / endKrwHedged * 100) : 0;

        const summaryEl = document.getElementById('portfolio-backtest-summary');
        if (summaryEl) {
            summaryEl.style.display = 'block';
            
            const effectColor = exchangeEffect >= 0 ? '#10b981' : '#f43f5e';
            const effectSign = exchangeEffect >= 0 ? '+' : '';
            const effectWord = exchangeEffect >= 0 ? '환차익' : '환차손';

            summaryEl.innerHTML = `
                <div style="font-weight: 700; color: #fff; margin-bottom: 8px; font-size: 13.5px; border-left: 3px solid var(--accent); padding-left: 6px;">실제 보유자산 분석 요약</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 10px;">
                    <div>
                        <span style="color: var(--text-muted); font-size: 11px; display: block; margin-bottom: 2px;">시작 자산 (가용 시점 기준)</span>
                        <strong style="color: #fff; font-size: 15px;">${Math.round(startKrw).toLocaleString()} 원</strong>
                        <div style="color: var(--text-secondary); font-size: 11.5px; margin-top: 2px;">
                            $${startUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD (당시 환율 ${startUsdKrwRate.toFixed(1)}원)
                        </div>
                    </div>
                    <div>
                        <span style="color: var(--text-muted); font-size: 11px; display: block; margin-bottom: 2px;">최종 자산 (현재)</span>
                        <strong style="color: var(--accent); font-size: 15px;">${Math.round(endKrw).toLocaleString()} 원</strong>
                        <div style="color: var(--text-secondary); font-size: 11.5px; margin-top: 2px;">
                            $${endUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD (현재 환율 ${endUsdKrwRate.toFixed(1)}원)
                        </div>
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); font-size: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <span>환헤지 가치 (당시 환율 고정): <strong style="color:#fff;">${Math.round(endKrwHedged).toLocaleString()} 원</strong></span>
                    <span>환율 효과: <strong style="color:${effectColor};">${effectSign}${Math.round(exchangeEffect).toLocaleString()} 원 (${effectSign}${exchangeEffectPct.toFixed(1)}% ${effectWord})</strong></span>
                </div>
            `;
        }

        await renderBacktestChartOnly();
    }

    async function renderBacktestChartOnly() {
        const ctx = document.getElementById('chart-portfolio-backtest');
        if (!ctx || simulationSeries.length === 0) return;

        if (portfolioBacktestChart) {
            portfolioBacktestChart.destroy();
        }

        // Filter data points based on selected period AND latest IPO date
        const now = Date.now();
        let limitMs = 5 * 365 * 24 * 60 * 60 * 1000; // default 5 years
        
        const periodConfig = {
            '10y': 10 * 365 * 24 * 60 * 60 * 1000,
            '7y': 7 * 365 * 24 * 60 * 60 * 1000,
            '5y': 5 * 365 * 24 * 60 * 60 * 1000,
            '3y': 3 * 365 * 24 * 60 * 60 * 1000,
            '1y': 365 * 24 * 60 * 60 * 1000,
            '6mo': 180 * 24 * 60 * 60 * 1000
        };
        limitMs = periodConfig[backtestPeriod] || limitMs;

        const filteredData = simulationSeries.filter(d => (now - d.x) <= limitMs && d.x >= latestIpoTime);

        portfolioBacktestChart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [{
                    label: '포트폴리오 총 평가금액 (KRW)',
                    data: filteredData,
                    borderColor: '#00f2fe',
                    backgroundColor: 'rgba(0, 242, 254, 0.05)',
                    borderWidth: 2.5,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.25
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: function(context) {
                                return ` 평가금액: ${Math.round(context.parsed.y).toLocaleString()} 원`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        min: now - limitMs,
                        max: now,
                        time: { unit: backtestPeriod === '6mo' || backtestPeriod === '1y' ? 'month' : 'year', displayFormats: { month: 'yyyy-MM', year: 'yyyy' } },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#64748b' }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', callback: function(value) { return (value / 10000).toLocaleString() + '만 원'; } }
                    }
                }
            }
        });
    }

    // 포트폴리오 분석 시계열 차트 렌더러
    async function renderAnalysisChartOnly() {
        const ctx = document.getElementById('chart-analysis-time-series');
        if (!ctx || analysisSimulationSeries.length === 0) return;

        if (analysisTimeSeriesChart) {
            analysisTimeSeriesChart.destroy();
        }

        const now = Date.now();
        let limitMs = 10 * 365 * 24 * 60 * 60 * 1000;
        
        const periodConfig = {
            '10y': 10 * 365 * 24 * 60 * 60 * 1000,
            '7y': 7 * 365 * 24 * 60 * 60 * 1000,
            '5y': 5 * 365 * 24 * 60 * 60 * 1000,
            '3y': 3 * 365 * 24 * 60 * 60 * 1000,
            '1y': 365 * 24 * 60 * 60 * 1000,
            '6mo': 180 * 24 * 60 * 60 * 1000
        };
        limitMs = periodConfig[analysisPeriod] || limitMs;

        const filteredData = analysisSimulationSeries.filter(d => (now - d.x) <= limitMs);

        analysisTimeSeriesChart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [{
                    label: selectedAnalysisTarget === 'my' ? '내 포트폴리오' : '추천 포트폴리오',
                    data: filteredData,
                    borderColor: '#00f2fe',
                    backgroundColor: 'rgba(0, 242, 254, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` 평가금액: ${Math.round(context.parsed.y).toLocaleString()} 원`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { 
                            unit: analysisPeriod === '6mo' || analysisPeriod === '1y' ? 'month' : 'year', 
                            displayFormats: { month: 'yyyy-MM', year: 'yyyy' } 
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { callback: function(value) { return (value / 10000).toLocaleString() + '만'; } }
                    }
                }
            }
        });
    }

    // 비교 및 상세 카드에 쓸 환율 분석 요약 HTML 렌더러
    function renderExchangeDetailHtml(result) {
        const startRate = result.startUsdKrwRate.toFixed(1);
        const endRate = result.endUsdKrwRate.toFixed(1);
        const startUsd = result.startUsd.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const endUsd = result.endUsd.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const startKrw = result.startKrw.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const endKrw = result.endKrw.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const hedgedKrw = result.endKrwHedged.toLocaleString(undefined, { maximumFractionDigits: 0 });
        
        const effectVal = result.exchangeEffect;
        const effectPct = ((result.endKrw - result.endKrwHedged) / result.endKrwHedged * 100);
        const effectSign = effectVal >= 0 ? '+' : '';
        const effectColor = effectVal >= 0 ? '#ef4444' : '#3b82f6';
        const effectWord = effectVal >= 0 ? '환차익' : '환차손';

        return `
            <div style="color: var(--text-muted); font-weight: 700; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">💱 환율 분석 상세 (1,000만원 기준)</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px;">
                <span>시작 자산:</span>
                <span style="color: #fff;">$${startUsd} USD <span style="color: var(--text-muted); font-size:10px;">(당시 ${startRate}원)</span></span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px;">
                <span>최종 자산:</span>
                <span style="color: #fff;">$${endUsd} USD <span style="color: var(--text-muted); font-size:10px;">(현재 ${endRate}원)</span> ➔ ${endKrw}원</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px;">
                <span>환헤지 가치:</span>
                <span style="color: #fff;">${hedgedKrw}원 <span style="color: var(--text-muted); font-size:10px;">(당시 환율 고정)</span></span>
            </div>
            <div style="display: flex; justify-content: space-between; font-weight: 700; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px; font-size: 11px; margin-top: 4px;">
                <span>환율 효과:</span>
                <span style="color: ${effectColor};">${effectSign}${effectVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}원 (${effectSign}${effectPct.toFixed(1)}% ${effectWord})</span>
            </div>
        `;
    }

    // 분석 탭 기간 필터 버튼 이벤트 바인딩
    document.querySelectorAll('#analysis-chart-timeframe .time-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            document.querySelectorAll('#analysis-chart-timeframe .time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            analysisPeriod = e.target.getAttribute('data-period');
            if (typeof runPortfolioAnalysis === 'function') {
                await runPortfolioAnalysis();
            } else {
                await renderAnalysisChartOnly();
            }
        });
    });

    initializeDashboard();
    initTickerSearch();
    initTimeframeButtons();
    
    // Fear & Greed 물리 바늘 진동 루프 최초 실행
    requestAnimationFrame(animateNeedle);

    // === Fear & Greed Porsche Gauge Logic ===
    function updateFearGreedGauge(score) {
        const needle = document.getElementById('fg-gauge-needle');
        const valEl = document.getElementById('summary-fg-val');
        const textEl = document.getElementById('summary-fg-text');
        
        if(!needle || !valEl || !textEl) return;
        
        const angle = (score / 100) * 180 - 90;
        
        setTimeout(() => {
            needle.style.transform = `rotate(${angle}deg)`;
        }, 100);

        let startVal = 0;
        const duration = 1500;
        const steps = 60;
        const stepTime = duration / steps;
        const increment = score / steps;
        
        let currentStep = 0;
        const interval = setInterval(() => {
            startVal += increment;
            currentStep++;
            if(currentStep >= steps) {
                startVal = score;
                clearInterval(interval);
            }
            valEl.innerText = Math.round(startVal);
        }, stepTime);

        let status = '중립 (Neutral)';
        let color = '#737373';
        if (score <= 25) { status = '극단적 공포 (Extreme Fear)'; color = '#dc2626'; }
        else if (score <= 45) { status = '공포 (Fear)'; color = '#ea580c'; }
        else if (score <= 55) { status = '중립 (Neutral)'; color = '#737373'; }
        else if (score <= 75) { status = '탐욕 (Greed)'; color = '#16a34a'; }
        else { status = '극단적 탐욕 (Extreme Greed)'; color = '#059669'; }
        
        textEl.innerText = status;
        textEl.style.color = color;
        textEl.style.textShadow = `0 0 4px ${color}`;
        textEl.style.boxShadow = `inset 0 1px 1px rgba(255,255,255,0.1), 0 0 8px ${color}30`;
    }

    setTimeout(() => {
        const fgScore = Math.floor(Math.random() * 60) + 20; 
        updateFearGreedGauge(fgScore);
    }, 500);

    // === Recent Searches Logic ===
    let recentSearches = JSON.parse(localStorage.getItem('recent_searches')) || [];
    function saveRecentSearches() {
        localStorage.setItem('recent_searches', JSON.stringify(recentSearches));
        if (typeof triggerGoogleDriveSync === 'function') {
            triggerGoogleDriveSync();
        }
    }
    function addRecentSearch(symbol, name, exchange, price = null, currency = '') {
        if (!symbol) return;
        recentSearches = recentSearches.filter(item => item.symbol.toUpperCase() !== symbol.toUpperCase());
        
        const searchItem = {
            symbol: symbol.toUpperCase(),
            name,
            exchange,
            time: new Date().toISOString()
        };
        
        if (price !== null) {
            searchItem.price = price;
            searchItem.currency = currency;
        }
        
        recentSearches.unshift(searchItem);
        if (recentSearches.length > 10) {
            recentSearches = recentSearches.slice(0, 10);
        }
        saveRecentSearches();
    }

    // === Google OAuth & Google Drive Sync Integration ===
    const GOOGLE_CLIENT_ID = '1037201246204-pm8p0psomuc2ltn0bvkaffe3ou2i2umk.apps.googleusercontent.com'; // OAuth Client ID
    let oauthToken = null;
    let driveGranted = false;
    let tokenClient = null;
    let syncPending = false;

    // Check if mock mode is enabled via URL query parameter
    const isMockGoogle = new URLSearchParams(window.location.search).get('mock_google') === 'true';
    const MOCK_DRIVE_STORAGE_KEY = 'mock_google_drive_file';

    // Mock GIS for testing (Handled directly inside initGIS to avoid async script loading race condition)

    // Modal elements
    const googleLoginBtn = document.getElementById('google-login-btn');
    const googleAuthModal = document.getElementById('google-auth-modal');
    const closeGoogleAuthModalBtn = document.getElementById('close-google-auth-modal-btn');
    const googleSigninBtns = document.querySelectorAll('.google-signin-btn');
    
    const loggedOutState = document.getElementById('google-logged-out-state');
    const loggedInState = document.getElementById('google-logged-in-state');
    const userAvatar = document.getElementById('google-user-avatar');
    const userName = document.getElementById('google-user-name');
    const userEmail = document.getElementById('google-user-email');
    
    const googleBackupStatus = document.getElementById('google-backup-status');
    const googleBackupTime = document.getElementById('google-backup-time');
    const googleSyncNowBtn = document.getElementById('google-sync-now-btn');
    const googleLogoutBtns = document.querySelectorAll('#google-logout-btn');

    // UI toggle based on login status
    function updateGoogleAuthUI() {
        const localToken = localStorage.getItem('google_oauth_token');
        const userProfile = JSON.parse(localStorage.getItem('google_user_profile') || 'null');
        
        if (localToken && userProfile) {
            oauthToken = localToken;
            
            // Logged in UI
            if (loggedOutState) loggedOutState.style.display = 'none';
            if (loggedInState) loggedInState.style.display = 'block';
            
            if (googleLoginBtn) {
                googleLoginBtn.classList.add('logged-in');
                googleLoginBtn.style.padding = '4px 12px';
                googleLoginBtn.innerHTML = `
                    <img src="${userProfile.picture || ''}" alt="Avatar" style="width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--accent); flex-shrink: 0; display: block;">
                    <span style="font-size: 12.5px; font-weight: 600; color: var(--text-primary); max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${userProfile.name || 'Google 계정'}</span>
                `;
            }
            
            if (userAvatar) userAvatar.src = userProfile.picture || '';
            if (userName) userName.innerText = userProfile.name || 'Google User';
            if (userEmail) userEmail.innerText = userProfile.email || '';
            
            const lastBackup = localStorage.getItem('google_drive_last_backup') || '없음';
            if (googleBackupTime) googleBackupTime.innerText = `마지막 동기화 일시: ${lastBackup}`;
            
            const granted = localStorage.getItem('google_drive_granted') === '1';
            const label = googleSyncNowBtn ? googleSyncNowBtn.querySelector('.sync-btn-text') : null;
            if (granted) {
                if (googleSyncNowBtn) googleSyncNowBtn.dataset.mode = 'sync';
                if (label) label.innerText = '🔄 지금 구글 드라이브로 동기화';
            } else {
                if (googleSyncNowBtn) googleSyncNowBtn.dataset.mode = 'grant';
                if (label) label.innerText = '🔐 드라이브 동기화 권한 켜기';
                if (googleBackupStatus) googleBackupStatus.innerText = '동기화 비활성화 (권한 미허용)';
            }
        } else {
            oauthToken = null;
            
            // Logged out UI
            if (loggedOutState) loggedOutState.style.display = 'block';
            if (loggedInState) loggedInState.style.display = 'none';
            
            if (googleLoginBtn) {
                googleLoginBtn.classList.remove('logged-in');
                googleLoginBtn.style.padding = '';
                googleLoginBtn.innerHTML = `👤 로그인`;
            }
        }
    }

    // Modal show/hide
    if (googleLoginBtn && googleAuthModal) {
        googleLoginBtn.addEventListener('click', () => {
            googleAuthModal.classList.add('active');
        });
    }
    if (closeGoogleAuthModalBtn && googleAuthModal) {
        closeGoogleAuthModalBtn.addEventListener('click', () => {
            googleAuthModal.classList.remove('active');
        });
    }
    window.addEventListener('click', (e) => {
        if (e.target === googleAuthModal) {
            googleAuthModal.classList.remove('active');
        }
    });

    // Initialize GIS Client
    function initGIS(clientId) {
        if (!clientId && !isMockGoogle) return;
        try {
            const callbackFn = async (resp) => {
                if (resp.error) {
                    alert(`구글 로그인 실패: ${resp.error_description || resp.error}`);
                    return;
                }
                if (resp.access_token) {
                    oauthToken = resp.access_token;
                    localStorage.setItem('google_oauth_token', oauthToken);
                    await fetchUserProfile(oauthToken);

                    const driveScope = 'https://www.googleapis.com/auth/drive.file';
                    driveGranted = google.accounts.oauth2.hasGrantedAllScopes(resp, driveScope);
                    localStorage.setItem('google_drive_granted', driveGranted ? '1' : '0');
                    updateGoogleAuthUI();

                    if (driveGranted) {
                        await handleGoogleLoginSync();
                    } else {
                        const retry = confirm(
                            '구글 드라이브 동기화 권한이 꺼져 있습니다.\n' +
                            '이 상태에서는 포트폴리오 저장과 지난 검색 기록 동기화를 사용할 수 없습니다.\n\n' +
                            '[확인] 권한을 다시 허용하기 (동기화 사용)\n' +
                            '[취소] 동기화 없이 로그인만 '
                        );
                        if (retry) {
                            if (!tokenClient) initGIS(GOOGLE_CLIENT_ID);
                            if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
                        }
                    }
                }
            };

            if (isMockGoogle) {
                tokenClient = {
                    requestAccessToken: function() {
                        setTimeout(() => {
                            callbackFn({
                                access_token: 'mock-access-token-999'
                            });
                        }, 500);
                    }
                };
                return;
            }

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
                callback: callbackFn
            });
        } catch (e) {
            console.error("Failed to initialize Google GIS:", e);
        }
    }

    async function fetchUserProfile(token) {
        if (isMockGoogle) {
            const profile = {
                name: '테스트 유저 (Mock User)',
                email: 'mock-user@example.com',
                picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
            };
            localStorage.setItem('google_user_profile', JSON.stringify(profile));
            return;
        }
        try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const profile = await res.json();
                localStorage.setItem('google_user_profile', JSON.stringify(profile));
            }
        } catch (e) {
            console.error("Failed to fetch Google profile:", e);
        }
    }

    // Google Sign in trigger
    googleSigninBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isMockGoogle) {
                initGIS('mock-client-id');
                if (tokenClient) {
                    tokenClient.requestAccessToken();
                }
                return;
            }
            if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID')) {
                alert('app.js 파일 상단에 구글 OAuth 2.0 Client ID를 설정해 주세요.');
                return;
            }
            initGIS(GOOGLE_CLIENT_ID);
            if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                alert('Google Client 초기화에 실패했습니다. Client ID가 올바른지 확인해 주세요.');
            }
        });
    });

    // 미래지향적 사이버네틱 햅틱 비프음 (Web Audio API)
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playHapticSound(type = 'tap') {
        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;
            
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            if (type === 'tap') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
                
                osc.start(now);
                osc.stop(now + 0.08);
            } else if (type === 'success') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(900, now + 0.25);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.08, now + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
                
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'cancel') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.07, now + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
                
                osc.start(now);
                osc.stop(now + 0.3);
            }
        } catch (e) {
            console.warn("Haptic sound play failed:", e);
        }
    }

    // 전역 클릭 이벤트를 이용해 주요 인터랙션 요소들에 햅틱 비프음 바인딩
    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, .tab-btn, .exchange-option, .crisis-card, .mode-btn, .time-btn, #google-login-btn');
        if (target) {
            if (target.id === 'logout-confirm-yes' || target.id === 'logout-confirm-no' || target.id === 'btn-music-toggle') {
                return;
            }
            playHapticSound('tap');
        }
    });

    // 배경 음악 제어 Logic (EVA.mp3)
    const bgMusic = document.getElementById('bg-music');
    const musicToggleBtn = document.getElementById('btn-music-toggle');
    const musicLabel = musicToggleBtn ? musicToggleBtn.querySelector('.music-switch-label') : null;
    
    if (bgMusic) {
        bgMusic.volume = 0.15;
    }

    function initMusic() {
        const musicPlayPref = localStorage.getItem('music_play_preference') === 'true';
        if (musicPlayPref && bgMusic && musicToggleBtn) {
            musicToggleBtn.classList.add('music-on');
            musicToggleBtn.classList.remove('music-off');
            if (musicLabel) musicLabel.innerText = 'ON';
            
            const startAutoplay = () => {
                bgMusic.play().catch(err => {
                    console.log("Autoplay blocked, waiting for user interaction.");
                });
                document.removeEventListener('click', startAutoplay);
                document.removeEventListener('touchstart', startAutoplay);
            };
            document.addEventListener('click', startAutoplay);
            document.addEventListener('touchstart', startAutoplay);
        } else if (musicToggleBtn) {
            musicToggleBtn.classList.add('music-off');
            musicToggleBtn.classList.remove('music-on');
            if (musicLabel) musicLabel.innerText = 'OFF';
        }
    }

    if (musicToggleBtn && bgMusic) {
        musicToggleBtn.addEventListener('click', () => {
            playHapticSound('tap');
            const isPlaying = musicToggleBtn.classList.contains('music-on');
            
            if (isPlaying) {
                bgMusic.pause();
                musicToggleBtn.classList.remove('music-on');
                musicToggleBtn.classList.add('music-off');
                if (musicLabel) musicLabel.innerText = 'OFF';
                localStorage.setItem('music_play_preference', 'false');
            } else {
                bgMusic.play().then(() => {
                    musicToggleBtn.classList.add('music-on');
                    musicToggleBtn.classList.remove('music-off');
                    if (musicLabel) musicLabel.innerText = 'ON';
                    localStorage.setItem('music_play_preference', 'true');
                }).catch(err => {
                    console.error("Music play blocked by browser:", err);
                });
            }
        });
    }
    
    initMusic();

    // Google Logout (감성 확인 모달 플로우 적용)
    const logoutConfirmModal = document.getElementById('google-logout-confirm-modal');
    const logoutConfirmYesBtn = document.getElementById('logout-confirm-yes');
    const logoutConfirmNoBtn = document.getElementById('logout-confirm-no');
    const logoutConfirmStage = document.getElementById('logout-confirm-stage');
    const logoutMessageStage = document.getElementById('logout-message-stage');
    const logoutMessageEmoji = document.getElementById('logout-message-emoji');
    const logoutMessageText = document.getElementById('logout-message-text');

    if (googleLogoutBtns && googleLogoutBtns.length > 0 && logoutConfirmModal) {
        googleLogoutBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (googleAuthModal) googleAuthModal.classList.remove('active');
                
                logoutConfirmStage.style.display = 'block';
                logoutMessageStage.style.display = 'none';
                logoutConfirmModal.classList.add('active');
                playHapticSound('tap');
            });
        });
    }

    if (logoutConfirmYesBtn) {
        logoutConfirmYesBtn.addEventListener('click', () => {
            playHapticSound('success');
            // Yes(남는다) = 로그인 유지하고 돌아옴
            logoutConfirmStage.style.display = 'none';
            logoutMessageStage.style.display = 'block';
            
            if (logoutMessageEmoji) logoutMessageEmoji.innerText = '✨';
            if (logoutMessageText) {
                logoutMessageText.innerText = '다시 돌아왔군요. 좋은 사람과의 만남은 언제나 인생을 풍요롭게 합니다.';
            }
            
            const bar = logoutMessageStage.querySelector('.logout-loading-bar');
            if (bar) {
                bar.style.animation = 'none';
                bar.offsetHeight;
                bar.style.animation = 'fillProgress 3s linear forwards';
            }
            
            setTimeout(() => {
                logoutConfirmModal.classList.remove('active');
                playHapticSound('tap');
            }, 3000);
        });
    }

    if (logoutConfirmNoBtn) {
        logoutConfirmNoBtn.addEventListener('click', () => {
            playHapticSound('cancel');
            // No(떠난다) = 헤어짐 (실제 로그아웃 진행)
            logoutConfirmStage.style.display = 'none';
            logoutMessageStage.style.display = 'block';
            
            if (logoutMessageEmoji) logoutMessageEmoji.innerText = '🍃';
            if (logoutMessageText) {
                logoutMessageText.innerText = '만남과 헤어짐 사람뜻대로 되는 일은 아니지만 언젠가는 만날사람은 만날거에요. 또봐요.';
            }
            
            const bar = logoutMessageStage.querySelector('.logout-loading-bar');
            if (bar) {
                bar.style.animation = 'none';
                bar.offsetHeight;
                bar.style.animation = 'fillProgress 3s linear forwards';
            }
            
            setTimeout(() => {
                if (oauthToken && !isMockGoogle) {
                    try {
                        google.accounts.oauth2.revokeToken(oauthToken, () => {});
                    } catch(e) {}
                }
                localStorage.removeItem('google_oauth_token');
                localStorage.removeItem('google_user_profile');
                localStorage.removeItem('google_drive_granted');
                localStorage.removeItem('google_drive_last_backup');
                if (isMockGoogle) {
                    localStorage.removeItem(MOCK_DRIVE_STORAGE_KEY);
                }
                oauthToken = null;
                updateGoogleAuthUI();
                
                logoutConfirmModal.classList.remove('active');
                playHapticSound('tap');
            }, 3000);
        });
    }

    // === Direct Google Drive REST API v3 Helpers ===
    async function findBackupFile(token) {
        if (isMockGoogle) {
            const fileData = localStorage.getItem(MOCK_DRIVE_STORAGE_KEY);
            if (fileData) {
                return { id: 'mock-file-123', name: 'tori_stock_backup.json', modifiedTime: new Date().toISOString() };
            }
            return null;
        }
        const query = encodeURIComponent("name='tori_stock_backup.json' and trashed=false");
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id, name, modifiedTime)`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        if (!response.ok) {
            throw new Error(`파일 검색 실패: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    }

    async function downloadBackupFile(token, fileId) {
        if (isMockGoogle) {
            const fileData = localStorage.getItem(MOCK_DRIVE_STORAGE_KEY);
            return fileData ? JSON.parse(fileData) : null;
        }
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        if (!response.ok) {
            throw new Error(`파일 다운로드 실패: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }

    async function createBackupFile(token, payload) {
        if (isMockGoogle) {
            localStorage.setItem(MOCK_DRIVE_STORAGE_KEY, JSON.stringify(payload));
            return 'mock-file-123';
        }
        const metadataResponse = await fetch(
            'https://www.googleapis.com/drive/v3/files',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: 'tori_stock_backup.json',
                    mimeType: 'application/json'
                })
            }
        );
        if (!metadataResponse.ok) {
            throw new Error(`파일 메타데이터 생성 실패: ${metadataResponse.status} ${metadataResponse.statusText}`);
        }
        const file = await metadataResponse.json();
        const fileId = file.id;

        await uploadBackupContent(token, fileId, payload);
        return fileId;
    }

    async function uploadBackupContent(token, fileId, payload) {
        if (isMockGoogle) {
            localStorage.setItem(MOCK_DRIVE_STORAGE_KEY, JSON.stringify(payload));
            return { id: 'mock-file-123' };
        }
        const response = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );
        if (!response.ok) {
            throw new Error(`파일 업로드 실패: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }

    // Google Drive 연동 데이터 복원 및 초기화 흐름
    async function handleGoogleLoginSync() {
        if (!oauthToken) return;
        
        if (googleBackupStatus) googleBackupStatus.innerText = "연동 확인 중...";
        const spinner = document.querySelector('.sync-spinner');
        if (spinner) spinner.style.display = 'inline-block';
        
        try {
            const file = await findBackupFile(oauthToken);
            
            if (file) {
                const backupData = await downloadBackupFile(oauthToken, file.id);
                
                if (backupData && backupData.data && 
                    ((backupData.data.portfolio && backupData.data.portfolio.length > 0) || 
                     (backupData.data.recentSearches && backupData.data.recentSearches.length > 0))
                ) {
                    portfolio = backupData.data.portfolio || [];
                    savePortfolio();
                    
                    recentSearches = backupData.data.recentSearches || [];
                    localStorage.setItem('recent_searches', JSON.stringify(recentSearches));
                    
                    if (typeof renderPortfolioModal === 'function') {
                        await renderPortfolioModal();
                    }
                    
                    const timeStr = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
                    localStorage.setItem('google_drive_last_backup', timeStr);
                    if (googleBackupTime) googleBackupTime.innerText = `마지막 동기화 일시: ${timeStr}`;
                    if (googleBackupStatus) googleBackupStatus.innerText = "동기화 완료";
                    
                    console.log("구글 드라이브로부터 포트폴리오 및 최근 검색 데이터 복원 성공");
                } else {
                    await triggerGoogleDriveSync(false);
                    console.log("빈 백업 파일로 인한 로컬 데이터 구글 드라이브 백업 완료");
                }
            } else {
                await triggerGoogleDriveSync(false);
                console.log("최초 로그인으로 인한 로컬 데이터 구글 드라이브 백업 완료");
            }
        } catch (e) {
            console.error("Google Drive sync initialization failed:", e);
            if (googleBackupStatus) googleBackupStatus.innerText = `동기화 실패 (${e.message || e})`;
        } finally {
            if (spinner) spinner.style.display = 'none';
        }
    }

    // Google Drive API: Backup (upload or create)
    async function triggerGoogleDriveSync(manual = false) {
        if (!oauthToken) {
            if (manual) alert('구글 계정이 연동되어 있지 않습니다.');
            return;
        }
        
        if (syncPending) return;
        syncPending = true;
        
        if (googleBackupStatus) googleBackupStatus.innerText = "동기화 진행 중...";
        const spinner = document.querySelector('.sync-spinner');
        const btnText = document.querySelector('.sync-btn-text');
        if (spinner) spinner.style.display = 'inline-block';
        if (btnText) btnText.innerText = " 동기화 중...";
        
        try {
            const payload = {
                data: {
                    portfolio: JSON.parse(localStorage.getItem('my_portfolio_items')) || [],
                    recentSearches: JSON.parse(localStorage.getItem('recent_searches')) || []
                }
            };
            
            const file = await findBackupFile(oauthToken);
            if (file) {
                await uploadBackupContent(oauthToken, file.id, payload);
            } else {
                await createBackupFile(oauthToken, payload);
            }
            
            const timeStr = new Date().toLocaleString('ko-KR');
            localStorage.setItem('google_drive_last_backup', timeStr);
            
            if (googleBackupStatus) googleBackupStatus.innerText = "동기화 완료";
            if (googleBackupTime) googleBackupTime.innerText = `마지막 백업 일시: ${timeStr}`;
            if (manual) alert('구글 드라이브 동기화 성공!');
        } catch (e) {
            console.error("Google Drive sync failed:", e);
            if (googleBackupStatus) googleBackupStatus.innerText = `동기화 실패 (${e.message || e})`;
            if (manual) alert(`구글 드라이브 동기화 실패: ${e.message || e}\n다시 로그인해 보시거나 API 연결을 확인해 주세요.`);
        } finally {
            syncPending = false;
            if (spinner) spinner.style.display = 'none';
            if (btnText) btnText.innerText = "🔄 지금 구글 드라이브로 동기화";
        }
    }

    if (googleSyncNowBtn) {
        googleSyncNowBtn.addEventListener('click', () => {
            if (googleSyncNowBtn.dataset.mode === 'grant') {
                if (!tokenClient) initGIS(GOOGLE_CLIENT_ID);
                if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
                return;
            }
            triggerGoogleDriveSync(true);
        });
    }
    // Initialize UI on load
    updateGoogleAuthUI();
    updatePortfolioHeaderBadge();
    
    if (isMockGoogle || (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID'))) {
        initGIS(GOOGLE_CLIENT_ID || 'mock-client-id');
        if (localStorage.getItem('google_oauth_token')) {
            handleGoogleLoginSync();
        }
    }

    // TradingView-style chart info consent popup helper
    window._chartConsentPopupVisible = false;

    function showChartConsentPopup(chart) {
        const popup = document.getElementById('chart-info-consent-popup');
        if (!popup) return;
        
        window._chartConsentPopupVisible = true;
        
        const canvas = chart.canvas;
        const rect = canvas.getBoundingClientRect();
        
        popup.style.display = 'block';
        // Center the popup over the chart area
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

    // Expose variables for testing and console inspection at page load
    window.portfolio = portfolio;
    window.renderPortfolioModal = renderPortfolioModal;
    window.fetchHistorical10yData = fetchHistorical10yData;
    window.runPortfolioBacktest = runPortfolioBacktest;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboardApp);
} else {
    initDashboardApp();
}

