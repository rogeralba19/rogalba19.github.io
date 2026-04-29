/**
 * P2P Monitor - Binance P2P CLP <-> BOB via USDT
 * Internal tool for remittance margin calculation
 */

(function () {
    'use strict';

    // --- Config ---
    const AUTH_KEY = 'p2p_auth';
    const PROXY_KEY = 'p2p_proxy_url';
    const ACCESS_CODE = 'alba2024p2p';
    const REFRESH_INTERVAL = 60; // seconds

    // --- State ---
    let clpOffers = [];
    let bobOffers = [];
    let countdown = REFRESH_INTERVAL;
    let countdownTimer = null;
    let refreshTimer = null;

    // --- DOM refs ---
    const $ = (id) => document.getElementById(id);

    // --- Auth ---
    function checkAuth() {
        if (sessionStorage.getItem(AUTH_KEY) === 'true') {
            showApp();
            return;
        }

        $('auth-submit').addEventListener('click', handleLogin);
        $('auth-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }

    function handleLogin() {
        const pwd = $('auth-password').value.trim();
        if (pwd === ACCESS_CODE) {
            sessionStorage.setItem(AUTH_KEY, 'true');
            showApp();
        } else {
            $('auth-error').textContent = 'Clave incorrecta';
        }
    }

    function showApp() {
        $('auth-gate').classList.add('hidden');
        $('app').classList.remove('hidden');
        init();
    }

    // --- Init ---
    function init() {
        // Load proxy URL
        const savedProxy = localStorage.getItem(PROXY_KEY);
        if (savedProxy) {
            $('proxy-url').value = savedProxy;
        }

        // Event listeners
        $('refresh-btn').addEventListener('click', fetchAll);
        $('save-proxy').addEventListener('click', saveProxy);
        $('input-clp').addEventListener('input', recalculate);
        $('input-rate').addEventListener('input', recalculate);
        $('input-competition').addEventListener('input', recalculate);

        // Start
        fetchAll();
        startCountdown();
    }

    function saveProxy() {
        const url = $('proxy-url').value.trim();
        if (url) {
            localStorage.setItem(PROXY_KEY, url);
            setStatus('online', 'Proxy guardado');
            fetchAll();
        }
    }

    function getProxyUrl() {
        return localStorage.getItem(PROXY_KEY) || '';
    }

    // --- Countdown ---
    function startCountdown() {
        if (countdownTimer) clearInterval(countdownTimer);
        if (refreshTimer) clearTimeout(refreshTimer);

        countdown = REFRESH_INTERVAL;
        updateCountdownDisplay();

        countdownTimer = setInterval(() => {
            countdown--;
            updateCountdownDisplay();
            if (countdown <= 0) {
                clearInterval(countdownTimer);
                fetchAll();
                startCountdown();
            }
        }, 1000);
    }

    function updateCountdownDisplay() {
        $('countdown').textContent = countdown + 's';
    }

    // --- Status ---
    function setStatus(state, text) {
        const dot = $('status-indicator');
        dot.className = 'status-dot' + (state === 'online' ? ' online' : state === 'error' ? ' error' : '');
        $('status-text').textContent = text;
    }

    function updateTimestamp() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        $('last-update').textContent = h + ':' + m + ':' + s;
    }

    // --- Fetch Data ---
    async function fetchAll() {
        const proxyUrl = getProxyUrl();
        if (!proxyUrl) {
            setStatus('error', 'Configura la URL del proxy primero');
            renderError('clp-offers', 'Configura el proxy en la seccion inferior');
            renderError('bob-offers', 'Configura el proxy en la seccion inferior');
            return;
        }

        $('refresh-btn').classList.add('loading');
        setStatus('', 'Actualizando...');

        try {
            const [clpResult, bobResult] = await Promise.all([
                fetchP2P(proxyUrl, 'USDT', 'CLP', 'BUY', 5),
                fetchP2P(proxyUrl, 'USDT', 'BOB', 'SELL', 5)
            ]);

            clpOffers = clpResult;
            bobOffers = bobResult;

            renderOffers('clp-offers', clpOffers, 'CLP', 'buy');
            renderOffers('bob-offers', bobOffers, 'BOB', 'sell');
            recalculate();
            updateTimestamp();
            setStatus('online', 'Conectado - ' + clpOffers.length + ' CLP / ' + bobOffers.length + ' BOB ofertas');
            countdown = REFRESH_INTERVAL;
        } catch (err) {
            setStatus('error', 'Error: ' + err.message);
            console.error('Fetch error:', err);
        } finally {
            $('refresh-btn').classList.remove('loading');
        }
    }

    async function fetchP2P(proxyUrl, asset, fiat, tradeType, rows) {
        const body = {
            asset: asset,
            fiat: fiat,
            tradeType: tradeType,
            page: 1,
            rows: rows,
            payTypes: []
        };

        const res = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            throw new Error('Proxy respondio con ' + res.status);
        }

        const json = await res.json();
        if (!json.data) {
            throw new Error('Respuesta sin datos');
        }

        return json.data.map((item) => ({
            price: parseFloat(item.adv.price),
            minAmount: parseFloat(item.adv.minSingleTransAmount),
            maxAmount: parseFloat(item.adv.dynamicMaxSingleTransAmount || item.adv.maxSingleTransAmount),
            availableAmount: parseFloat(item.adv.surplusAmount),
            methods: (item.adv.tradeMethods || []).map((m) => m.tradeMethodShortName || m.tradeMethodName || m.identifier),
            merchant: item.advertiser.nickName,
            completedOrders: item.advertiser.monthOrderCount || 0,
            completionRate: item.advertiser.monthFinishRate ? (parseFloat(item.advertiser.monthFinishRate) * 100).toFixed(1) : '0'
        }));
    }

    // --- Render Offers ---
    function renderOffers(containerId, offers, fiat, type) {
        const container = $(containerId);

        if (!offers || offers.length === 0) {
            container.innerHTML = '<div class="loading-placeholder">Sin ofertas disponibles</div>';
            return;
        }

        // Determine best offer
        let bestIndex = 0;
        if (type === 'buy') {
            // Buying USDT: lowest CLP price is best
            bestIndex = offers.reduce((best, o, i) => o.price < offers[best].price ? i : best, 0);
        } else {
            // Selling USDT: highest BOB price is best
            bestIndex = offers.reduce((best, o, i) => o.price > offers[best].price ? i : best, 0);
        }

        container.innerHTML = offers.map((o, i) => {
            const isBest = i === bestIndex;
            const formattedPrice = formatNumber(o.price, fiat === 'CLP' ? 2 : 2);
            const methodBadges = o.methods.map((m) => '<span class="method-badge">' + escapeHtml(m) + '</span>').join('');

            return '<div class="offer-card' + (isBest ? ' best' : '') + '">' +
                '<div class="offer-top">' +
                    '<div>' +
                        '<span class="offer-price">' + formattedPrice + ' ' + fiat + '</span>' +
                        (isBest ? ' <span class="best-badge">MEJOR</span>' : '') +
                    '</div>' +
                    '<div class="offer-merchant">' +
                        '<span>' + escapeHtml(o.merchant) + '</span>' +
                        ' <span class="reputation">' + o.completionRate + '% (' + o.completedOrders + ')</span>' +
                    '</div>' +
                '</div>' +
                '<div class="offer-bottom">' +
                    '<div class="offer-limits">' +
                        '<span>' + formatNumber(o.minAmount, 0) + ' - ' + formatNumber(o.maxAmount, 0) + ' ' + fiat + '</span>' +
                    '</div>' +
                    '<div class="offer-methods">' + methodBadges + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function renderError(containerId, message) {
        $(containerId).innerHTML = '<div class="error-panel"><span class="error-icon">!</span>' + escapeHtml(message) + '</div>';
    }

    // --- Calculator ---
    function recalculate() {
        const inputClp = parseFloat($('input-clp').value) || 0;
        const inputBobPerThousand = parseFloat($('input-rate').value) || 0;
        const competitionBobPerThousand = parseFloat($('input-competition').value) || 10;

        // Best prices
        const bestClpPrice = clpOffers.length > 0
            ? Math.min(...clpOffers.map((o) => o.price))
            : 0;
        const bestBobPrice = bobOffers.length > 0
            ? Math.max(...bobOffers.map((o) => o.price))
            : 0;

        $('res-best-clp').textContent = bestClpPrice ? formatNumber(bestClpPrice, 2) + ' CLP' : '-';
        $('res-best-bob').textContent = bestBobPrice ? formatNumber(bestBobPrice, 2) + ' BOB' : '-';
        $('res-market-rate').textContent = bestClpPrice && bestBobPrice
            ? '1.000 CLP = ' + formatNumber(getBobPerThousand(bestClpPrice, bestBobPrice), 2) + ' BOB'
            : '-';

        if (!bestClpPrice || !bestBobPrice || !inputClp) {
            $('res-usdt').textContent = '-';
            $('res-bob-market').textContent = '-';
            $('res-bob-client').textContent = '-';
            $('res-profit').textContent = '-';
            $('res-profit-usd').textContent = '-';
            $('res-margin').textContent = '-';
            updateSuggested(bestClpPrice, bestBobPrice, competitionBobPerThousand, 0);
            return;
        }

        // USDT obtainable
        const usdt = inputClp / bestClpPrice;
        $('res-usdt').textContent = formatNumber(usdt, 4) + ' USDT';

        // BOB from market
        const bobMarket = usdt * bestBobPrice;
        $('res-bob-market').textContent = formatNumber(bobMarket, 2) + ' BOB';

        // BOB to deliver to client
        const bobClient = inputBobPerThousand > 0 ? (inputClp / 1000) * inputBobPerThousand : 0;
        $('res-bob-client').textContent = bobClient > 0 ? formatNumber(bobClient, 2) + ' BOB' : '-';

        // Profit
        if (bobClient > 0) {
            const profitBob = bobMarket - bobClient;
            const profitUsd = bestBobPrice > 0 ? profitBob / bestBobPrice : 0;
            const marginPct = bobMarket > 0 ? (profitBob / bobMarket) * 100 : 0;

            $('res-profit').textContent = formatNumber(profitBob, 2) + ' BOB';
            $('res-profit').style.color = profitBob >= 0 ? '#00ff88' : '#ff4466';
            $('res-profit-usd').textContent = '~' + formatNumber(profitUsd, 2) + ' USD';
            $('res-margin').textContent = formatNumber(marginPct, 2) + '%';
            $('res-margin').style.color = marginPct >= 0 ? '#ffaa00' : '#ff4466';
        } else {
            $('res-profit').textContent = '-';
            $('res-profit-usd').textContent = '-';
            $('res-margin').textContent = '-';
        }

        updateSuggested(bestClpPrice, bestBobPrice, competitionBobPerThousand, inputClp);
    }

    function updateSuggested(bestClpPrice, bestBobPrice, competitionBobPerThousand, inputClp) {
        // 5% better than competition means the client receives 5% more BOB per 1.000 CLP.
        const suggestedBobPerThousand = competitionBobPerThousand * 1.05;
        $('sug-rate').textContent = '1.000 CLP = ' + formatNumber(suggestedBobPerThousand, 2) + ' BOB';
        $('sug-detail').textContent = 'Competencia: 1.000 CLP = ' + formatNumber(competitionBobPerThousand, 2) + ' BOB';

        if (bestClpPrice > 0 && bestBobPrice > 0 && inputClp > 0) {
            const usdt = inputClp / bestClpPrice;
            const bobMarket = usdt * bestBobPrice;
            const bobClient = (inputClp / 1000) * suggestedBobPerThousand;
            const profitBob = bobMarket - bobClient;
            const marginPct = bobMarket > 0 ? (profitBob / bobMarket) * 100 : 0;

            $('sug-margin').textContent = formatNumber(marginPct, 2) + '%';
            $('sug-margin-detail').textContent = 'Ganancia: ' + formatNumber(profitBob, 2) + ' BOB (~' + formatNumber(profitBob / bestBobPrice, 2) + ' USD)';
        } else {
            $('sug-margin').textContent = '-';
            $('sug-margin-detail').textContent = 'Ingresa un monto CLP para calcular';
        }
    }

    function getBobPerThousand(clpPerUsdt, bobPerUsdt) {
        return (bobPerUsdt / clpPerUsdt) * 1000;
    }

    // --- Utilities ---
    function formatNumber(num, decimals) {
        return num.toLocaleString('es-CL', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Start ---
    document.addEventListener('DOMContentLoaded', checkAuth);
})();
