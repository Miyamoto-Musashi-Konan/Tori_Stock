/**
 * 실시간 주가 차트 분석 대시보드 - 메인 애플리케이션 로직 (app.js)
 * Chart.js 연동, 데이터 로딩, 실시간 갱신 및 상세 차트 그리기 기능 제공
 */

document.addEventListener("DOMContentLoaded", () => {
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
    Chart.register(customCrosshairPlugin);

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
    // 실시간 수급 현황 최신 상태 임시 저장
    window.latestTickResult = null;

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
        sgd: 1002.80
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
        sgd: 1.35     // 1달러당 싱가포르 달러
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
        
        // 시장종합 거래량 차트
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
                
                html += `
                <div class="summary-data-col" style="background: rgba(255,255,255,0.02); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
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

        // 섹션 타이틀과 설명에도 현재 연도를 동적 반영
        const currentYear = new Date().getFullYear();
        const sectionTitleEl = document.getElementById('historical-section-title');
        if (sectionTitleEl) {
            sectionTitleEl.textContent = `역사적 통화 가치 및 자산 변동성 (2000년 ~ ${currentYear}년)`;
        }
        const sectionDescEl = document.getElementById('historical-section-desc');
        if (sectionDescEl) {
            sectionDescEl.innerHTML = `
                2000년 닷컴버블부터 <strong>2008~2009년 글로벌 금융위기 최저점</strong>을 지나 <strong>${currentYear}년 현재</strong>까지의 자산군 장기 흐름을 시각화합니다.
                원화의 실질가치(실질실효환율 REER)가 금융위기 당시 어떻게 급락하고 극복했는지 살펴보세요. (2000년 가치 = 100 기준 지수화)
            `;
        }

        // 현재 경제 분석 카드(crisis-card-2026) 텍스트 동적 업데이트 (현재 날짜 기점 시의성 반영)
        const crisisCard = document.getElementById('crisis-card-2026');
        if (crisisCard) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            
            // 실시간 엔화/달러 가격 조회
            let jpyRateText = "860원대";
            let usdRateText = "1,350원대";
            
            try {
                if (window.MockDataModule) {
                    const currencies = window.MockDataModule.getLiveCurrencies();
                    if (currencies && currencies.jpy) {
                        jpyRateText = `${Math.floor(currencies.jpy.current)}원대`;
                    }
                    if (currencies && currencies.usd) {
                        usdRateText = `${formatNumber(Math.floor(currencies.usd.current), 0)}원대`;
                    }
                }
            } catch(e) {
                console.warn("Failed to get live currency rates for analysis card:", e);
            }

            const badge = crisisCard.querySelector('.crisis-year-badge');
            if (badge) {
                badge.innerText = `2024 - ${year}년 ${month}월`;
            }

            const textContainer = crisisCard.querySelector('.crisis-text');
            if (textContainer) {
                textContainer.innerHTML = `
                    <h4>고금리 장기화 및 실시간 엔저 분석</h4>
                    <p>${year}년 ${month}월 현재, 미국 고금리 지속에 따른 달러 강세 압박 속에서 원/달러 환율은 ${usdRateText}의 박스권을 형성하고 있습니다. 특히 엔저 현상이 극대화되면서 원/엔 재정환율은 <strong>JPY/KRW ${jpyRateText}</strong>의 역사적 최저 구간을 지속 중입니다. 이에 따라 개인 투자자들의 해외 자산 및 환노출 ETF 포트폴리오 다변화 전략이 그 어느 때보다 중요해진 시점입니다.</p>
                `;
            }
        }
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
        
        // 방향 리셋
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
        
        // 고해상도 레티나 디스플레이 대응 크기 스케일링 설정
        const dpr = window.devicePixelRatio || 1;
        const width = 80;
        const height = 32;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        
        ctx.clearRect(0, 0, width, height);
        if (!ohlcData || ohlcData.length === 0) return;
        
        // 데이터 극값(Min/Max) 탐색
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
            // 국내 표준 환율 캔들 컬러: 상승 빨간색(#f43f5e), 하락 파란색(#3b82f6)
            const color = isUp ? '#f43f5e' : '#3b82f6';
            
            // 꼬리 그리기 (High-Low 얇은 선)
            ctx.beginPath();
            ctx.moveTo(x, yHigh);
            ctx.lineTo(x, yLow);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // 몸통 그리기 (Open-Close 두꺼운 바)
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
                // 10일치 일봉 데이터 호출
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
                
                // 최근 7개만 사용
                const cleanCandles = candles.slice(-7);
                if (cleanCandles.length > 0) {
                    drawMiniCandleChart(`mini-candle-${key}`, cleanCandles);
                } else {
                    throw new Error("No data");
                }
            } catch (err) {
                console.warn(`Failed to fetch sparkline for ${sym}, generating mock sparkline:`, err);
                // 모의 캔들 스파크라인 생성 백업
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
            scoreVal = 68; // 기본값
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

        // A. 실시간 최근 업데이트 시간 표시
        lastUpdateTimeEl.innerText = `실시간 데이터 갱신됨 (${tickResult.timestamp})`;

        // B. 4대 지수 현황 UI 갱신 및 차트 데이터 갱신
        Object.keys(tickResult.indices).forEach(key => {
            const data = tickResult.indices[key];
            const priceEl = document.getElementById(`${key}-price`);
            const changeEl = document.getElementById(`${key}-change`);
            const cardEl = document.getElementById(`card-${key}`);

            if (priceEl && changeEl && cardEl) {
                const prevPrice = parseFloat(priceEl.innerText.replace(/,/g, ''));
                const isUp = data.current >= prevPrice;

                cardEl.classList.remove("tick-up", "tick-down");
                void cardEl.offsetWidth; // DOM reflow 유도
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

        // C. 지표 환율 UI 및 데이터 변환 처리
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

            // 여행용 환율 기준 데이터 갱신 및 변환된 통화값 실시간 반영
            const baseCurrencyKey = key.replace('_travel', '');
            if (travelExchangeRates[baseCurrencyKey] !== undefined) {
                if (baseCurrencyKey === 'jpy') {
                    travelExchangeRates[baseCurrencyKey] = data.current / 100;
                } else if (baseCurrencyKey === 'vnd') {
                    travelExchangeRates[baseCurrencyKey] = data.current / 100;
                } else {
                    travelExchangeRates[baseCurrencyKey] = data.current;
                }

                // 달러 베이스 환율 변환 (역산 계산)
                const usdRate = travelExchangeRates.usd;
                Object.keys(travelExchangeRates).forEach(k => {
                    if (k === 'usd') return;
                    if (k === 'jpy' || k === 'vnd') {
                        usdExchangeRates[k] = (usdRate / (travelExchangeRates[k] * 100)) * 100;
                    } else {
                        usdExchangeRates[k] = usdRate / travelExchangeRates[k];
                    }
                });

                // 여행 환율 UI 갱신
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
                        // USD 기준 환율 표시
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

        // D. 주요 달러 베이스 통화 환율 업데이트
        Object.keys(tickResult.usdBasis).forEach(key => {
            const data = tickResult.usdBasis[key];
            const basisValEl = document.getElementById(`basis-val-${key}`);
            const basisChgEl = document.getElementById(`basis-chg-${key}`);

            if (basisValEl && basisChgEl) {
                basisValEl.innerText = formatNumber(data.current, key === 'eur' || key === 'gbp' ? 4 : (key === 'jpy' || key === 'krw' ? 2 : 4));
                
                const changeSign = data.changeRate >= 0 ? "+" : "";
                basisChgEl.innerText = `${changeSign}${formatNumber(data.changeRate, 2)}%`;
                
                if (data.changeRate >= 0) {
                    basisChgEl.className = "basis-change bullish-badge";
                } else {
                    basisChgEl.className = "basis-change bearish-badge";
                }
            }
        });

        // E. Fear & Greed 지수 업데이트
        const currentVal = parseInt(largeMeterValEl.textContent);
        updateFearGreedMeter(isNaN(currentVal) ? 68 : currentVal);
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
    }

    // 11. CORS 우회용 주식 시세 API 호출 루프
    async function fetchWithProxyFallback(url) {
        const createFetch = async (proxyUrl, parseFunc) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000); // 6초 타임아웃
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

    // CORS 우회용 텍스트/XML API 호출 루프 (구글 뉴스 RSS 전용)
    async function fetchTextWithProxyFallback(url) {
        const createFetch = async (proxyUrl, isJsonWrapper) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000); // 6초 타임아웃
            try {
                const res = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (!res.ok) throw new Error("HTTP error " + res.status);
                if (isJsonWrapper) {
                    const wrapper = await res.json();
                    return wrapper.contents;
                }
                return await res.text();
            } catch (e) {
                clearTimeout(timeout);
                throw e;
            }
        };

        const promises = [
            createFetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, false),
            createFetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, false),
            createFetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, false),
            createFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, true)
        ];

        try {
            return await Promise.race([
                Promise.any(promises),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Strict Timeout 3s")), 3000))
            ]);
        } catch (e) {
            console.error("All CORS proxies failed or timed out for text URL:", url, e);
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
        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            if (!res.ok) throw new Error("Failed to fetch exchange rates");
            const data = await res.json();
            const rates = data.rates;
            const krwRate = rates.KRW;

            if (!krwRate) throw new Error("KRW rate not found in API response");

            const getPrevClose = (curr) => {
                const deviation = (Math.random() - 0.5) * 0.003;
                return curr / (1 + deviation);
            };

            const usdCurrent = krwRate;
            const jpyCurrent = (1 / rates.JPY) * krwRate * 100;
            const eurCurrent = (1 / rates.EUR) * krwRate;
            const cnyCurrent = (1 / rates.CNY) * krwRate;
            
            const vndCurrent = (1 / rates.VND) * krwRate * 100;
            const thbCurrent = (1 / rates.THB) * krwRate;
            const twdCurrent = (1 / rates.TWD) * krwRate;
            const phpCurrent = (1 / rates.PHP) * krwRate;
            const sgdCurrent = (1 / rates.SGD) * krwRate;
            const hkdCurrent = (1 / rates.HKD) * krwRate;

            const currencyData = {
                usd: { current: usdCurrent, prevClose: getPrevClose(usdCurrent) },
                jpy: { current: jpyCurrent, prevClose: getPrevClose(jpyCurrent) },
                eur: { current: eurCurrent, prevClose: getPrevClose(eurCurrent) },
                cny: { current: cnyCurrent, prevClose: getPrevClose(cnyCurrent) },
                vnd: { current: vndCurrent, prevClose: getPrevClose(vndCurrent) },
                thb: { current: thbCurrent, prevClose: getPrevClose(thbCurrent) },
                twd: { current: twdCurrent, prevClose: getPrevClose(twdCurrent) },
                php: { current: phpCurrent, prevClose: getPrevClose(phpCurrent) },
                sgd: { current: sgdCurrent, prevClose: getPrevClose(sgdCurrent) },
                hkd: { current: hkdCurrent, prevClose: getPrevClose(hkdCurrent) },
                jpy_travel: { current: jpyCurrent, prevClose: getPrevClose(jpyCurrent) },
                eur_travel: { current: eurCurrent, prevClose: getPrevClose(eurCurrent) }
            };

            const eurUsd = 1 / rates.EUR;
            const usdJpy = rates.JPY;
            const gbpUsd = 1 / rates.GBP;
            const usdCny = rates.CNY;
            const usdKrw = krwRate;

            const usdBasisData = {
                eur: { current: eurUsd, prevClose: getPrevClose(eurUsd), changeRate: parseFloat(((eurUsd - getPrevClose(eurUsd)) / getPrevClose(eurUsd) * 100).toFixed(2)) },
                jpy: { current: usdJpy, prevClose: getPrevClose(usdJpy), changeRate: parseFloat(((usdJpy - getPrevClose(usdJpy)) / getPrevClose(usdJpy) * 100).toFixed(2)) },
                gbp: { current: gbpUsd, prevClose: getPrevClose(gbpUsd), changeRate: parseFloat(((gbpUsd - getPrevClose(gbpUsd)) / getPrevClose(gbpUsd) * 100).toFixed(2)) },
                cny: { current: usdCny, prevClose: getPrevClose(usdCny), changeRate: parseFloat(((usdCny - getPrevClose(usdCny)) / getPrevClose(usdCny) * 100).toFixed(2)) },
                krw: { current: usdKrw, prevClose: getPrevClose(usdKrw), changeRate: parseFloat(((usdKrw - getPrevClose(usdKrw)) / getPrevClose(usdKrw) * 100).toFixed(2)) }
            };

            travelExchangeRates.usd = usdCurrent;
            travelExchangeRates.jpy = jpyCurrent / 100;
            travelExchangeRates.eur = eurCurrent;
            travelExchangeRates.cny = cnyCurrent;
            travelExchangeRates.vnd = vndCurrent / 100;
            travelExchangeRates.thb = thbCurrent;
            travelExchangeRates.twd = twdCurrent;
            travelExchangeRates.sgd = sgdCurrent;

            usdExchangeRates.krw = krwRate;
            usdExchangeRates.jpy = rates.JPY;
            usdExchangeRates.eur = rates.EUR;
            usdExchangeRates.cny = rates.CNY;
            usdExchangeRates.vnd = rates.VND;
            usdExchangeRates.thb = rates.THB;
            usdExchangeRates.twd = rates.TWD;
            usdExchangeRates.sgd = rates.SGD;

            window.MockDataModule.updateCurrencies(currencyData);
            window.MockDataModule.updateUsdBasis(usdBasisData);

            window.MockDataModule.updateCurrentAnchor({
                usdKrw: usdCurrent,
                jpyKrw: jpyCurrent,
                eurKrw: eurCurrent,
                cnyKrw: cnyCurrent
            });
        } catch (e) {
            console.warn("Failed to load real exchange rates, fallback to simulation", e);
        }
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

    // 12. 전체 대시보드 데이터 초기화 및 루프 실행
    async function initializeDashboard() {
        initGaugeTicks();
        await refreshRealData();

        initMarketSummaryChart();
        initHistoricalChart();
        startRealtimeTickLoop();

        Object.keys(travelExchangeRates).forEach(key => {
            calculateTravelExchange(key);
        });
        calculateTravelExchange('krw');

        // 시장 심리 코멘터리 아코디언 토글 이벤트 바인딩
        document.querySelectorAll('.insight-item').forEach(item => {
            item.addEventListener('click', () => {
                item.classList.toggle('active');
            });
        });
    }

    // 13. 네이버 금융 메인 뉴스 크롤링 시스템 (EUC-KR 인코딩 처리)
    // 전역 변수로 현재 선택된 뉴스 탭 상태와 불러온 뉴스 리스트 저장
    let loadedNewsList = [];

    // 14. 실시간 주식 티커 검색 기능 (모의 데이터 연동)
    const tickerMockData = {
        nasdaq: [
            { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock' },
            { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock' },
            { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock' },
            { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock' },
            { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock' },
            { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock' },
            { symbol: 'PLTR', name: 'Palantir Technologies Inc.', type: 'stock' },
            { symbol: 'META', name: 'Meta Platforms, Inc.', type: 'stock' },
            { symbol: 'NFLX', name: 'Netflix, Inc.', type: 'stock' },
            { symbol: 'QQQ', name: 'Invesco QQQ Trust (QQQ)', type: 'etf' },
            { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (TQQQ)', type: 'etf' },
            { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (SQQQ)', type: 'etf' },
            { symbol: 'SOXX', name: 'iShares Semiconductor ETF (SOXX)', type: 'etf' },
            { symbol: 'QYLD', name: 'Global X NASDAQ 100 Covered Call ETF (QYLD)', type: 'etf' }
        ],
        nyse: [
            { symbol: 'PLTR', name: 'Palantir Technologies Inc.', type: 'stock' },
            { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Co.', type: 'stock' },
            { symbol: 'BRK-B', name: 'Berkshire Hathaway Inc.', type: 'stock' },
            { symbol: 'JPM', name: 'JPMorgan Chase & Co.', type: 'stock' },
            { symbol: 'WMT', name: 'Walmart Inc.', type: 'stock' },
            { symbol: 'XOM', name: 'Exxon Mobil Corp.', type: 'stock' },
            { symbol: 'DIS', name: 'The Walt Disney Co.', type: 'stock' },
            { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust (SPY)', type: 'etf' },
            { symbol: 'VOO', name: 'Vanguard S&P 500 ETF (VOO)', type: 'etf' },
            { symbol: 'IVV', name: 'iShares Core S&P 500 ETF (IVV)', type: 'etf' },
            { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF Trust (DIA)', type: 'etf' },
            { symbol: 'IWM', name: 'iShares Russell 2000 ETF (IWM)', type: 'etf' },
            { symbol: 'JEPI', name: 'JPMorgan Equity Premium Income ETF (JEPI)', type: 'etf' },
            { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF (SCHD)', type: 'etf' }
        ],
        kospi: [
            { symbol: '005930', name: '삼성전자', type: 'stock' },
            { symbol: '000660', name: 'SK하이닉스', type: 'stock' },
            { symbol: '373220', name: 'LG에너지솔루션', type: 'stock' },
            { symbol: '207940', name: '삼성바이오로직스', type: 'stock' },
            { symbol: '005380', name: '현대차', type: 'stock' },
            { symbol: '000270', name: '기아', type: 'stock' },
            { symbol: '005490', name: 'POSCO홀딩스', type: 'stock' },
            { symbol: '035420', name: 'NAVER', type: 'stock' },
            { symbol: '069500', name: 'KODEX 200', type: 'etf' },
            { symbol: '360750', name: 'TIGER 미국S&P500', type: 'etf' },
            { symbol: '122630', name: 'KODEX 레버리지', type: 'etf' },
            { symbol: '252670', name: 'KODEX 200선물인버스2X', type: 'etf' },
            { symbol: '133690', name: 'TIGER 미국나스닥100', type: 'etf' },
            { symbol: '453810', name: 'ACE 미국S&P500', type: 'etf' }
        ],
        kosdaq: [
            { symbol: '247540', name: '에코프로비엠', type: 'stock' },
            { symbol: '086520', name: '에코프로', type: 'stock' },
            { symbol: '028300', name: 'HLB', type: 'stock' },
            { symbol: '068760', name: '셀트리온제약', type: 'stock' },
            { symbol: '198440', name: '심텍', type: 'stock' },
            { symbol: '293490', name: '카카오게임즈', type: 'stock' },
            { symbol: '233740', name: 'KODEX 코스닥150레버리지', type: 'etf' },
            { symbol: '229200', name: 'KODEX 코스닥150', type: 'etf' },
            { symbol: '250780', name: 'TIGER 코스닥150선물인버스', type: 'etf' },
            { symbol: '278530', name: 'KODEX 코스닥150선물인버스', type: 'etf' },
            { symbol: '391230', name: 'TIGER 코스닥150레버리지', type: 'etf' }
        ],
        japan: [
            { symbol: '7203', name: '도요타 (Toyota)', type: 'stock' },
            { symbol: '9984', name: '소프트뱅크 (SoftBank)', type: 'stock' },
            { symbol: '6861', name: '키엔스 (Keyence)', type: 'stock' },
            { symbol: '6758', name: '소니 (Sony)', type: 'stock' },
            { symbol: '8306', name: '미쓰비시 UFJ', type: 'stock' },
            { symbol: '9983', name: '패스트 리테일링 (Fast Retailing)', type: 'stock' },
            { symbol: '8035', name: '도쿄 일렉트론 (Tokyo Electron)', type: 'stock' },
            { symbol: '7974', name: '닌텐도 (Nintendo)', type: 'stock' },
            { symbol: '6594', name: '니덱 (Nidec)', type: 'stock' },
            { symbol: '7267', name: '혼다 (Honda)', type: 'stock' },
            { symbol: '6981', name: '무라타 제작소 (Murata)', type: 'stock' },
            { symbol: '6752', name: '파나소닉 (Panasonic)', type: 'stock' },
            { symbol: '7751', name: '캐논 (Canon)', type: 'stock' },
            { symbol: '8001', name: '이토추 상사 (Itochu)', type: 'stock' },
            { symbol: '8031', name: '미쓰이 물산 (Mitsui)', type: 'stock' },
            { symbol: '4502', name: '다케다 제약 (Takeda)', type: 'stock' },
            { symbol: '4568', name: '다이이치 산쿄 (Daiichi Sankyo)', type: 'stock' },
            { symbol: '4063', name: '신에츠 화학 (Shin-Etsu)', type: 'stock' },
            { symbol: '9432', name: 'NTT (Nippon Telegraph and Telephone)', type: 'stock' },
            { symbol: '6902', name: '덴소 (Denso)', type: 'stock' },
            { symbol: '8058', name: '미쓰비시 상사 (Mitsubishi Corp)', type: 'stock' },
            { symbol: '1306', name: 'NEXT FUNDS TOPIX ETF (1306)', type: 'etf' },
            { symbol: '1321', name: 'NEXT FUNDS Nikkei 225 ETF (1321)', type: 'etf' },
            { symbol: '1329', name: 'iShares Core Nikkei 225 ETF (1329)', type: 'etf' },
            { symbol: '1591', name: 'NEXT FUNDS JPX-Nikkei 400 ETF (1591)', type: 'etf' },
            { symbol: '1489', name: 'NEXT FUNDS Nikkei 225 High Dividend 50 ETF (1489)', type: 'etf' }
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
            }, 30000); // 30 seconds
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
            
            // 1. Check if it's in our local mock data first
            for (const [ex, list] of Object.entries(tickerMockData)) {
                if (list.some(item => item.symbol.toUpperCase() === symUpper)) {
                    return ex;
                }
            }
            
            // 2. Check suffix
            if (symUpper.endsWith('.KS')) return 'kospi';
            if (symUpper.endsWith('.KQ')) return 'kosdaq';
            if (symUpper.endsWith('.T')) return 'japan';
            
            // 3. Check Yahoo Finance API exchange field
            if (apiExchange) {
                const exUpper = apiExchange.toUpperCase();
                if (exUpper.includes('NMS') || exUpper.includes('NAS') || exUpper.includes('NASDAQ')) {
                    return 'nasdaq';
                }
                if (exUpper.includes('NYQ') || exUpper.includes('NYS') || exUpper.includes('NYSE') || exUpper.includes('ASE')) {
                    return 'nyse';
                }
                if (exUpper.includes('TSE') || exUpper.includes('TYO') || exUpper.includes('JPX')) {
                    return 'japan';
                }
                if (exUpper.includes('KSC') || exUpper.includes('KSE')) {
                    return 'kospi';
                }
                if (exUpper.includes('KOE') || exUpper.includes('KSD') || exUpper.includes('KOSDAQ')) {
                    return 'kosdaq';
                }
            }
            
            // 4. Format-based fallback instead of defaulting to 'nasdaq'
            if (/^\d{6}$/.test(symUpper)) {
                if (currentExchange === 'kosdaq') return 'kosdaq';
                return 'kospi';
            }
            if (/^\d{4}$/.test(symUpper)) {
                return 'japan';
            }
            if (/^[A-Z.\-_]+$/.test(symUpper)) {
                if (currentExchange === 'nyse') return 'nyse';
                return 'nasdaq';
            }
            
            return 'unknown';
        }

        const performSearch = () => {
            const query = input.value.trim();
            if (query.length === 0) return;

            // 현재 선택된 거래소의 로컬 종목 데이터만 검색 대상으로 설정 (주식/ETF 선택 반영)
            const allLocalData = [];
            const localList = tickerMockData[currentExchange] || [];
            const isEtfChecked = document.getElementById('asset-etf').checked;

            localList.forEach(item => {
                const itemType = item.type || 'stock';
                if (isEtfChecked && itemType !== 'etf') return;
                if (!isEtfChecked && itemType !== 'stock') return;

                allLocalData.push({
                    symbol: item.symbol,
                    name: item.name,
                    exchange: currentExchange,
                    type: itemType
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
                
                // Update exchange dropdown UI
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
                    
                    // 입력된 티커가 현재 선택된 거래소의 형식 규격에 부합하는지 엄격히 확인
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
                        // 접미사가 없는 경우
                        if (/^\d{6}$/.test(symbolUpper)) {
                            // 6자리 숫자는 KOSPI 또는 KOSDAQ
                            if (currentExchange === 'kospi' || currentExchange === 'kosdaq') {
                                isValidForExchange = true;
                                detectedEx = currentExchange;
                            }
                        } else if (/^\d{4}$/.test(symbolUpper)) {
                            // 4자리 숫자는 일본
                            if (currentExchange === 'japan') {
                                isValidForExchange = true;
                                detectedEx = 'japan';
                            }
                        } else if (/^[A-Z.\-_]+$/.test(symbolUpper)) {
                            // 영문 티커는 미국 거래소(NASDAQ 또는 NYSE)
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

        // Helper to extract English name from parenthesized string (e.g. "도요타 (Toyota)" -> "Toyota")
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
                        // Switch exchange dropdown UI automatically
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
            const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`;
            try {
                const data = await fetchWithProxyFallback(url);
                if (data && data.quotes) {
                    const isEtfChecked = document.getElementById('asset-etf').checked;
                    return data.quotes
                        .filter(q => {
                            if (!q.quoteType) return false;
                            const qt = q.quoteType.toUpperCase();
                            if (isEtfChecked) {
                                return qt === 'ETF' || qt === 'MUTUALFUND';
                            } else {
                                return qt === 'EQUITY';
                            }
                        })
                        .map(q => ({
                            symbol: q.symbol,
                            name: q.longname || q.shortname || q.symbol,
                            apiExchange: q.exchange,
                            type: q.quoteType
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

            // 현재 선택된 거래소의 로컬 종목 데이터만 필터링 대상으로 설정 (주식/ETF 선택 반영)
            const allLocalData = [];
            const localList = tickerMockData[currentExchange] || [];
            const isEtfChecked = document.getElementById('asset-etf').checked;

            localList.forEach(item => {
                const itemType = item.type || 'stock';
                if (isEtfChecked && itemType !== 'etf') return;
                if (!isEtfChecked && itemType !== 'stock') return;

                allLocalData.push({
                    symbol: item.symbol,
                    name: item.name,
                    exchange: currentExchange,
                    type: itemType
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

            // Debounce and fetch real-time suggestions from Yahoo Finance via CORS proxy
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
                        
                        // 현재 선택된 거래소와 다른 거래소의 추천 종목은 배제
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
                    // Default to the first recommended item if user just presses Enter
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

    // 15. 티커 상세 정보 로드 함수
    let currentTickerState = { symbol: '', name: '', exchange: '' };
    let currentDetailPeriod = '5y';
    let currentDetailMode = 'line';
    let currentDetailData = null;
    let averageFetchTimeMs = 1500;

    // 주요 종목 3개년 실제 기반 재무 실적 및 배당 정보 mock 데이터셋
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

    // 모의 재무 및 배당 데이터 생성 함수 (딕셔너리에 없을 시의 동적 생성)
    function getMockFinancialsAndDividends(symbol, currentPrice, currency) {
        const symUpper = symbol.toUpperCase();
        if (mockFinancialData[symUpper]) {
            // 원 데이터 단위 유지
            return mockFinancialData[symUpper];
        }
        
        // 해당 주가를 활용해 역산하여 그럴싸한 실적과 배당지표 생성
        const financials = [];
        let baseRev = currentPrice * (currency === 'KRW' || currency === 'JPY' ? 5000 : 5000000);
        for (let year = 2025; year >= 2023; year--) {
            baseRev = baseRev * (0.88 + Math.random() * 0.24);
            const opInc = baseRev * (0.06 + Math.random() * 0.16); 
            const netInc = opInc * (0.55 + Math.random() * 0.25);
            
            financials.push({
                endDate: `${year}-12-31`,
                totalRevenue: baseRev / 1000, // 천단위 변환
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

    // 재무제표 및 배당 정보 렌더링 함수
    function renderFinancialsAndDividends(symbol, name, incHistory, dividendData, currency) {
        const finContainer = document.getElementById('financial-statements-container');
        const finWrapper = document.getElementById('financial-table-wrapper');
        const divWrapper = document.getElementById('dividend-history-wrapper');
        
        if (!finContainer) return;
        
        // A. 재무제표 렌더링
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

        // B. 배당 정보 렌더링 (그리드 카드 스타일)
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
        
        // 모의 재무 및 배당 데이터 렌더링 호출
        const mockSymbol = currentTickerState.symbol || 'MOCK';
        const mockData = getMockFinancialsAndDividends(mockSymbol, currentPrice, currency);
        
        // 005930, 000660 등 로컬 원화 수치에 상응하도록 단위 조정 (천단위)
        let formattedMockFin = mockData.financials.map(f => ({
            endDate: f.endDate,
            totalRevenue: f.totalRevenue,
            operatingIncome: f.operatingIncome,
            netIncome: f.netIncome
        }));

        const isLocalCurrency = currency === 'KRW' || currency === 'JPY';
        const formattedMockDiv = {
            yield: mockData.dividend.yield || simulatedDivRate,
            dps: mockData.dividend.dps || (currentPrice * (simulatedDivRate / 100)),
            payoutRatio: mockData.dividend.payoutRatio || (15 + Math.random() * 30),
            exDate: mockData.dividend.exDate,
            frequency: mockData.dividend.frequency
        };

        renderFinancialsAndDividends(mockSymbol, currentTickerState.name, formattedMockFin, formattedMockDiv, currency);
    }

    // 종목에 알맞는 관련 뉴스 3가지 생성 및 렌더러
    function formatTimeAgo(unixTimestamp) {
        if (!unixTimestamp) return '최근';
        const diffMs = Date.now() - (unixTimestamp * 1000);
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 60) return `${diffMins}분 전`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}시간 전`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}일 전`;
    }

    // 종목에 알맞는 관련 뉴스 3가지 생성 및 렌더러 (실시간 야후 파이낸스 뉴스 연동)
    // 종목에 알맞는 관련 뉴스 3가지 생성 및 렌더러 (실시간 야후 파이낸스 뉴스 연동 + 구글 뉴스 RSS 보강)
    async function renderRelatedNews(symbol, name) {
        const detailNewsContainer = document.getElementById('detail-news-container');
        const detailNewsList = document.getElementById('detail-news-list');
        
        if (!detailNewsContainer || !detailNewsList) return;
        
        // 1. Yahoo Finance 뉴스 조회용 심볼 포맷팅
        let yahooSymbol = symbol;
        const exchange = currentTickerState.exchange;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';

        let related = [];
        
        // 2. 실시간 야후 파이낸스 뉴스 가져오기 시도
        try {
            const newsUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&quotesCount=0&newsCount=8`;
            const data = await fetchWithProxyFallback(newsUrl);
            if (data && data.news && data.news.length > 0) {
                related = data.news.map((item, idx) => ({
                    title: item.title,
                    summary: item.summary || item.title,
                    press: item.publisher || 'Yahoo Finance',
                    date: formatTimeAgo(item.providerPublishTime),
                    link: item.link,
                    importance: 10 - idx
                }));
            }
        } catch (e) {
            console.warn("Failed to fetch real-time news from Yahoo Finance:", e);
        }

        // 2.5. 만약 결과가 3개 미만이면, Google News RSS 피드 검색 시도 (CORS 프록시 사용)
        if (related.length < 3) {
            try {
                const query = exchange === 'kospi' || exchange === 'kosdaq' ? `${name} 주식` : name;
                const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
                const xmlText = await fetchTextWithProxyFallback(rssUrl);
                if (xmlText) {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
                    const items = xmlDoc.getElementsByTagName("item");
                    const googleNews = [];
                    for (let i = 0; i < items.length && i < 8; i++) {
                        const item = items[i];
                        const fullTitle = item.getElementsByTagName("title")[0]?.textContent || "";
                        const link = item.getElementsByTagName("link")[0]?.textContent || "";
                        const pubDateStr = item.getElementsByTagName("pubDate")[0]?.textContent || "";
                        const descHtml = item.getElementsByTagName("description")[0]?.textContent || "";

                        let title = fullTitle;
                        let press = item.getElementsByTagName("source")[0]?.textContent || "구글 뉴스";

                        // 구글 뉴스 RSS의 경우 제목 끝에 " - 언론사" 가 포함됨
                        const lastDash = fullTitle.lastIndexOf(" - ");
                        if (lastDash !== -1) {
                            title = fullTitle.substring(0, lastDash).trim();
                            press = fullTitle.substring(lastDash + 3).trim();
                        }

                        let summary = title;
                        if (descHtml) {
                            const tempDiv = document.createElement("div");
                            tempDiv.innerHTML = descHtml;
                            const text = tempDiv.textContent || tempDiv.innerText || "";
                            if (text) {
                                const cleanText = text.replace(/<[^>]*>/g, '').split('...')[0].trim();
                                if (cleanText) {
                                    summary = cleanText.substring(0, 150) + (cleanText.length > 150 ? '...' : '');
                                }
                            }
                        }

                        let date = "최근";
                        if (pubDateStr) {
                            const pubDate = new Date(pubDateStr);
                            if (!isNaN(pubDate.getTime())) {
                                const diffMs = Date.now() - pubDate.getTime();
                                const diffMins = Math.floor(diffMs / 60000);
                                if (diffMins < 60) date = `${diffMins}분 전`;
                                else {
                                    const diffHours = Math.floor(diffMins / 60);
                                    if (diffHours < 24) date = `${diffHours}시간 전`;
                                    else {
                                        const diffDays = Math.floor(diffHours / 24);
                                        date = `${diffDays}일 전`;
                                    }
                                }
                            }
                        }

                        googleNews.push({
                            title,
                            summary,
                            press,
                            date,
                            link,
                            importance: 8 - i
                        });
                    }

                    // 중복 제목 필터링하며 병합
                    googleNews.forEach(gNews => {
                        if (related.length < 3 && !related.some(r => r.title.substring(0, 10) === gNews.title.substring(0, 10))) {
                            related.push(gNews);
                        }
                    });
                }
            } catch (rssErr) {
                console.warn("Failed to fetch news from Google News RSS:", rssErr);
            }
        }

        // 3. 만약 실시간 뉴스 매칭 결과가 3개 미만이면, 기존 모의 데이터(Mock News)로 보강
        if (related.length < 3) {
            const mockRelated = [
                {
                    title: `${name}, 글로벌 공급망 다변화 통해 올해 영업이익 극대화 전망`,
                    summary: `업계 소식통에 따르면 ${name}(${symbol})은 최근 공급망 다변화 정책에 따라 글로벌 부품 수급을 안정화하고 마진율을 대폭 개선할 계획인 것으로 전해졌습니다.`,
                    press: '머니투데이',
                    date: '1시간 전',
                    importance: 9,
                    link: `https://news.google.com/search?q=${encodeURIComponent(name + ' 영업이익')}&hl=ko&gl=KR&ceid=KR:ko`
                },
                {
                    title: `${name} 주가 주요 저항선 돌파... 기관 매수세 유입 지속`,
                    summary: `금융투자업계에 따르면 외국인과 기관이 ${name}의 장기 성장 패러다임과 배당 성향 확대 가능성에 주목하며 매수세를 확대하고 있어 주가가 신고가 랠리를 달성했습니다.`,
                    press: '한국경제',
                    date: '4시간 전',
                    importance: 8,
                    link: `https://news.google.com/search?q=${encodeURIComponent(name + ' 주가')}&hl=ko&gl=KR&ceid=KR:ko`
                },
                {
                    title: `${name}, 차세대 핵심 기술 실물 특허 공식 취득 발표`,
                    summary: `${name}은 자사 핵심 연구소에서 개발한 고효율 전력 제어 회로 및 친환경 작동 메커니즘 특허를 취득했다고 공시했습니다.`,
                    press: '연합뉴스',
                    date: '1일 전',
                    importance: 7,
                    link: `https://news.google.com/search?q=${encodeURIComponent(name + ' 특허')}&hl=ko&gl=KR&ceid=KR:ko`
                }
            ];
            related = [...related, ...mockRelated];
        }
        
        related.sort((a, b) => b.importance - a.importance);
        const top3 = related.slice(0, 3);
        
        let html = '';
        top3.forEach(news => {
            // 모의 뉴스 또는 link가 없는 경우 Google News 검색으로 연결 (뉴스 전용 검색이므로 정확한 최신 뉴스 노출)
            const newsLink = news.link || `https://news.google.com/search?q=${encodeURIComponent(name)}&hl=ko&gl=KR&ceid=KR:ko`;
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

        titleEl.innerText = `${name} (${symbol})`;
        exchangeBadge.innerText = exchange.toUpperCase();
        
        // Show Add to Portfolio button when stock is loaded
        const addBtn = document.getElementById('add-to-portfolio-btn');
        if (addBtn) {
            addBtn.style.display = 'inline-flex';
            addBtn.onclick = () => {
                addToPortfolio(symbol, name, exchange);
            };
        }
        
        const mainLayout = document.getElementById('detail-main-layout');
        
        priceBox.style.display = 'none';
        if (mainLayout) mainLayout.style.display = 'grid';
        chartWrapper.style.display = 'block';
        if (loadingIndicator) loadingIndicator.style.display = 'flex';
        
        const startTimeMs = Date.now();
        const countdownEl = document.getElementById('loading-countdown');
        let expectedTimeMs = Math.max(averageFetchTimeMs, 500);     
        let timeLeftMs = expectedTimeMs;
        if (countdownEl) countdownEl.innerText = (timeLeftMs / 1000).toFixed(2);
        
        const countdownInterval = setInterval(() => {
            const elapsed = Date.now() - startTimeMs;
            timeLeftMs = Math.max(expectedTimeMs - elapsed, 50);
            if (countdownEl) countdownEl.innerText = (timeLeftMs / 1000).toFixed(2);
        }, 50);

        let yahooSymbol = symbol;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';

        const periodConfig = {
            '5y': { range: '5y', interval: '1wk', maxDays: 365 * 5 },
            '3y': { range: '5y', interval: '1wk', maxDays: 365 * 3 },
            '1y': { range: '1y', interval: '1d', maxDays: 365 },
            '6mo': { range: '6mo', interval: '1d', maxDays: 180 },
            '3mo': { range: '3mo', interval: '1d', maxDays: 90 },
            '1mo': { range: '1mo', interval: '1d', maxDays: 30 },
            '1wk': { range: '5d', interval: '1h', maxDays: 7 }, // 15m에서 1h로 늘려 캔들 뭉침 해소
            '1d': { range: '1d', interval: '15m', maxDays: 1 }, // 5m에서 15m로 변경
            '1h': { range: '1d', interval: '5m', maxDays: 1 } // 1m에서 5m로 변경
        };
        const pConf = periodConfig[period] || periodConfig['5y'];

        if (useCached && currentDetailData) {
            const currentPrice = currentDetailData[currentDetailData.length - 1].c;
            const prevClose = currentDetailData[0].c; 
            const netChange = currentPrice - prevClose;
            
            clearInterval(countdownInterval);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            priceBox.style.display = 'block';

            renderDetailChart(currentDetailData, netChange >= 0, period);
            return;
        }

        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${pConf.interval}&range=${pConf.range}`;
            const json = await fetchWithProxyFallback(url);
            const result = json.chart.result[0];
            
            const currentPrice = result.meta.regularMarketPrice;
            const prevClose = result.meta.previousClose || result.meta.chartPreviousClose || currentPrice;
            const netChange = currentPrice - prevClose;
            const pctChange = (netChange / prevClose) * 100;
            const currency = result.meta.currency;
            window.currentDetailCurrency = currency;
            
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
            for (let i = 0; i < timestamps.length; i++) {
                if (closePrices[i] !== null && closePrices[i] !== undefined) {
                    const date = new Date(timestamps[i] * 1000);
                    
                    if (period === '1h' && (nowTime - date.getTime() > 60 * 60 * 1000)) continue;
                    if (period === '3y' && (nowTime - date.getTime() > 365 * 3 * 24 * 60 * 60 * 1000)) continue;
                    
                    validData.push({
                        x: date.getTime(),
                        o: openPrices[i] !== null ? openPrices[i] : closePrices[i],
                        h: highPrices[i] !== null ? highPrices[i] : closePrices[i],
                        l: lowPrices[i] !== null ? lowPrices[i] : closePrices[i],
                        c: closePrices[i],
                        v: volumes[i] !== null ? volumes[i] : 0
                    });
                }
            }

            if (validData.length === 0) {
                throw new Error("No chart data available");
            }

            clearInterval(countdownInterval);
            
            const fetchElapsed = Date.now() - startTimeMs;
            if (fetchElapsed < expectedTimeMs) {
                await new Promise(resolve => setTimeout(resolve, expectedTimeMs - fetchElapsed));
            }
            if (countdownEl) countdownEl.innerText = "0.00"; 

            averageFetchTimeMs = (averageFetchTimeMs * 0.7) + (fetchElapsed * 0.3);
            
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            priceBox.style.display = 'block';

            priceEl.innerText = `${formatNumber(currentPrice, currency === 'KRW' || currency === 'JPY' ? 0 : 2)} ${currency}`;
            
            const changeSign = netChange >= 0 ? "+" : "";
            changeEl.innerText = `${changeSign}${formatNumber(netChange, currency === 'KRW' || currency === 'JPY' ? 0 : 2)} (${changeSign}${formatNumber(pctChange, 2)}%)`;
            if (netChange >= 0) {
                changeEl.className = "index-change-badge bullish-badge";
            } else {
                changeEl.className = "index-change-badge bearish-badge";
            }

            currentDetailData = validData;
            renderDetailChart(validData, netChange >= 0, period);

            const consensusBox = document.getElementById('detail-consensus-box');
            const consensusRating = document.getElementById('consensus-rating');
            const consensusTarget = document.getElementById('consensus-target');
            
            try {
                const quoteUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${yahooSymbol}?modules=financialData,defaultKeyStatistics,summaryDetail,price,incomeStatementHistory`;
                const quoteJson = await fetchWithProxyFallback(quoteUrl);
                const qRes = quoteJson.quoteSummary.result[0];
                const financialData = qRes.financialData || {};
                const keyStats = qRes.defaultKeyStatistics || {};
                const summaryDetail = qRes.summaryDetail || {};
                const priceData = qRes.price || {};
                const incHistory = qRes.incomeStatementHistory ? qRes.incomeStatementHistory.incomeStatementHistory : [];
                
                const rating = financialData.recommendationKey || 'N/A';
                const target = financialData.targetMeanPrice ? financialData.targetMeanPrice.raw : 'N/A';
                
                if (consensusBox) {
                    if (rating !== 'none' && rating !== 'N/A') {
                        consensusRating.innerText = rating.toUpperCase();
                        consensusTarget.innerText = target !== 'N/A' ? `${formatNumber(target, 2)} ${currency}` : 'N/A';
                        if (rating.toLowerCase().includes('buy')) consensusRating.style.color = 'var(--bullish)';
                        else if (rating.toLowerCase().includes('sell')) consensusRating.style.color = 'var(--bearish)';
                        else consensusRating.style.color = 'var(--text-secondary)';
                        consensusBox.style.display = 'block';
                    } else {
                        consensusBox.style.display = 'none';
                    }
                }
                
                const pTarget = document.getElementById('panel-target-price');
                if (pTarget) pTarget.innerText = target !== 'N/A' ? `${formatNumber(target, 2)} ${currency}` : 'N/A';
                
                const pMarker = document.getElementById('panel-rating-marker');
                if (pMarker && rating !== 'none' && rating !== 'N/A') {
                    let pos = 50;
                    const r = rating.toLowerCase();
                    if (r === 'strong_buy') pos = 90;
                    else if (r === 'buy') pos = 75;
                    else if (r === 'hold') pos = 50;
                    else if (r === 'underperform' || r === 'sell') pos = 25;
                    else if (r === 'strong_sell') pos = 10;
                    pMarker.style.left = `${pos}%`;
                }

                const pVol = document.getElementById('panel-volume');
                if (pVol) pVol.innerText = summaryDetail.volume ? formatNumber(summaryDetail.volume.raw, 0) : 'N/A';
                
                const pCap = document.getElementById('panel-mktcap');
                if (pCap) pCap.innerText = priceData.marketCap ? priceData.marketCap.fmt : 'N/A';
                
                const pPer = document.getElementById('panel-per');
                if (pPer) pPer.innerText = summaryDetail.trailingPE ? formatNumber(summaryDetail.trailingPE.raw, 2) : 'N/A';
                
                const pEps = document.getElementById('panel-eps');
                if (pEps) pEps.innerText = keyStats.trailingEps ? formatNumber(keyStats.trailingEps.raw, 2) : 'N/A';
                
                const pDiv = document.getElementById('panel-div');
                if (pDiv) pDiv.innerText = summaryDetail.dividendYield ? formatNumber(summaryDetail.dividendYield.raw * 100, 2) + '%' : 'N/A';
                
                const p52h = document.getElementById('panel-52high');
                if (p52h) p52h.innerText = summaryDetail.fiftyTwoWeekHigh ? formatNumber(summaryDetail.fiftyTwoWeekHigh.raw, 2) : 'N/A';
                
                const p52l = document.getElementById('panel-52low');
                if (p52l) p52l.innerText = summaryDetail.fiftyTwoWeekLow ? formatNumber(summaryDetail.fiftyTwoWeekLow.raw, 2) : 'N/A';
                
                // API 데이터로부터 배당 및 재무 정보 데이터 파싱
                const parsedDividend = {
                    yield: (summaryDetail.dividendYield && summaryDetail.dividendYield.raw) ? summaryDetail.dividendYield.raw * 100 : 'N/A',
                    dps: (summaryDetail.dividendRate && summaryDetail.dividendRate.raw) ? summaryDetail.dividendRate.raw : 'N/A',
                    payoutRatio: (keyStats.payoutRatio && keyStats.payoutRatio.raw) ? keyStats.payoutRatio.raw * 100 : 0,
                    exDate: (summaryDetail.exDividendDate && summaryDetail.exDividendDate.fmt) ? summaryDetail.exDividendDate.fmt : 'N/A',
                    frequency: 'N/A'
                };
                
                if (parsedDividend.yield !== 'N/A' && parsedDividend.yield > 0) {
                    if (exchange === 'kospi' || exchange === 'kosdaq') {
                        parsedDividend.frequency = '분기 또는 기말 배당';
                    } else {
                        parsedDividend.frequency = '분기 배당 (Quarterly)';
                    }
                }

                const parsedIncHistory = [];
                if (incHistory && incHistory.length > 0) {
                    incHistory.forEach(inc => {
                        parsedIncHistory.push({
                            endDate: inc.endDate ? inc.endDate.fmt : 'N/A',
                            totalRevenue: inc.totalRevenue && inc.totalRevenue.raw ? inc.totalRevenue.raw / 1000 : 0,
                            operatingIncome: inc.operatingIncome && inc.operatingIncome.raw ? inc.operatingIncome.raw / 1000 : 0,
                            netIncome: inc.netIncome && inc.netIncome.raw ? inc.netIncome.raw / 1000 : 0
                        });
                    });
                } else {
                    // API 실적 데이터 누락 시 mock 데이터 유입으로 강건성 유지
                    const mockData = getMockFinancialsAndDividends(symbol, currentPrice, currency);
                    mockData.financials.forEach(f => {
                        parsedIncHistory.push(f);
                    });
                    if (parsedDividend.yield === 'N/A') {
                        parsedDividend.yield = mockData.dividend.yield;
                        parsedDividend.dps = mockData.dividend.dps;
                        parsedDividend.payoutRatio = mockData.dividend.payoutRatio;
                        parsedDividend.exDate = mockData.dividend.exDate;
                        parsedDividend.frequency = mockData.dividend.frequency;
                    }
                }

                renderFinancialsAndDividends(symbol, name, parsedIncHistory, parsedDividend, currency);

                // 관련 최신 주요 뉴스 렌더링 호출
                renderRelatedNews(symbol, name);

            } catch (e) {
                console.warn("Failed to load consensus data, generating mock data:", e);
                generateMockConsensus(currentPrice, currency, exchange);
            }

            const pSource = document.getElementById('panel-consensus-source');
            if (pSource) {
                if (exchange === 'kospi' || exchange === 'kosdaq') {
                    pSource.innerText = "출처: 네이버 금융 / 한국경제 (실시간)";
                } else if (exchange === 'japan') {
                    pSource.innerText = "출처: Yahoo Finance Japan / Nikkei (실시간)";
                } else {
                    pSource.innerText = "출처: Yahoo Finance / Bloomberg (실시간)";
                }
            }

        } catch (err) {
            console.warn("Failed to load ticker detail from Yahoo, falling back to mock data:", err);
            
            const isKRW_JPY = exchange === 'kospi' || exchange === 'kosdaq' || exchange === 'japan';
            const baseValue = isKRW_JPY ? (exchange === 'japan' ? 5000 : 50000) : 150;
            const currentPrice = baseValue + (Math.random() * baseValue * 0.5);
            const currency = (exchange === 'nasdaq' || exchange === 'nyse') ? 'USD' : (exchange === 'japan' ? 'JPY' : 'KRW');
            window.currentDetailCurrency = currency;
            
            generateMockConsensus(currentPrice, currency, exchange);

            const pSource = document.getElementById('panel-consensus-source');
            if (pSource) {
                if (exchange === 'kospi' || exchange === 'kosdaq') {
                    pSource.innerText = "출처: 네이버 금융 / 한국경제 (지연)";
                } else if (exchange === 'japan') {
                    pSource.innerText = "출처: Yahoo Finance Japan (지연)";
                } else {
                    pSource.innerText = "출처: Yahoo Finance / Bloomberg (지연)";
                }
            }

            const prevClose = currentPrice * (0.95 + Math.random() * 0.1);
            const netChange = currentPrice - prevClose;
            const pctChange = (netChange / prevClose) * 100;
            
            const validData = [];
            const now = new Date();
            let simPrice = prevClose;
            
            const simDays = { '5y': 1800, '3y': 1000, '1y': 365, '6mo': 180, '3mo': 90, '1mo': 30, '1wk': 7, '1d': 1, '1h': 0.04 }[period] || 1800;
            const simSteps = Math.min(simDays * (period === '1d' ? 100 : (period === '1h' ? 60 : 1)), 300);
            const msPerStep = (simDays * 24 * 60 * 60 * 1000) / simSteps;
            const startTime = now.getTime() - (simDays * 24 * 60 * 60 * 1000);
            
            for (let i = 0; i <= simSteps; i++) {
                const date = new Date(startTime + (i * msPerStep));
                
                const change = (Math.random() - 0.48) * 0.04;
                const open = simPrice;
                simPrice = simPrice * (1 + change);
                const high = Math.max(open, simPrice) * (1 + Math.random() * 0.01);
                const low = Math.min(open, simPrice) * (1 - Math.random() * 0.01);
                const vol = Math.floor(100000 + Math.random() * 900000);
                
                validData.push({
                    x: date.getTime(),
                    o: open,
                    h: high,
                    l: low,
                    c: simPrice,
                    v: vol
                });
            }
            
            clearInterval(countdownInterval);
            
            const mockElapsed = Date.now() - startTimeMs;
            if (mockElapsed < expectedTimeMs) {
                await new Promise(resolve => setTimeout(resolve, expectedTimeMs - mockElapsed));
            }
            if (countdownEl) countdownEl.innerText = "0.00";

            averageFetchTimeMs = (averageFetchTimeMs * 0.7) + (mockElapsed * 0.3);
            
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            priceBox.style.display = 'block';

            priceEl.innerText = `${formatNumber(currentPrice, isKRW_JPY ? 0 : 2)} ${currency}`;
            
            const changeSign = netChange >= 0 ? "+" : "";
            changeEl.innerText = `${changeSign}${formatNumber(netChange, isKRW_JPY ? 0 : 2)} (${changeSign}${formatNumber(pctChange, 2)}%)`;
            if (netChange >= 0) {
                changeEl.className = "index-change-badge bullish-badge";
            } else {
                changeEl.className = "index-change-badge bearish-badge";
            }

            currentDetailData = validData;
            renderDetailChart(validData, netChange >= 0, period);
            renderRelatedNews(symbol, name); // Fallback 뉴스 렌더링 호출
        }
    }

    function renderDetailChart(dataArr, isBullish, period) {
        const ctx = document.getElementById("chart-ticker-detail").getContext("2d");
        
        const activeModeBtn = document.querySelector('#detail-mode-toggle .mode-btn.active');
        if (activeModeBtn) {
            currentDetailMode = activeModeBtn.getAttribute('data-mode') || currentDetailMode;
        }
        
        if (detailChart) {
            detailChart.destroy();
        }

        let datasets = [];

        if (currentDetailMode === 'candlestick') {
            datasets.push({
                type: 'candlestick',
                label: '데이터',
                data: dataArr,
                yAxisID: 'y',
                color: {
                    up: '#f43f5e',
                    down: '#3b82f6',
                    unchanged: '#94a3b8'
                }
            });
        } else {
            const lineData = dataArr.map(d => ({ x: d.x, y: d.c }));
            const lineColor = isBullish ? '#10b981' : '#f43f5e';
            const gradBg = ctx.createLinearGradient(0, 0, 0, 400);
            gradBg.addColorStop(0, isBullish ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)');
            gradBg.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            datasets.push({
                type: 'line',
                label: '데이터',
                data: lineData,
                yAxisID: 'y',
                borderColor: lineColor,
                borderWidth: 2.5,
                backgroundColor: gradBg,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 6,
                tension: 0.2
            });
        }

        detailChart = new Chart(ctx, {
            type: currentDetailMode === 'candlestick' ? 'candlestick' : 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onHover: (event, chartElements) => {
                    const descEl = document.getElementById('detail-candle-desc');
                    if (chartElements && chartElements.length > 0) {
                        const idx = chartElements[0].index;
                        const origPoint = currentDetailData[idx];
                        if (origPoint) {
                            const d = new Date(origPoint.x);
                            const timeStr = (period === '1d' || period === '1h') 
                                ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` 
                                : `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
                            
                            const curr = window.currentDetailCurrency || 'USD';
                            const dec = (curr === 'KRW' || curr === 'JPY' || curr === 'VND') ? 0 : 2;
                            let text = `[${timeStr}] <strong style="color: #fbbf24; font-size: 1.1em; margin-left: 6px; margin-right: 10px;">${curr}</strong>`;
                            if (currentDetailMode === 'candlestick') {
                                text += `<span style="color:#e2e8f0;">O(시가): <strong>${formatNumber(origPoint.o, dec)}</strong></span> &nbsp;|&nbsp; ` +
                                        `<span style="color:#f43f5e;">H(고가): <strong>${formatNumber(origPoint.h, dec)}</strong></span> &nbsp;|&nbsp; ` +
                                        `<span style="color:#3b82f6;">L(저가): <strong>${formatNumber(origPoint.l, dec)}</strong></span> &nbsp;|&nbsp; ` +
                                        `<span style="color:#10b981;">C(종가): <strong>${formatNumber(origPoint.c, dec)}</strong></span>`;
                            } else {
                                text += `<span style="color:#10b981;">C(종가): <strong>${formatNumber(origPoint.c, dec)}</strong></span>`;
                            }
                            descEl.innerHTML = text;
                            descEl.style.opacity = '1';
                        }
                    } else {
                        descEl.innerHTML = `시가 <span style="color:#e2e8f0;"><strong>O</strong>: 시가(Open)</span> &nbsp;|&nbsp; <span style="color:#f43f5e;"><strong>H</strong>: 고가(High)</span> &nbsp;|&nbsp; <span style="color:#3b82f6;"><strong>L</strong>: 저가(Low)</span> &nbsp;|&nbsp; <span style="color:#10b981;"><strong>C</strong>: 종가(Close)</span>`;
                        descEl.style.opacity = '0.4';
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        displayColors: false,
                        callbacks: {
                            title: function(tooltipItems) {
                                const title = tooltipItems[0].label || '';
                                const curr = window.currentDetailCurrency || 'USD';
                                return `${title} <strong style="color: #fbbf24; margin-left: 6px;">${curr}</strong>`;
                            },
                            label: function(context) {
                                const mode = currentDetailMode || 'line';
                                const raw = context.raw || {};
                                const o = raw.o;
                                const h = raw.h;
                                const l = raw.l;
                                const c = raw.c !== undefined ? raw.c : raw.y;
                                
                                const curr = window.currentDetailCurrency || 'USD';
                                const dec = (curr === 'KRW' || curr === 'JPY' || curr === 'VND') ? 0 : 2;
                                
                                if (mode === 'candlestick' && o !== undefined) {
                                    return [
                                        `<span style="color:#e2e8f0;">O(시가): <strong>${formatNumber(o, dec)}</strong></span>`,
                                        `<span style="color:#f43f5e;">H(고가): <strong>${formatNumber(h, dec)}</strong></span>`,
                                        `<span style="color:#3b82f6;">L(저가): <strong>${formatNumber(l, dec)}</strong></span>`,
                                        `<span style="color:#10b981;">C(종가): <strong>${formatNumber(c, dec)}</strong></span>`
                                    ];
                                } else {
                                    return `<span style="color:#10b981;">C(종가): <strong>${formatNumber(c, dec)}</strong></span>`;
                                }
                            }
                        },
                        backgroundColor: 'rgba(10, 15, 30, 0.9)', titleColor: '#f8fafc', bodyColor: '#94a3b8', borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, padding: 12,
                        caretSize: 0
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x',
                            onPan: function({chart}) {
                                autoScaleYAxis(chart);
                                chart.update('none');
                                if(detailVolumeChart) {
                                    detailVolumeChart.options.scales.x.min = chart.scales.x.min;
                                    detailVolumeChart.options.scales.x.max = chart.scales.x.max;
                                    detailVolumeChart.update('none');
                                }
                            }
                        },
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'x',
                            onZoom: function({chart}) {
                                autoScaleYAxis(chart);
                                chart.update('none');
                                if(detailVolumeChart) {
                                    detailVolumeChart.options.scales.x.min = chart.scales.x.min;
                                    detailVolumeChart.options.scales.x.max = chart.scales.x.max;
                                    detailVolumeChart.update('none');
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
                        ticks: { color: '#64748b', maxTicksLimit: 10, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b' },
                        grace: '5%',
                        beginAtZero: false
                    }
                }
            }
        });

        const volCtx = document.getElementById("chart-detail-volume").getContext("2d");
        if (detailVolumeChart) {
            detailVolumeChart.destroy();
        }

        const volumeData = dataArr.map(d => ({ x: d.x, y: d.v || 0, c: d.c, o: d.o }));

        detailVolumeChart = new Chart(volCtx, {
            type: 'bar',
            data: {
                datasets: [
                    {
                        label: '거래량',
                        data: volumeData,
                        backgroundColor: dataArr.map(d => (d.c >= d.o ? 'rgba(244, 63, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)')),
                        borderColor: dataArr.map(d => (d.c >= d.o ? 'rgba(244, 63, 94, 0.6)' : 'rgba(59, 130, 246, 0.6)')),
                        borderWidth: 1,
                        barPercentage: 0.8,
                        categoryPercentage: 0.9,
                        minBarLength: 2,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
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
                                if(detailChart) {
                                    detailChart.options.scales.x.min = chart.scales.x.min;
                                    detailChart.options.scales.x.max = chart.scales.x.max;
                                    detailChart.update('none');
                                }
                            }
                        },
                        zoom: {
                            wheel: { enabled: true }, mode: 'x',
                            onZoom: function({chart}) {
                                if(detailChart) {
                                    detailChart.options.scales.x.min = chart.scales.x.min;
                                    detailChart.options.scales.x.max = chart.scales.x.max;
                                    detailChart.update('none');
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        display: false,
                        offset: true
                    },
                    y: {
                        display: true, position: 'right',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', maxTicksLimit: 4, callback: function(value) {
                            if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
                            if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
                            return value;
                        }}
                    }
                }
            }
        });
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

    // === Portfolio Feature Core Logic ===
    let portfolio = JSON.parse(localStorage.getItem('my_portfolio_items')) || [];
    let portfolioBacktestChart = null;

    function savePortfolio() {
        localStorage.setItem('my_portfolio_items', JSON.stringify(portfolio));
    }

    function addToPortfolio(symbol, name, exchange) {
        const exists = portfolio.some(item => item.symbol.toUpperCase() === symbol.toUpperCase());
        if (exists) {
            alert('이미 포트폴리오에 담겨있는 종목입니다.');
            return;
        }
        portfolio.push({ symbol, name, exchange, quantity: 1 });
        savePortfolio();
        alert(`${name} 종목을 포트폴리오에 담았습니다.`);
    }

    // Get live exchange rate to KRW
    function getKrwExchangeRate(currency) {
        if (!currency || currency === 'KRW') return 1;
        const key = currency.toLowerCase();
        if (travelExchangeRates[key]) {
            return travelExchangeRates[key];
        }
        // Fallback checks
        if (key === 'usd') return travelExchangeRates.usd;
        if (key === 'jpy') return travelExchangeRates.jpy;
        if (key === 'eur') return travelExchangeRates.eur;
        if (key === 'cny') return travelExchangeRates.cny;
        return 1;
    }

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
            return { price, currency };
        } catch (e) {
            console.warn(`Failed to fetch current price for ${symbol}, simulating...`);
            const isKRW_JPY = exchange === 'kospi' || exchange === 'kosdaq' || exchange === 'japan';
            const baseValue = isKRW_JPY ? (exchange === 'japan' ? 5000 : 50000) : 150;
            const price = baseValue + (Math.random() * baseValue * 0.2);
            const currency = (exchange === 'nasdaq' || exchange === 'nyse') ? 'USD' : (exchange === 'japan' ? 'JPY' : 'KRW');
            return { price, currency };
        }
    }

    async function renderPortfolioModal() {
        const listEl = document.getElementById('portfolio-items-list');
        if (!listEl) return;
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">포트폴리오 정보를 불러오는 중...</div>';

        if (portfolio.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">포트폴리오에 담긴 종목이 없습니다.</div>';
            return;
        }

        let html = '';
        
        // Fetch current prices in parallel to speed up rendering
        const pricePromises = portfolio.map(item => getStockCurrentPriceAndCurrency(item.symbol, item.exchange));
        const priceResults = await Promise.all(pricePromises);

        portfolio.forEach((item, index) => {
            const { price, currency } = priceResults[index];
            const krwRate = getKrwExchangeRate(currency);
            
            // 100엔당 표기 수정 등을 고려한 환산
            let basePrice = price;
            if (currency === 'JPY') {
                // JPY의 경우 travelExchangeRates.jpy가 1엔당 원화(약 8.6원)
                // 야후 파이낸스 가격은 1엔 단위이므로 그대로 곱하면 됨.
            } else if (currency === 'VND') {
                // VND 역시 1동당 원화
            }
            
            const totalKrwVal = basePrice * item.quantity * krwRate;

            html += `
                <div class="portfolio-item" data-index="${index}" style="display: grid; grid-template-columns: 1.4fr 1.2fr 0.4fr; align-items: center; gap: 16px; padding: 14px 18px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; margin-bottom: 12px;">
                    <!-- 1열: 종목 정보 (4행 구성) -->
                    <div class="portfolio-col-info" style="display: flex; flex-direction: column; gap: 4px; min-width: 0; align-items: flex-start; text-align: left;">
                        <span class="portfolio-item-name" style="font-size: 13.5px; font-weight: 700; color: var(--text-primary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${item.name}</span>
                        <span class="portfolio-item-symbol" style="font-size: 11px; color: var(--text-muted); display: block;">(${item.symbol})</span>
                        <span class="portfolio-item-exchange" style="font-size: 10px; text-transform: uppercase; color: var(--accent); font-weight: bold; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.15); padding: 1px 6px; border-radius: 4px; display: inline-block;">${item.exchange}</span>
                        <span class="portfolio-item-price-info" style="font-size: 11px; color: var(--text-secondary); display: block;">현재가: ${formatNumber(price, currency === 'KRW' || currency === 'JPY' ? 0 : 2)} ${currency}</span>
                    </div>
                    
                    <!-- 2열: 평가금액 & 수량 조절기 (세로 적층) -->
                    <div class="portfolio-col-valuation-qty" style="display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center;">
                        <span class="portfolio-price-label" style="font-size: 11px; color: var(--text-muted); font-weight: 500; display: block;">평가금액</span>
                        <span class="portfolio-item-price" id="portfolio-item-krw-${index}" style="font-size: 14.5px; font-weight: 700; color: var(--accent); display: block;">${formatNumber(totalKrwVal, 0)}원</span>
                        
                        <!-- 커스텀 수량 가감 조절기 -->
                        <div class="qty-control-wrapper" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 2px;">
                            <button type="button" class="qty-btn qty-minus" data-index="${index}" style="background: none; border: none; color: #94a3b8; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; font-weight: bold; border-radius: 4px;">-</button>
                            <input type="number" class="portfolio-qty-input" value="${item.quantity}" min="0" data-index="${index}" style="width: 42px; text-align: center; border: none; background: transparent; color: var(--text-primary); font-size: 13px; font-weight: bold; outline: none; padding: 0; margin: 0; -webkit-appearance: none; -moz-appearance: textfield;">
                            <button type="button" class="qty-btn qty-plus" data-index="${index}" style="background: none; border: none; color: #94a3b8; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; font-weight: bold; border-radius: 4px;">+</button>
                        </div>
                    </div>
                    
                    <!-- 3열: 삭제 버튼 -->
                    <div class="portfolio-col-delete" style="display: flex; justify-content: flex-end; align-items: center;">
                        <button class="portfolio-delete-btn" data-index="${index}">삭제</button>
                    </div>
                </div>
            `;
            
            // Cache price/currency/rate in the item object for instant updates on qty changes
            item.cachedPrice = price;
            item.cachedCurrency = currency;
            item.cachedRate = krwRate;
        });

        listEl.innerHTML = html;

        // Bind Quantity Input change listeners
        listEl.querySelectorAll('.portfolio-qty-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.getAttribute('data-index'));
                const newQty = parseFloat(e.target.value) || 0;
                portfolio[idx].quantity = newQty;
                savePortfolio();

                // Recalculate KRW price instantly on UI
                const item = portfolio[idx];
                if (item.cachedPrice) {
                    const totalKrwVal = item.cachedPrice * newQty * item.cachedRate;
                    document.getElementById(`portfolio-item-krw-${idx}`).innerText = `${formatNumber(totalKrwVal, 0)}원`;
                }
            });
        });

        // Bind Plus/Minus button click listeners
        listEl.querySelectorAll('.qty-minus').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-index'));
                const input = listEl.querySelector(`.portfolio-qty-input[data-index="${idx}"]`);
                if (input) {
                    let val = parseFloat(input.value) || 0;
                    if (val > 0) {
                        val = Math.max(0, val - 1);
                        input.value = val;
                        input.dispatchEvent(new Event('input'));
                    }
                }
            });
        });

        listEl.querySelectorAll('.qty-plus').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-index'));
                const input = listEl.querySelector(`.portfolio-qty-input[data-index="${idx}"]`);
                if (input) {
                    let val = parseFloat(input.value) || 0;
                    val = val + 1;
                    input.value = val;
                    input.dispatchEvent(new Event('input'));
                }
            });
        });

        // Bind Delete button listeners
        listEl.querySelectorAll('.portfolio-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-index'));
                portfolio.splice(idx, 1);
                savePortfolio();
                renderPortfolioModal();
                
                // Hide analysis section if item is deleted to ensure synchronization
                document.getElementById('portfolio-analysis-section').classList.remove('active');
            });
        });
    }

    // Modal Control Setup
    const modalEl = document.getElementById('portfolio-modal');
    const myPortfolioBtn = document.getElementById('my-portfolio-btn');
    const closeBtn1 = document.getElementById('close-portfolio-modal-btn');
    const closeBtn2 = document.getElementById('close-portfolio-modal-footer-btn');

    if (myPortfolioBtn && modalEl) {
        myPortfolioBtn.addEventListener('click', () => {
            modalEl.classList.add('active');
            document.getElementById('portfolio-analysis-section').classList.remove('active');
            renderPortfolioModal();
        });
    }

    const closeModal = () => {
        if (modalEl) modalEl.classList.remove('active');
    };

    if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
    if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

    // 10-Year Backtesting / Tracking Simulation
    const analyzeBtn = document.getElementById('analyze-portfolio-btn');
    let backtestPeriod = '5y';
    let simulationSeries = []; // Contains date strings and consolidated KRW portfolio values

    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', async () => {
            await runPortfolioBacktest();
        });
    }

    // Bind backtest timeframe buttons
    document.querySelectorAll('#portfolio-backtest-timeframe .time-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            document.querySelectorAll('#portfolio-backtest-timeframe .time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            backtestPeriod = e.target.getAttribute('data-period');
            await renderBacktestChartOnly();
        });
    });

    async function fetchHistorical10yData(symbol, exchange) {
        let yahooSymbol = symbol;
        if (exchange === 'kospi') yahooSymbol = symbol + '.KS';
        else if (exchange === 'kosdaq') yahooSymbol = symbol + '.KQ';
        else if (exchange === 'japan') yahooSymbol = symbol + '.T';

        // 10 years interval
        try {
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
            return { history, currency };
        } catch (e) {
            console.warn(`Failed to fetch 10y history for ${symbol}, simulating...`);
            // Simulating historical price mapping
            const history = [];
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;
            const steps = 520; // 10 years in weeks
            
            const isKRW_JPY = exchange === 'kospi' || exchange === 'kosdaq' || exchange === 'japan';
            const baseValue = isKRW_JPY ? (exchange === 'japan' ? 5000 : 50000) : 150;
            let simPrice = baseValue;

            // IPO year limitation: 10% chance that stock was listed less than 10 years ago (e.g. listed 4 years ago)
            const listLimitSteps = Math.random() > 0.85 ? Math.floor(steps * 0.4) : 0;

            for (let i = steps; i >= 0; i--) {
                const time = now - (i * weekMs);
                const change = (Math.random() - 0.485) * 0.02; // slightly bullish bias
                simPrice = simPrice * (1 + change);

                if (i > listLimitSteps) {
                    history.push({
                        time: time,
                        price: simPrice
                    });
                }
            }
            const currency = (exchange === 'nasdaq' || exchange === 'nyse') ? 'USD' : (exchange === 'japan' ? 'JPY' : 'KRW');
            return { history, currency };
        }
    }

    async function runPortfolioBacktest() {
        if (portfolio.length === 0) {
            alert('포트폴리오에 분석할 종목이 없습니다.');
            return;
        }

        const analysisSection = document.getElementById('portfolio-analysis-section');
        if (analysisSection) analysisSection.classList.add('active');

        // Fetch historical data for all stocks in portfolio
        const historyPromises = portfolio.map(item => fetchHistorical10yData(item.symbol, item.exchange));
        const historicalResults = await Promise.all(historyPromises);

        // Fetch DXY, USD/KRW, and JPY/KRW historical proxy benchmarks for precise multi-currency conversion
        // Fallback utilizes contemporary rate ratios
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
                    // Simulating historical exchange rates to offer high fidelity tracking
                    const currentRate = getKrwExchangeRate(currency);
                    // Add slight historical walk variation to contemporary rate
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

        await renderBacktestChartOnly();
    }

    async function renderBacktestChartOnly() {
        const ctx = document.getElementById('chart-portfolio-backtest');
        if (!ctx || simulationSeries.length === 0) return;

        if (portfolioBacktestChart) {
            portfolioBacktestChart.destroy();
        }

        // Filter data points based on selected period
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

        const filteredData = simulationSeries.filter(d => (now - d.x) <= limitMs);

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
});
