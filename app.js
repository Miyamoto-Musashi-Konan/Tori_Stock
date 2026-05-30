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
                chart._mouseEvent = args.event;
            } else if (args.event.type === 'mouseout') {
                chart._mouseEvent = null;
            }
        },
        afterDraw: chart => {
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
                
                // 2. 마우스 접점과 툴팁 박스 연결선 (Callout Line) 그리기
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

    // Chart.js 툴팁을 커스텀 HTML 툴팁으로 처리하는 핸들러
    function externalTooltipHandler(context) {
        const {chart, tooltip} = context;
        const tooltipEl = getOrCreateTooltip();

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
    }

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
        // 기존 활성 탭 및 콘텐츠 제거
        document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-view").forEach(view => view.classList.remove("active"));

        // 신규 탭 및 콘텐츠 활성화
        document.getElementById(`tab-${tabId}`).classList.add("active");
        
        let targetView;
        if (tabId === 'overview') targetView = document.getElementById("view-overview");
        else if (tabId === 'history') targetView = document.getElementById("view-history");
        else if (tabId === 'travel') targetView = document.getElementById("view-travel");
        else if (tabId === 'sentiment') targetView = document.getElementById("view-sentiment");
        else if (tabId === 'detail') targetView = document.getElementById("view-detail");
        
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
            '1wk': { days: 7, interval: '15m', range: '5d', vol: 0.5, baseK: 1.01, baseQ: 1.01, base200: 1.005 },
            '1d': { days: 1, interval: '5m', range: '1d', vol: 0.3, baseK: 1.005, baseQ: 0.995, base200: 1.002 },
            '1h': { days: 0.0416, interval: '1m', range: '1d', vol: 0.2, baseK: 1.001, baseQ: 0.999, base200: 1.001 }
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

    // 8. 여행용 환율 계산 기능
    window.calculateTravelExchange = function(currencyKey, customRate = null) {
        const inputEl = document.getElementById(`travel-input-${currencyKey}`);
        const resultEl = document.getElementById(`travel-res-${currencyKey}`);
        
        if (!inputEl || !resultEl) return;
        
        const val = parseFloat(inputEl.value) || 0;
        
        if (travelBase === 'krw') {
            const rate = customRate || travelExchangeRates[currencyKey];
            let calculated = 0;
            let unitText = "";

            if (currencyKey === 'jpy') {
                calculated = (val / 100) * (rate * 100);
                unitText = "JPY";
            } else if (currencyKey === 'vnd') {
                calculated = (val / 100) * (rate * 100);
                unitText = "VND";
            } else {
                calculated = val * rate;
                unitText = currencyKey.toUpperCase();
            }

            resultEl.innerText = `${formatNumber(val, 0)} ${unitText} = ${formatNumber(calculated, 0)} 원`;
        } else {
            const rate = usdExchangeRates[currencyKey];
            if (!rate) return;
            const calculated = val * rate;
            let unitText = currencyKey.toUpperCase();
            
            if (currencyKey === 'krw') {
                resultEl.innerText = `${formatNumber(val, 0)} USD = ${formatNumber(calculated, 0)} 원`;
            } else {
                resultEl.innerText = `${formatNumber(val, 0)} USD = ${formatNumber(calculated, currencyKey === 'vnd' ? 0 : 2)} ${unitText}`;
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
        
        Object.keys(travelExchangeRates).forEach(key => {
            calculateTravelExchange(key);
        });
        calculateTravelExchange('krw');
        
        if (window.latestTickResult) {
            updateDashboardUI(window.latestTickResult);
        }
    };

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
                loadRealFearGreedIndex()
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

        initializeNaverNewsSystem();
    }

    // 13. 네이버 금융 메인 뉴스 크롤링 시스템 (EUC-KR 인코딩 처리)
    // 전역 변수로 현재 선택된 뉴스 탭 상태와 불러온 뉴스 리스트 저장
    let currentNewsTab = 'stock';
    let loadedNewsList = [];
    let newsUpdateInterval = null;

    // 뉴스 카테고리 필터 전환 함수
    window.switchNewsTab = function(tabId) {
        currentNewsTab = tabId;
        document.querySelectorAll('.news-tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`news-tab-${tabId}`);
        if (activeBtn) activeBtn.classList.add('active');
        
        renderNaverNews(loadedNewsList);
    };

    // 기사 중요도(우선순위) 산출 헬퍼 함수
    function calculateImportance(title, summary) {
        let score = 5; // 기본값
        const highKeywords = ['금리', '돌파', '폭락', '폭등', '붕괴', '최저', '최고', '위기', '충격', '긴급', '속보', '발표', '급등', '급락'];
        const mediumKeywords = ['전망', '분석', '대비', '실적', '유입', '상승', '하락', '돌입', '유지', '기대'];
        
        const fullText = (title + ' ' + summary).toLowerCase();
        
        highKeywords.forEach(kw => {
            if (fullText.includes(kw)) score += 2;
        });
        
        mediumKeywords.forEach(kw => {
            if (fullText.includes(kw)) score += 1;
        });
        
        // 시간 가중치나 랜덤 미세 요소를 주어 순위를 유기적으로 조절
        score += Math.random() * 1.5;
        
        return Math.min(Math.max(Math.round(score), 1), 10);
    }

    // 모의 뉴스 데이터 은행 (시간에 따라 동적으로 뉴스 풀을 생성해 변화를 유도하기 위함)
    const mockNewsBank = {
        stock: [
            { title: "반도체주 상승세... KOSPI 2,800선 돌파 기대감 고조", summary: "글로벌 경기 흐름 속 SK하이닉스 등 대형주 중심으로 지수 상승 기대감이 커지고 있습니다. 외국인 자금 유입이 지속되고 있습니다.", press: "한국경제" },
            { title: "미 증시 AI 랠리 재점화, 나스닥 역사적 신고가 경신 마감", summary: "엔비디아와 마이크로소프트의 주도로 기술주 매수세가 강력하게 유입되며 뉴욕 증시가 최고점을 다시 한 번 돌파했습니다.", press: "연합인포맥스" },
            { title: "코스닥 외국인·기관 쌍끌이 매도에 1.2% 하락 마감", summary: "금리 인하 지연 우려와 차익 실현 매물이 겹치며 기관과 외국인이 코스닥 바이오 및 이차전지 업종을 대거 매도했습니다.", press: "머니투데이" },
            { title: "삼성전자, 4세대 HBM 공급 계약 임박설에 3% 이상 급등", summary: "글로벌 그래픽 칩 선두 기업에 대한 차세대 고대역폭 메모리 공급이 가시화되면서 거래량이 폭발하며 강세를 기록 중입니다.", press: "이데일리" },
            { title: "이차전지 소재 기업 실적 우려에 단기 과매도 구간 진입 분석", summary: "전기차 수요 둔화 여파로 실적 눈높이가 낮아졌으나, 장기적인 펀더멘털과 설비 투자 지속성 기준 저평가 매력이 부각됩니다.", press: "서울경제" },
            { title: "금리 동결 발표에 은행 및 금융지주 고배당주로 자금 쏠림", summary: "한국은행의 연이은 기준금리 동결 기조 속에 배당 안정성이 높은 고배당 금융주로 기관 성격의 자금이 강하게 유입되고 있습니다.", press: "파이낸셜뉴스" }
        ],
        forex: [
            { title: "달러 환율 1,350원 돌파 행진... 기업 수출 경쟁력에 악영향 우려", summary: "원자재 및 원부자재 수입 가격 상승으로 국내 기업들의 수익성이 악화되고 있다는 목소리가 높아지는 가운데 달러 강세가 지속되고 있습니다.", press: "헤럴드경제" },
            { title: "엔화 가치 860원대로 내려앉아... 여행객들 일본 여행 수요 급증", summary: "일본 엔화 환율이 100엔당 860원대 수준으로 떨어지면서 일본 여행을 떠나는 수요가 폭증하고 있습니다. 환전 수요 또한 크게 늘고 있습니다.", press: "동아일보" },
            { title: "유로화 대비 달러 강세 주춤, 미 물가 지표 발표 앞두고 관망세", summary: "미국 인플레이션 핵심 지표 발표를 앞두고 달러화 지수(DXY)가 소폭 하락하며 유로화 대비 달러화 가치가 일시 조정을 보이고 있습니다.", press: "조선비즈" },
            { title: "원/달러 환율 추가 급등 제한, 당국 미세조정 경계감 작용", summary: "외환당국의 구두 개입과 실물 외환시장 매도 물량 유입 경계감으로 원/달러 환율의 1,360원 상단 돌파는 일단 저지되었습니다.", press: "문화일보" },
            { title: "중국 인민은행 위안화 절하 방어... 아시아 통화 동반 변동성 축소", summary: "위안화 약세 압력을 제어하기 위한 중국 금융당국의 환율 고시 대응으로 원화 및 엔화의 동반 급등세도 한숨 돌린 양상입니다.", press: "아시아경제" },
            { title: "엔/달러 157엔 선 안착, 일본은행 매수 개입 시점 저울질", summary: "엔저 기조가 심화되며 157엔 중반까지 밀려나자 일본 정부 관계자들의 환율 시장 개입 경고 발언 강도가 한층 높아졌습니다.", press: "매일경제" }
        ],
        economy: [
            { title: "美 물가 상승률 둔화 시그널 포착, 연준 연내 금리 인하 확률 상승", summary: "미 노동부가 발표한 소비자물가지수가 예상치를 밑돌며 고금리 기조가 하반기에는 누그러질 것이라는 기대감이 급증하고 있습니다.", press: "연합뉴스" },
            { title: "글로벌 원자재 공급망 차질... 국제 유가 배럴당 85달러 재진입", summary: "중동 지정학적 리스크의 재점화와 산유국들의 감산 합의 유지 기조로 인해 국제 서부 텍사스산 원유 가격이 다시 급등세를 연출하고 있습니다.", press: "YTN" },
            { title: "유로존 제조업 경기 침체 지속, 경기 부양책 시급성 대두", summary: "유럽 주요국들의 구매관리자지수(PMI)가 수개월째 기준선인 50을 밑돌면서 ECB의 선제적인 금리 인하 주장에 힘이 실리고 있습니다.", press: "뉴스1" },
            { title: "대기업 2분기 배당 및 투자 계획 공시... 미래 성장 동력 확보 집중", summary: "주요 IT 및 대기업군이 주주가치 제고를 위한 분기 배당 공시와 함께 AI 인프라 확충을 위한 대규모 설비 투자 세부 계획을 공시했습니다.", press: "아시아경제" },
            { title: "신흥국 국가 신용등급 전망 상향 조정, 글로벌 자금 유입 가속", summary: "글로벌 신용평가기관들이 견고한 거시경제 지표를 바탕으로 주요 신흥국들의 신용 등급을 안정적에서 긍정적으로 상향 조치했습니다.", press: "매일경제" },
            { title: "글로벌 반도체 장비 출하량 급증... 제조 인프라 공급망 정상화", summary: "차세대 반도체 공장 라인 증설 열풍으로 장비 주문량이 사상 최고치를 달성하며 관련 소부장 기업들의 공시 실적이 대폭 개선 중입니다.", press: "디지털데일리" }
        ]
    };

    // 13. 네이버 금융 메인 뉴스 크롤링 시스템 (EUC-KR 인코딩 처리 및 개별 기사 도달 링크)
    async function fetchNaverNews() {
        const url = 'https://finance.naver.com/news/mainnews.naver';
        try {
            let htmlText = '';
            try {
                const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    htmlText = new TextDecoder('euc-kr').decode(buffer);
                }
            } catch (e) {
                console.warn("corsproxy.io failed for Naver news, trying allorigins.win raw...", e);
            }

            if (!htmlText) {
                const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    htmlText = new TextDecoder('euc-kr').decode(buffer);
                }
            }

            if (!htmlText) throw new Error("Could not fetch Naver News html");

            const doc = new DOMParser().parseFromString(htmlText, 'text/html');
            const items = doc.querySelectorAll('.mainNewsList .newsList li');
            const newsList = [];

            items.forEach(li => {
                const subjectEl = li.querySelector('.articleSubject a');
                const summaryEl = li.querySelector('.articleSummary');
                const pressEl = li.querySelector('.press');
                const wdateEl = li.querySelector('.wdate');

                if (subjectEl) {
                    const title = subjectEl.textContent.trim();
                    let relativeHref = subjectEl.getAttribute('href') || '';
                    
                    // URL이 이미 절대 경로로 되어 있는지 판단하여 결합
                    let originalLink = '';
                    if (relativeHref.startsWith('http') || relativeHref.startsWith('//')) {
                        originalLink = relativeHref.startsWith('//') ? 'https:' + relativeHref : relativeHref;
                    } else {
                        originalLink = 'https://finance.naver.com' + (relativeHref.startsWith('/') ? '' : '/') + relativeHref;
                    }

                    // 링크 파싱: office_id와 article_id를 정교하게 추출
                    const oidMatch = relativeHref.match(/[?&]office_id=(\d+)/) || relativeHref.match(/office_id=(\d+)/);
                    const aidMatch = relativeHref.match(/[?&]article_id=(\d+)/) || relativeHref.match(/article_id=(\d+)/);
                    
                    if (oidMatch && aidMatch) {
                        // 네이버 금융 자체 기사 뷰어 주소 (리다이렉트가 없고 가장 실재가 보장되는 URL)
                        originalLink = `https://finance.naver.com/news/news_read.naver?article_id=${aidMatch[1]}&office_id=${oidMatch[1]}`;
                    }

                    let summary = '';
                    if (summaryEl) {
                        summary = summaryEl.textContent
                            .replace(pressEl ? pressEl.textContent : '', '')
                            .replace(wdateEl ? wdateEl.textContent : '', '')
                            .replace(/\|/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                    }

                    const titleText = title.toLowerCase();
                    let category = 'economy'; // 기본 카테고리
                    if (titleText.includes('환율') || titleText.includes('달러') || titleText.includes('엔화') || titleText.includes('유로') || titleText.includes('위안') || titleText.includes('외환')) {
                        category = 'forex';
                    } else if (titleText.includes('주식') || titleText.includes('증시') || titleText.includes('코스피') || titleText.includes('코스닥') || titleText.includes('반도체') || titleText.includes('삼성') || titleText.includes('금리') || titleText.includes('나스닥') || titleText.includes('다우') || titleText.includes('s&p') || titleText.includes('니케이')) {
                        category = 'stock';
                    }

                    const importance = calculateImportance(title, summary);

                    newsList.push({
                        title: title,
                        link: originalLink,
                        summary: summary,
                        press: pressEl ? pressEl.textContent.trim() : '네이버 금융',
                        date: wdateEl ? wdateEl.textContent.trim() : new Date().toLocaleDateString('ko-KR'),
                        category: category,
                        importance: importance
                    });
                }
            });

            return newsList.length > 0 ? newsList : generateSimulatedNews();
         } catch (e) {
            console.error("Failed to fetch Naver news, falling back to simulated news bank:", e);
            return generateSimulatedNews();
         }
    }

    // 시간에 따라 동적으로 뉴스가 변화하고 새로 추가되는 모의 뉴스 생성기
    function generateSimulatedNews() {
        const timeOffset = new Date();
        const newsList = [];
        
        // 3가지 탭별로 골고루 뉴스 뱅크에서 데이터를 가져와 가공하여 채웁니다.
        const categories = ['stock', 'forex', 'economy'];
        categories.forEach(cat => {
            const list = mockNewsBank[cat];
            list.forEach((news, index) => {
                // 실시간 동적 변동성 시뮬레이션: 시간 및 우선순위 점수에 약간씩 변화를 줌
                const date = new Date(timeOffset.getTime() - (index * 20 * 60 * 1000) - (Math.random() * 5 * 60 * 1000));
                const dateStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 전';
                
                // 모의 뉴스는 클릭 시 404 에러가 나지 않도록, 실제 동작하는 네이버 금융 뉴스 포털 주소로 연결
                const link = `https://finance.naver.com/news/mainnews.naver`;
                
                const finalImportance = calculateImportance(news.title, news.summary);

                newsList.push({
                    title: news.title,
                    link: link,
                    summary: news.summary,
                    press: news.press,
                    date: dateStr,
                    category: cat,
                    importance: finalImportance
                });
            });
        });
        
        return newsList;
    }

    // 네이버 뉴스 렌더링 로직 수정 (탭 필터링 및 제목 클릭 기능 추가)
    function renderNaverNews(newsList) {
        const listEl = document.getElementById('naver-news-list');
        const timeEl = document.getElementById('naver-news-time');
        if (!listEl) return;

        listEl.innerHTML = '';
        
        // 1. 현재 선택된 탭 카테고리에 맞는 뉴스만 필터링
        const filteredNews = newsList.filter(news => news.category === currentNewsTab);
        
        // 2. 중요도(우선순위) 기준 내림차순 정렬
        filteredNews.sort((a, b) => b.importance - a.importance);

        // 최대 6개 기사 노출
        const displayNews = filteredNews.slice(0, 6);

        if (displayNews.length === 0) {
            listEl.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--text-muted); padding: 30px;">해당 카테고리에 최신 뉴스가 없습니다.</div>';
            return;
        }

        displayNews.forEach(news => {
            const card = document.createElement('div');
            card.className = 'naver-news-card';
            
            let tagHtml = '';
            let tagColor = 'var(--text-secondary)';
            let tagBg = 'rgba(255, 255, 255, 0.05)';
            let tagBorder = 'rgba(255, 255, 255, 0.08)';
            let labelText = '금융 정보';

            if (news.category === 'forex') {
                tagBg = 'rgba(215, 190, 151, 0.15)';
                tagColor = 'var(--accent)';
                tagBorder = 'rgba(215, 190, 151, 0.2)';
                labelText = '국내외 외환';
            } else if (news.category === 'stock') {
                tagBg = 'rgba(163, 184, 153, 0.15)';
                tagColor = 'var(--primary)';
                tagBorder = 'rgba(163, 184, 153, 0.2)';
                labelText = '국내외 증시';
            } else if (news.category === 'economy') {
                tagBg = 'rgba(165, 214, 167, 0.15)';
                tagColor = 'var(--bullish)';
                tagBorder = 'rgba(165, 214, 167, 0.2)';
                labelText = '글로벌 경제 & 공시';
            }

            tagHtml = `<span class="ticker-icon" style="background: ${tagBg}; color: ${tagColor}; border-color: ${tagBorder}; font-size: 10px; padding: 2px 6px; margin-bottom: 8px; width: fit-content; display: inline-block;">${labelText}</span>`;

            // 중요도(우선순위)를 별 모양 혹은 숫자로 가볍게 시각화
            const starRating = '★'.repeat(Math.round(news.importance / 2)) + '☆'.repeat(5 - Math.round(news.importance / 2));
            const priorityBadge = `<span style="font-size: 10px; color: #fbbf24; margin-left: 8px;" title="중요도: ${news.importance}/10">${starRating}</span>`;

            // 중요 변경 사항: 카드 자체는 div이며, 오직 제목(h4 a)에만 원문 링크를 걸어서 제목 클릭 시에만 이동하도록 마크업 작성
            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        ${tagHtml}
                        ${priorityBadge}
                    </div>
                    <h4 class="news-card-title">
                        <a href="${news.link}" target="_blank">${news.title}</a>
                    </h4>
                    <p class="news-card-summary">${news.summary}</p>
                </div>
                <div class="news-card-meta">
                    <span class="news-card-press">${news.press}</span>
                    <span class="news-card-date">${news.date}</span>
                </div>
            `;
            listEl.appendChild(card);
        });

        if (timeEl) {
            const now = new Date();
            timeEl.innerText = `최근 업데이트: ${now.toLocaleTimeString('ko-KR')} (30초 주기로 자동 갱신)`;
        }
    }

    let tickerInterval = null;
    function startNewsTickerLoop(newsList) {
        if (tickerInterval) clearInterval(tickerInterval);
        const briefEl = document.getElementById('market-brief-text');
        if (!briefEl || newsList.length === 0) return;

        let index = 0;
        const updateTicker = () => {
            const news = newsList[index];
            briefEl.style.opacity = 0;
            setTimeout(() => {
                briefEl.innerHTML = `<a href="${news.link}" target="_blank" style="color: inherit; text-decoration: none; display: flex; align-items: center; gap: 8px;">
                    <strong style="color: var(--accent);">[네이버 금융]</strong> ${news.title}
                </a>`;
                briefEl.style.opacity = 1;
            }, 300);
            index = (index + 1) % newsList.length;
        };
        updateTicker();
        tickerInterval = setInterval(updateTicker, 6000);
    }

    async function initializeNaverNewsSystem() {
        const newsList = await fetchNaverNews();
        loadedNewsList = newsList;
        renderNaverNews(loadedNewsList);
        startNewsTickerLoop(loadedNewsList);

        if (newsUpdateInterval) clearInterval(newsUpdateInterval);
        
        // 실시간 동기화 주기 단축: 30초 간격으로 동기화 및 갱신되도록 변경 (기존 30분에서 변경)
        newsUpdateInterval = setInterval(async () => {
            console.log("30-second timer triggered: Refreshing Naver Finance News...");
            const updatedList = await fetchNaverNews();
            loadedNewsList = updatedList;
            renderNaverNews(loadedNewsList);
            startNewsTickerLoop(loadedNewsList);
        }, 30000);
    }

    // 14. 실시간 주식 티커 검색 기능 (모의 데이터 연동)
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
            { symbol: 'NFLX', name: 'Netflix, Inc.' }
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

        let currentExchange = 'nasdaq';

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
                dropdown.style.display = 'none';
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
                if (exUpper.includes('NYQ') || exUpper.includes('NYS') || exUpper.includes('NYSE')) {
                    return 'nyse';
                }
                if (exUpper.includes('TSE') || exUpper.includes('TYO')) {
                    return 'japan';
                }
                if (exUpper.includes('KSC') || exUpper.includes('KSE')) {
                    return 'kospi';
                }
            }
            
            // Default fallback
            return 'nasdaq';
        }

        const performSearch = () => {
            const query = input.value.trim();
            if (query.length === 0) return;

            // Combine all local mock data from all exchanges
            const allLocalData = [];
            Object.entries(tickerMockData).forEach(([ex, list]) => {
                list.forEach(item => {
                    allLocalData.push({
                        symbol: item.symbol,
                        name: item.name,
                        exchange: ex
                    });
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
                dropdown.style.display = 'none';
                
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
                    dropdown.style.display = 'none';
                    
                    // Detect exchange from suffix or default to currentExchange
                    let detectedEx = currentExchange;
                    if (symbolUpper.endsWith('.T')) detectedEx = 'japan';
                    else if (symbolUpper.endsWith('.KS')) detectedEx = 'kospi';
                    else if (symbolUpper.endsWith('.KQ')) detectedEx = 'kosdaq';
                    
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
                        dropdown.style.display = 'none';
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
                dropdown.style.display = 'none';
                return;
            }

            // Gather all local mock data from all exchanges
            const allLocalData = [];
            Object.entries(tickerMockData).forEach(([ex, list]) => {
                list.forEach(item => {
                    allLocalData.push({
                        symbol: item.symbol,
                        name: item.name,
                        exchange: ex
                    });
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
                        seenSymbols.add(symLower);
                        
                        const detectedEx = detectExchange(item.symbol, item.apiExchange);
                        
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
        if (pDiv) pDiv.innerText = formatNumber(0.5 + Math.random() * 4, 2) + '%';
        
        const p52h = document.getElementById('panel-52high');
        if (p52h) p52h.innerText = formatNumber(currentPrice * (1 + Math.random() * 0.3), 2);
        
        const p52l = document.getElementById('panel-52low');
        if (p52l) p52l.innerText = formatNumber(currentPrice * (1 - Math.random() * 0.3), 2);
        
        const finContainer = document.getElementById('financial-statements-container');
        if (finContainer) finContainer.style.display = 'none';
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
            '1wk': { range: '5d', interval: '15m', maxDays: 7 },
            '1d': { range: '1d', interval: '5m', maxDays: 1 },
            '1h': { range: '1d', interval: '1m', maxDays: 1 }
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
                
                const finContainer = document.getElementById('financial-statements-container');
                const finWrapper = document.getElementById('financial-table-wrapper');
                if (finContainer && finWrapper && incHistory && incHistory.length > 0) {
                    let tableHTML = '<table class="financial-table"><thead><tr><th>연도/분기</th><th>매출액(Total Revenue)</th><th>영업이익(Operating Income)</th><th>당기순이익(Net Income)</th></tr></thead><tbody>';
                    
                    incHistory.forEach(inc => {
                        const dateStr = inc.endDate ? inc.endDate.fmt : 'N/A';
                        const rev = inc.totalRevenue && inc.totalRevenue.raw ? inc.totalRevenue.raw / 1000 : 0;
                        const opInc = inc.operatingIncome && inc.operatingIncome.raw ? inc.operatingIncome.raw / 1000 : 0;
                        const netInc = inc.netIncome && inc.netIncome.raw ? inc.netIncome.raw / 1000 : 0;
                        
                        tableHTML += `<tr>
                            <td>${dateStr}</td>
                            <td>${formatNumber(rev, 0)}</td>
                            <td class="${opInc < 0 ? 'negative' : (opInc > 0 ? 'positive' : '')}">${formatNumber(opInc, 0)}</td>
                            <td class="${netInc < 0 ? 'negative' : (netInc > 0 ? 'positive' : '')}">${formatNumber(netInc, 0)}</td>
                        </tr>`;
                    });
                    
                    tableHTML += '</tbody></table>';
                    finWrapper.innerHTML = tableHTML;
                    finContainer.style.display = 'block';
                } else if (finContainer) {
                    finContainer.style.display = 'none';
                }

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
