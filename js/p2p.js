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
    let filteredClpOffers = [];
    let filteredBobOffers = [];
    let selectedClpOfferId = null;
    let selectedBobOfferId = null;
    const offerFilters = {
        buy: { sort: 'price', minAmount: 0, methods: new Set(), verifiedOnly: true },
        sell: { sort: 'price', minAmount: 0, methods: new Set(), verifiedOnly: true }
    };
    let filterFetchTimer = null;
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
        setupOfferFilters();

        // Start
        fetchAll();
        startCountdown();
    }

    function setupOfferFilters() {
        $('clp-sort').addEventListener('change', () => updateSort('buy', $('clp-sort').value));
        $('bob-sort').addEventListener('change', () => updateSort('sell', $('bob-sort').value));
        $('clp-min-amount').addEventListener('input', () => updateMinAmountFilter('buy', $('clp-min-amount').value));
        $('bob-min-amount').addEventListener('input', () => updateMinAmountFilter('sell', $('bob-min-amount').value));
        $('clp-method-toggle').addEventListener('click', () => toggleMethodMenu('buy'));
        $('bob-method-toggle').addEventListener('click', () => toggleMethodMenu('sell'));

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.multi-filter')) {
                $('clp-method-menu').classList.add('hidden');
                $('bob-method-menu').classList.add('hidden');
            }
        });
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
    function scheduleFetchAll() {
        if (filterFetchTimer) clearTimeout(filterFetchTimer);
        filterFetchTimer = setTimeout(() => {
            filterFetchTimer = null;
            fetchAll();
        }, 450);
    }

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
                fetchP2P(proxyUrl, 'USDT', 'CLP', 'BUY', 6, offerFilters.buy),
                fetchP2P(proxyUrl, 'USDT', 'BOB', 'SELL', 6, offerFilters.sell)
            ]);

            clpOffers = clpResult;
            bobOffers = bobResult;

            renderMethodFilters('buy');
            renderMethodFilters('sell');
            applyOfferFilters();
            recalculate();
            updateTimestamp();
            setStatus('online', 'Conectado - ' + filteredClpOffers.length + ' CLP / ' + filteredBobOffers.length + ' BOB ofertas filtradas');
            countdown = REFRESH_INTERVAL;
        } catch (err) {
            setStatus('error', 'Error: ' + err.message);
            console.error('Fetch error:', err);
        } finally {
            $('refresh-btn').classList.remove('loading');
        }
    }

    async function fetchP2P(proxyUrl, asset, fiat, tradeType, rows, filters) {
        const body = {
            asset: asset,
            fiat: fiat,
            tradeType: tradeType,
            page: 1,
            rows: rows,
            payTypes: Array.from(filters.methods),
            publisherType: filters.verifiedOnly ? 'merchant' : null,
            transAmount: filters.minAmount > 0 ? String(filters.minAmount) : ''
        };

        const res = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            let detail = '';
            try {
                const errJson = await res.json();
                detail = errJson.error || JSON.stringify(errJson);
                if (errJson.bodyPreview) detail += ' :: ' + errJson.bodyPreview;
                else if (errJson.binanceBody) detail += ' :: ' + JSON.stringify(errJson.binanceBody);
            } catch (_) {
                detail = await res.text().catch(() => '');
            }
            throw new Error('Proxy respondio con ' + res.status + (detail ? ' - ' + detail : ''));
        }

        const json = await res.json();
        if (!json.data) {
            throw new Error('Respuesta sin datos');
        }

        return json.data.map((item, index) => ({
            id: [
                item.advertiser.userNo || item.advertiser.nickName || 'merchant',
                item.adv.advNo || index,
                item.adv.price
            ].join('-'),
            price: parseFloat(item.adv.price),
            minAmount: parseFloat(item.adv.minSingleTransAmount),
            maxAmount: parseFloat(item.adv.dynamicMaxSingleTransAmount || item.adv.maxSingleTransAmount),
            availableAmount: parseFloat(item.adv.surplusAmount),
            methods: (item.adv.tradeMethods || []).map((m) => ({
                id: m.identifier || m.tradeMethodName || m.tradeMethodShortName,
                label: m.tradeMethodShortName || m.tradeMethodName || m.identifier
            })).filter((m) => m.id && m.label),
            merchant: item.advertiser.nickName,
            verified: isVerifiedMerchant(item.advertiser),
            completedOrders: item.advertiser.monthOrderCount || 0,
            completionRate: item.advertiser.monthFinishRate ? (parseFloat(item.advertiser.monthFinishRate) * 100).toFixed(1) : '0'
        }));
    }

    // --- Offer Filters ---
    function updateSort(type, sortValue) {
        offerFilters[type].sort = sortValue;
        applyOfferFilters();
    }

    function updateMinAmountFilter(type, value) {
        offerFilters[type].minAmount = parseFloat(value) || 0;
        clearSelectedOffer(type);
        scheduleFetchAll();
    }

    function toggleMethodMenu(type) {
        const menu = $(type === 'buy' ? 'clp-method-menu' : 'bob-method-menu');
        const otherMenu = $(type === 'buy' ? 'bob-method-menu' : 'clp-method-menu');
        otherMenu.classList.add('hidden');
        menu.classList.toggle('hidden');
    }

    function renderMethodFilters(type) {
        const offers = type === 'buy' ? clpOffers : bobOffers;
        const menu = $(type === 'buy' ? 'clp-method-menu' : 'bob-method-menu');
        const selectedMethods = offerFilters[type].methods;
        const methods = getAvailableMethods(offers);

        if (methods.length === 0) {
            menu.innerHTML = '<div class="multi-empty">Sin bancos disponibles</div>';
            updateMethodButton(type);
            return;
        }

        menu.innerHTML = methods.map((method) => {
            const id = (type === 'buy' ? 'clp' : 'bob') + '-method-' + slugify(method.id);
            return '<label class="multi-option" for="' + id + '">' +
                '<input type="checkbox" id="' + id + '" data-method="' + escapeAttr(method.id) + '"' + (selectedMethods.has(method.id) ? ' checked' : '') + '>' +
                '<span>' + escapeHtml(method.label) + '</span>' +
            '</label>';
        }).join('');

        menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
            input.addEventListener('change', () => {
                const method = input.getAttribute('data-method');
                if (input.checked) selectedMethods.add(method);
                else selectedMethods.delete(method);
                clearSelectedOffer(type);
                updateMethodButton(type);
                scheduleFetchAll();
            });
        });

        updateMethodButton(type);
    }

    function updateMethodButton(type) {
        const selectedCount = offerFilters[type].methods.size;
        const button = $(type === 'buy' ? 'clp-method-toggle' : 'bob-method-toggle');
        button.textContent = selectedCount > 0 ? 'Bancos: ' + selectedCount : 'Bancos: Todos';
    }

    function applyOfferFilters() {
        filteredClpOffers = getFilteredOffers(clpOffers, 'buy');
        filteredBobOffers = getFilteredOffers(bobOffers, 'sell');
        ensureSelectedOffer('buy');
        ensureSelectedOffer('sell');
        renderOffers('clp-offers', filteredClpOffers, 'CLP', 'buy');
        renderOffers('bob-offers', filteredBobOffers, 'BOB', 'sell');
        recalculate();
    }

    function getFilteredOffers(offers, type) {
        const filters = offerFilters[type];
        const selectedMethods = Array.from(filters.methods);
        return offers
            .filter((offer) => !filters.verifiedOnly || offer.verified)
            .filter((offer) => !filters.minAmount || amountFitsOffer(filters.minAmount, offer))
            .filter((offer) => selectedMethods.length === 0 || selectedMethods.some((method) => offer.methods.some((offerMethod) => offerMethod.id === method)))
            .sort((a, b) => compareOffers(a, b, type, filters.sort));
    }

    function compareOffers(a, b, type, sortValue) {
        if (sortValue === 'orders') return b.completedOrders - a.completedOrders;
        return type === 'buy' ? a.price - b.price : b.price - a.price;
    }

    function amountFitsOffer(amount, offer) {
        return amount >= offer.minAmount && amount <= offer.maxAmount;
    }

    function ensureSelectedOffer(type) {
        const offers = type === 'buy' ? filteredClpOffers : filteredBobOffers;
        const selectedId = type === 'buy' ? selectedClpOfferId : selectedBobOfferId;
        if (offers.length === 0) {
            if (type === 'buy') selectedClpOfferId = null;
            else selectedBobOfferId = null;
            return;
        }
        if (!selectedId || !offers.some((offer) => offer.id === selectedId)) {
            if (type === 'buy') selectedClpOfferId = getBestOffer(offers, type).id;
            else selectedBobOfferId = getBestOffer(offers, type).id;
        }
    }

    function clearSelectedOffer(type) {
        if (type === 'buy') selectedClpOfferId = null;
        else selectedBobOfferId = null;
    }

    function selectOffer(type, offerId) {
        if (type === 'buy') selectedClpOfferId = offerId;
        else selectedBobOfferId = offerId;
        renderOffers(type === 'buy' ? 'clp-offers' : 'bob-offers', type === 'buy' ? filteredClpOffers : filteredBobOffers, type === 'buy' ? 'CLP' : 'BOB', type);
        recalculate();
    }

    function getSelectedOffer(type) {
        const offers = type === 'buy' ? filteredClpOffers : filteredBobOffers;
        const selectedId = type === 'buy' ? selectedClpOfferId : selectedBobOfferId;
        return offers.find((offer) => offer.id === selectedId) || getBestOffer(offers, type);
    }

    function getBestOffer(offers, type) {
        if (!offers || offers.length === 0) return null;
        return offers.reduce((best, offer) => {
            if (!best) return offer;
            return compareOffers(offer, best, type, 'price') < 0 ? offer : best;
        }, null);
    }

    function getAvailableMethods(offers) {
        const byId = new Map();
        offers.flatMap((offer) => offer.methods).forEach((method) => {
            if (method.id && !byId.has(method.id)) byId.set(method.id, method);
        });
        return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
    }

    function isVerifiedMerchant(advertiser) {
        const values = [
            advertiser.userType,
            advertiser.userGrade,
            advertiser.badge,
            advertiser.badgeType,
            advertiser.isMerchant,
            advertiser.merchant
        ];
        return values.some((value) => {
            if (value === true) return true;
            if (!Number.isNaN(Number(value)) && Number(value) > 0) return true;
            const text = String(value || '').toLowerCase();
            return text.includes('merchant') || text.includes('verified') || text.includes('verificado');
        });
    }

    // --- Render Offers ---
    function renderOffers(containerId, offers, fiat, type) {
        const container = $(containerId);

        if (!offers || offers.length === 0) {
            container.innerHTML = '<div class="loading-placeholder">Sin ofertas con esos filtros</div>';
            return;
        }

        const bestOffer = getBestOffer(offers, type);
        const selectedId = type === 'buy' ? selectedClpOfferId : selectedBobOfferId;

        container.innerHTML = offers.map((o) => {
            const isBest = bestOffer && o.id === bestOffer.id;
            const isSelected = o.id === selectedId;
            const formattedPrice = formatNumber(o.price, fiat === 'CLP' ? 2 : 2);
            const methodBadges = o.methods.map((m) => '<span class="method-badge">' + escapeHtml(m.label) + '</span>').join('');

            return '<div class="offer-card' + (isBest ? ' best' : '') + (isSelected ? ' selected' : '') + '">' +
                '<div class="offer-top">' +
                    '<div>' +
                        '<span class="offer-price">' + formattedPrice + ' ' + fiat + '</span>' +
                        (isBest ? ' <span class="best-badge">MEJOR</span>' : '') +
                        (o.verified ? ' <span class="verified-badge">VERIFICADO</span>' : '') +
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
                    '<div class="offer-actions">' +
                        '<div class="offer-methods">' + methodBadges + '</div>' +
                        '<button type="button" class="select-offer-btn' + (isSelected ? ' active' : '') + '" data-type="' + type + '" data-offer-id="' + escapeAttr(o.id) + '">' + (isSelected ? 'Usando' : 'Usar') + '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        container.querySelectorAll('.select-offer-btn').forEach((button) => {
            button.addEventListener('click', () => selectOffer(button.getAttribute('data-type'), button.getAttribute('data-offer-id')));
        });
    }

    function renderError(containerId, message) {
        $(containerId).innerHTML = '<div class="error-panel"><span class="error-icon">!</span>' + escapeHtml(message) + '</div>';
    }

    // --- Calculator ---
    function recalculate() {
        const inputClp = parseFloat($('input-clp').value) || 0;
        const inputBobPerThousand = parseFloat($('input-rate').value) || 0;
        const competitionBobPerThousand = parseFloat($('input-competition').value) || 10;

        const clpReferenceOffer = getSelectedOffer('buy');
        const bobReferenceOffer = getSelectedOffer('sell');
        const bestClpPrice = clpReferenceOffer ? clpReferenceOffer.price : 0;
        const bestBobPrice = bobReferenceOffer ? bobReferenceOffer.price : 0;

        $('res-best-clp').textContent = bestClpPrice ? formatNumber(bestClpPrice, 2) + ' CLP' : '-';
        $('res-best-bob').textContent = bestBobPrice ? formatNumber(bestBobPrice, 2) + ' BOB' : '-';
        $('res-market-rate').textContent = bestClpPrice && bestBobPrice
            ? formatNumber(getBobPerThousand(bestClpPrice, bestBobPrice), 2) + ' BOB por cada 1.000 CLP'
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
        $('sug-rate').textContent = formatNumber(suggestedBobPerThousand, 2) + ' BOB';
        $('sug-detail').textContent = 'por cada 1.000 CLP. Competencia: ' + formatNumber(competitionBobPerThousand, 2) + ' BOB';

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

    function escapeAttr(str) {
        return String(str).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function slugify(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'metodo';
    }

    // --- Start ---
    document.addEventListener('DOMContentLoaded', checkAuth);
})();
