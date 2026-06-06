/**
 * 주식 및 환율 투자 정보 대시보드 - 모의 데이터 모듈 (mock-data.js)
 * 2000년부터 2026년까지의 역사적 추세 데이터 및 2초 주기 실시간 데이터 시뮬레이터 제공
 */

const MockDataModule = (() => {
    let historicalDataCache = null;

    // generateHistoricalData returns the preloaded real-world historical data extended to the current date
    function generateHistoricalData() {
        if (!window.REAL_HISTORICAL_DATA) {
            // Fallback to minimal mock data if real data is not loaded
            return [
                { year: 2000.0, label: "2000-01", kospi: 828.4, nasdaq: 3940.4, sp500: 1394.5, reer: 99.0, usdKrw: 1120.0, jpyKrw: 1044.8, eurKrw: 1131.2, cnyKrw: 135.4, jpyValueVsUsd: 98.1, usdValueIndex: 96.9 }
            ];
        }

        if (historicalDataCache) {
            return historicalDataCache;
        }

        // Deep copy the original data array to avoid mutating global data
        const data = JSON.parse(JSON.stringify(window.REAL_HISTORICAL_DATA));
        if (data.length === 0) return data;

        const lastItem = data[data.length - 1];
        const parts = lastItem.label.split('-');
        if (parts.length === 2) {
            const lastYear = parseInt(parts[0]);
            const lastMonth = parseInt(parts[1]);

            // 현재 날짜 구하기 (2026년 6월 기점으로 안전하게 동작)
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1; // 1-indexed

            let tempYear = lastYear;
            let tempMonth = lastMonth;
            let prevItem = lastItem;

            while (tempYear < currentYear || (tempYear === currentYear && tempMonth < currentMonth)) {
                tempMonth++;
                if (tempMonth > 12) {
                    tempMonth = 1;
                    tempYear++;
                }
                const label = `${tempYear}-${String(tempMonth).padStart(2, '0')}`;
                const yearFraction = parseFloat((tempYear + (tempMonth - 1) / 12).toFixed(2));

                // 자연스러운 흐름을 위해 직전 데이터 기점 소폭의 변동폭(랜덤워크) 부여
                const kospi = parseFloat((prevItem.kospi * (1 + (Math.random() - 0.48) * 0.02)).toFixed(1));
                const nasdaq = parseFloat((prevItem.nasdaq * (1 + (Math.random() - 0.47) * 0.03)).toFixed(1));
                const sp500 = parseFloat((prevItem.sp500 * (1 + (Math.random() - 0.47) * 0.02)).toFixed(1));
                const reer = parseFloat((prevItem.reer * (1 + (Math.random() - 0.5) * 0.01)).toFixed(1));
                
                // 환율 데이터도 직전 데이터 기반 변동
                const usdKrw = parseFloat((prevItem.usdKrw * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));
                const jpyKrw = parseFloat((prevItem.jpyKrw * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));
                const eurKrw = parseFloat((prevItem.eurKrw * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));
                const cnyKrw = parseFloat((prevItem.cnyKrw * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));

                const jpyValueVsUsd = parseFloat((prevItem.jpyValueVsUsd * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));
                const usdValueIndex = parseFloat((prevItem.usdValueIndex * (1 + (Math.random() - 0.5) * 0.015)).toFixed(1));

                const newItem = {
                    year: yearFraction,
                    label: label,
                    kospi: kospi,
                    nasdaq: nasdaq,
                    sp500: sp500,
                    reer: reer,
                    usdKrw: usdKrw,
                    jpyKrw: jpyKrw,
                    eurKrw: eurKrw,
                    cnyKrw: cnyKrw,
                    jpyValueVsUsd: jpyValueVsUsd,
                    usdValueIndex: usdValueIndex,
                    dxy: prevItem.dxy ? parseFloat((prevItem.dxy * (1 + (Math.random() - 0.5) * 0.008)).toFixed(1)) : 104.5,
                    usdjpy: prevItem.usdjpy ? parseFloat((prevItem.usdjpy * (1 + (Math.random() - 0.5) * 0.01)).toFixed(1)) : 155.0,
                    eurusd: prevItem.eurusd ? parseFloat((prevItem.eurusd * (1 + (Math.random() - 0.5) * 0.008)).toFixed(3)) : 1.08,
                    usdcny: prevItem.usdcny ? parseFloat((prevItem.usdcny * (1 + (Math.random() - 0.5) * 0.005)).toFixed(3)) : 7.24
                };
                data.push(newItem);
                prevItem = newItem;
            }
        }

        historicalDataCache = data;
        return data;
    }

    // 실시간 지수 상태
    const liveIndices = {
        kospi: { current: 2785.45, prevClose: 2755.20, history: [] },
        kosdaq: { current: 872.10, prevClose: 865.50, history: [] },
        nasdaq: { current: 18230.80, prevClose: 18120.00, history: [] },
        sp500: { current: 5360.25, prevClose: 5330.10, history: [] }
    };

    // 실시간 환율 상태 (원화 대비)
    const liveCurrencies = {
        usd: { code: "USD", name: "미국 달러", base: 1352.40, current: 1352.40, prevClose: 1348.50, type: "major" },
        jpy: { code: "JPY", name: "일본 엔 (100엔)", base: 861.20, current: 861.20, prevClose: 864.80, type: "major" },
        eur: { code: "EUR", name: "유로화", base: 1462.60, current: 1462.60, prevClose: 1465.10, type: "major" },
        cny: { code: "CNY", name: "중국 위안", base: 186.50, current: 186.50, prevClose: 186.10, type: "major" },
        
        // 인기 여행지 환율
        vnd: { code: "VND", name: "베트남 동 (100동)", base: 5.31, current: 5.31, prevClose: 5.30, type: "travel" },
        thb: { code: "THB", name: "태국 바트", base: 36.85, current: 36.85, prevClose: 36.72, type: "travel" },
        twd: { code: "TWD", name: "대만 달러", base: 41.92, current: 41.92, prevClose: 41.85, type: "travel" },
        php: { code: "PHP", name: "필리핀 페소", base: 23.18, current: 23.18, prevClose: 23.25, type: "travel" },
        sgd: { code: "SGD", name: "싱가포르 달러", base: 1002.80, current: 1002.80, prevClose: 999.50, type: "travel" },
        hkd: { code: "HKD", name: "홍콩 달러", base: 173.20, current: 173.20, prevClose: 172.90, type: "travel" },
        myr: { code: "MYR", name: "말레이시아 링깃", base: 288.97, current: 288.97, prevClose: 282.47, type: "travel" },
        jpy_travel: { code: "JPY", name: "일본 엔화 (도쿄/오사카)", base: 861.20, current: 861.20, prevClose: 864.80, type: "travel" },
        eur_travel: { code: "EUR", name: "유럽 유로 (프랑스/이탈리아)", base: 1462.60, current: 1462.60, prevClose: 1465.10, type: "travel" }
    };

    // 실시간 달러대비 통화가치 변동률
    const usdBasisRates = {
        eur: { name: "유로/달러 (EUR/USD)", base: 1.0815, current: 1.0815, prevClose: 1.0864, changeRate: -0.45 },
        jpy: { name: "달러/엔 (USD/JPY)", base: 157.04, current: 157.04, prevClose: 155.80, changeRate: 0.80 },
        gbp: { name: "파운드/달러 (GBP/USD)", base: 1.2678, current: 1.2678, prevClose: 1.2710, changeRate: -0.25 },
        cny: { name: "달러/위안 (USD/CNY)", base: 7.2480, current: 7.2480, prevClose: 7.2420, changeRate: 0.08 },
        krw: { name: "달러/원 (USD/KRW)", base: 1352.40, current: 1352.40, prevClose: 1348.50, changeRate: 0.29 }
    };

    // 초기 실시간 차트용 30개 이력 생성 (자연스러운 과거 흐름 시뮬레이션)
    function initializeLiveHistory() {
        Object.keys(liveIndices).forEach(key => {
            const indexObj = liveIndices[key];
            let val = indexObj.current - 15;
            for (let i = 0; i < 30; i++) {
                val += (Math.random() - 0.48) * (val * 0.001); // 약간 우상향 흐름
                indexObj.history.push(parseFloat(val.toFixed(2)));
            }
            indexObj.current = parseFloat(val.toFixed(2));
        });
    }

    // 2초 주기 갱신용 랜덤 워크 함수
    function tickLiveMarket() {
        // 1. 지수 갱신
        const indexUpdates = {};
        Object.keys(liveIndices).forEach(key => {
            const indexObj = liveIndices[key];
            const volatility = key === 'kosdaq' || key === 'nasdaq' ? 0.0006 : 0.0003;
            const changePercent = (Math.random() - 0.495) * volatility; // 약간의 매수 우위 바이어스
            const delta = indexObj.current * changePercent;
            indexObj.current = parseFloat((indexObj.current + delta).toFixed(2));
            
            // 히스토리 30개 유지
            indexObj.history.push(indexObj.current);
            if (indexObj.history.length > 30) {
                indexObj.history.shift();
            }

            const netChange = indexObj.current - indexObj.prevClose;
            const pctChange = (netChange / indexObj.prevClose) * 100;
            
            indexUpdates[key] = {
                current: indexObj.current,
                netChange: parseFloat(netChange.toFixed(2)),
                pctChange: parseFloat(pctChange.toFixed(2)),
                history: [...indexObj.history]
            };
        });

        // 2. 환율 갱신
        const currencyUpdates = {};
        Object.keys(liveCurrencies).forEach(key => {
            const currObj = liveCurrencies[key];
            const decimals = currObj.code === "VND" ? 2 : 2;
            
            // Synchronize travel entries directly to avoid separate random walk drift
            if (key === 'jpy_travel' && liveCurrencies.jpy) {
                currObj.current = liveCurrencies.jpy.current;
                currObj.prevClose = liveCurrencies.jpy.prevClose;
                currObj.base = liveCurrencies.jpy.base;
            } else if (key === 'eur_travel' && liveCurrencies.eur) {
                currObj.current = liveCurrencies.eur.current;
                currObj.prevClose = liveCurrencies.eur.prevClose;
                currObj.base = liveCurrencies.eur.base;
            } else {
                // Mean-reverting random walk to keep rates anchored to actual fetched API values
                const baseRate = currObj.base || currObj.current;
                const driftSpeed = 0.05;
                const drift = (baseRate - currObj.current) * driftSpeed;
                const volatility = key === 'usd' || key === 'jpy' || key === 'eur' ? 0.0001 : 0.00015;
                const randomShock = (Math.random() - 0.5) * volatility * currObj.current;
                const delta = drift + randomShock;
                
                currObj.current = parseFloat((currObj.current + delta).toFixed(decimals));
            }

            const netChange = currObj.current - currObj.prevClose;
            const pctChange = (netChange / currObj.prevClose) * 100;

            currencyUpdates[key] = {
                current: currObj.current,
                netChange: parseFloat(netChange.toFixed(decimals)),
                pctChange: parseFloat(pctChange.toFixed(2))
            };
        });

        // 3. 달러 기준 통화 가치 변동률 갱신
        const usdBasisUpdates = {};
        Object.keys(usdBasisRates).forEach(key => {
            const rateObj = usdBasisRates[key];
            const volatility = 0.0002;
            const changePercent = (Math.random() - 0.5) * volatility;
            const delta = rateObj.current * changePercent;
            
            rateObj.current = parseFloat((rateObj.current + delta).toFixed(4));
            
            // 가치 변동률 계산 (2000년 대비는 고정이나, 전일대비 기준 갱신)
            const netChange = rateObj.current - rateObj.prevClose;
            const pctChange = (netChange / rateObj.prevClose) * 100;
            rateObj.changeRate = parseFloat(pctChange.toFixed(2));

            usdBasisUpdates[key] = {
                current: rateObj.current,
                changeRate: rateObj.changeRate
            };
        });

        // 4. 역사적 추세 마지막 데이터 포인트를 라이브 틱 가격으로 동시 업데이트
        if (historicalDataCache && historicalDataCache.length > 0) {
            const lastItem = historicalDataCache[historicalDataCache.length - 1];
            if (liveCurrencies.usd) lastItem.usdKrw = liveCurrencies.usd.current;
            if (liveCurrencies.jpy) lastItem.jpyKrw = liveCurrencies.jpy.current;
            if (liveCurrencies.eur) lastItem.eurKrw = liveCurrencies.eur.current;
            if (liveCurrencies.cny) lastItem.cnyKrw = liveCurrencies.cny.current;

            if (liveIndices.kospi) lastItem.kospi = liveIndices.kospi.current;
            if (liveIndices.sp500) lastItem.sp500 = liveIndices.sp500.current;
            if (liveIndices.nasdaq) lastItem.nasdaq = liveIndices.nasdaq.current;

            if (usdBasisRates.jpy) {
                lastItem.usdjpy = usdBasisRates.jpy.current;
                lastItem.jpyValueVsUsd = parseFloat((100 * (105.16 / usdBasisRates.jpy.current)).toFixed(1));
            }
            if (usdBasisRates.eur) {
                lastItem.eurusd = usdBasisRates.eur.current;
            }
            if (usdBasisRates.cny) {
                lastItem.usdcny = usdBasisRates.cny.current;
            }
            if (usdBasisRates.krw) {
                const dxyDelta = (Math.random() - 0.5) * 0.05;
                const dxyVal = parseFloat(((lastItem.dxy || 104.5) + dxyDelta).toFixed(2));
                lastItem.dxy = dxyVal;
                lastItem.usdValueIndex = parseFloat((100 * (101.87 / dxyVal)).toFixed(1));
            }
        }

        return {
            indices: indexUpdates,
            currencies: currencyUpdates,
            usdBasis: usdBasisUpdates,
            timestamp: new Date().toLocaleTimeString('ko-KR')
        };
    }

    // 초기화 및 내보내기
    initializeLiveHistory();

    return {
        getHistoricalData: generateHistoricalData,
        getLiveIndices: () => {
            const res = {};
            Object.keys(liveIndices).forEach(key => {
                const o = liveIndices[key];
                const net = o.current - o.prevClose;
                res[key] = {
                    current: o.current,
                    netChange: parseFloat(net.toFixed(2)),
                    pctChange: parseFloat(((net / o.prevClose) * 100).toFixed(2)),
                    history: [...o.history]
                };
            });
            return res;
        },
        getLiveCurrencies: () => {
            const res = {};
            Object.keys(liveCurrencies).forEach(key => {
                const o = liveCurrencies[key];
                const net = o.current - o.prevClose;
                res[key] = {
                    code: o.code,
                    name: o.name,
                    current: o.current,
                    netChange: parseFloat(net.toFixed(2)),
                    pctChange: parseFloat(((net / o.prevClose) * 100).toFixed(2)),
                    type: o.type
                };
            });
            return res;
        },
        getUsdBasisRates: () => {
            return { ...usdBasisRates };
        },
        updateIndices: (data) => {
            Object.keys(data).forEach(key => {
                if (liveIndices[key]) {
                    liveIndices[key].current = data[key].current;
                    liveIndices[key].prevClose = data[key].prevClose;
                    liveIndices[key].history = data[key].history;
                }
            });
        },
        updateCurrencies: (data) => {
            Object.keys(data).forEach(key => {
                if (liveCurrencies[key]) {
                    liveCurrencies[key].current = data[key].current;
                    liveCurrencies[key].prevClose = data[key].prevClose;
                    liveCurrencies[key].base = data[key].current;
                }
            });
        },
        updateUsdBasis: (data) => {
            Object.keys(data).forEach(key => {
                if (usdBasisRates[key]) {
                    usdBasisRates[key].current = data[key].current;
                    usdBasisRates[key].prevClose = data[key].prevClose;
                    usdBasisRates[key].base = data[key].current;
                    usdBasisRates[key].changeRate = data[key].changeRate;
                }
            });
        },
        updateCurrentAnchor: (data) => {
            if (!window.REAL_HISTORICAL_DATA) return;
            const finalAnchor = window.REAL_HISTORICAL_DATA[window.REAL_HISTORICAL_DATA.length - 1];
            Object.keys(data).forEach(key => {
                if (finalAnchor[key] !== undefined) {
                    finalAnchor[key] = data[key];
                }
            });
            // Also calculate value index proxies if not explicitly provided
            if (data.dxy) {
                finalAnchor.usdValueIndex = parseFloat((100 * (101.87 / data.dxy)).toFixed(1));
            }
            if (data.usdjpy) {
                finalAnchor.jpyValueVsUsd = parseFloat((100 * (105.16 / data.usdjpy)).toFixed(1));
            }

            // Also update the extended cache's last item if it exists
            if (historicalDataCache && historicalDataCache.length > 0) {
                const cacheAnchor = historicalDataCache[historicalDataCache.length - 1];
                Object.keys(data).forEach(key => {
                    if (cacheAnchor[key] !== undefined) {
                        cacheAnchor[key] = data[key];
                    }
                });
                if (data.dxy) {
                    cacheAnchor.usdValueIndex = parseFloat((100 * (101.87 / data.dxy)).toFixed(1));
                    cacheAnchor.dxy = data.dxy;
                }
                if (data.usdjpy) {
                    cacheAnchor.jpyValueVsUsd = parseFloat((100 * (105.16 / data.usdjpy)).toFixed(1));
                    cacheAnchor.usdjpy = data.usdjpy;
                }
            }
        },
        tick: tickLiveMarket
    };
})();

// 전역 변수로 등록하여 index.html에서 접근 가능하게 설정
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MockDataModule;
} else {
    window.MockDataModule = MockDataModule;
}
