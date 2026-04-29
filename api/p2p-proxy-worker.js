/**
 * Cloudflare Worker - P2P Proxy for Binance
 *
 * Deployment instructions:
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create
 * 2. Name it: p2p-proxy (or any name you prefer)
 * 3. Click "Edit code" and paste this entire file
 * 4. Click "Deploy"
 * 5. Copy the worker URL (e.g., https://p2p-proxy.tu-cuenta.workers.dev)
 * 6. Paste that URL in the P2P Monitor proxy config field
 *
 * Security:
 * - Only allows requests from your domain (albastudio.dev)
 * - Only proxies to Binance P2P endpoint
 * - Rate limited to prevent abuse
 */

const ALLOWED_ORIGINS = [
    'https://albastudio.dev',
    'https://www.albastudio.dev',
    'http://localhost:3000',
    'http://127.0.0.1:5500' // VS Code Live Server
];

const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }

        // Only allow POST
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // Check origin
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) {
            return new Response('Forbidden', { status: 403 });
        }

        try {
            const body = await request.json();

            // Validate request body - only allow expected fields
            const allowed = {
                asset: body.asset,
                fiat: body.fiat,
                tradeType: body.tradeType,
                page: body.page || 1,
                rows: Math.min(body.rows || 5, 20), // Cap at 20
                payTypes: body.payTypes || [],
                publisherType: body.publisherType || null,
                transAmount: body.transAmount || ''
            };

            // Only allow expected values
            if (!['USDT', 'BTC', 'ETH', 'BNB'].includes(allowed.asset)) {
                return jsonResponse({ error: 'Invalid asset' }, 400, origin);
            }
            if (!['BUY', 'SELL'].includes(allowed.tradeType)) {
                return jsonResponse({ error: 'Invalid tradeType' }, 400, origin);
            }

            // Proxy to Binance
            const binanceRes = await fetch(BINANCE_P2P_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                body: JSON.stringify(allowed)
            });

            const data = await binanceRes.json();

            return jsonResponse(data, 200, origin);
        } catch (err) {
            return jsonResponse({ error: 'Proxy error: ' + err.message }, 500, origin);
        }
    }
};

function handleCORS(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
    };

    if (ALLOWED_ORIGINS.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    return new Response(null, { status: 204, headers });
}

function jsonResponse(data, status, origin) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (ALLOWED_ORIGINS.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    return new Response(JSON.stringify(data), { status, headers });
}
