// ============================================================
//  Ledger ↔ Investidor10 — Cloudflare Worker (CORS proxy)
// ------------------------------------------------------------
//  Deploy: https://workers.cloudflare.com
//  Free tier: 100k requests/day — sobra muito.
//
//  Endpoints expostos (todos GET):
//    /i10/metrics/:walletId          → PL, aplicado, variação
//    /i10/earnings/:walletId?year=   → soma de proventos no ano
//    /i10/actives/:walletId          → lista de ativos (tickers)
//    /i10/barchart/:walletId         → histórico mensal (12m)
//    /i10/all/:walletId?year=        → tudo de uma vez (recomendado)
//
//  Segurança: só permite paths conhecidos do Investidor10.
//  Não é um proxy aberto.
// ============================================================

const I10_BASE = 'https://investidor10.com.br/wallet/api/proxy/wallet-app';
const CACHE_TTL = 300; // 5 min — reduz carga no I10 e melhora resposta

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

async function fetchI10(path) {
  const url = `${I10_BASE}${path}`;
  const res = await fetch(url, {
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    headers: {
      // Alguns endpoints são picky com o User-Agent
      'User-Agent': 'Mozilla/5.0 (compatible; LedgerBot/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`I10 ${res.status} on ${path}`);
  return res.json();
}

function isValidWalletId(id) {
  return /^\d{1,12}$/.test(id);
}

function currentYearRange(year) {
  const y = year && /^\d{4}$/.test(year) ? year : new Date().getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') return err('Method not allowed', 405);

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['i10', 'metrics', '1986068']
  if (parts[0] !== 'i10') return err('Not found', 404);

  const kind = parts[1];
  const walletId = parts[2];
  if (!walletId || !isValidWalletId(walletId)) return err('Invalid walletId', 400);

  try {
    if (kind === 'metrics') {
      const data = await fetchI10(`/summary/metrics/${walletId}?type=without-earnings&raw=1`);
      return json(data);
    }

    if (kind === 'earnings') {
      const { start, end } = currentYearRange(url.searchParams.get('year'));
      const data = await fetchI10(`/earnings/total-period/${walletId}?start_date=${start}&end_date=${end}`);
      return json(data);
    }

    if (kind === 'actives') {
      const data = await fetchI10(`/summary/actives/${walletId}/Ticker?raw=1&selected_wallet_currency=BRL`);
      return json(data);
    }

    if (kind === 'barchart') {
      const data = await fetchI10(`/summary/barchart/${walletId}/12/all`);
      return json(data);
    }

    if (kind === 'all') {
      // Busca em paralelo tudo que o Ledger precisa em UMA chamada.
      // Barchart é tolerante a falha: se quebrar, o resto da resposta
      // continua válida e o app trata `barchart === null`.
      const { start, end } = currentYearRange(url.searchParams.get('year'));
      const [metrics, earnings, actives, barchart] = await Promise.all([
        fetchI10(`/summary/metrics/${walletId}?type=without-earnings&raw=1`),
        fetchI10(`/earnings/total-period/${walletId}?start_date=${start}&end_date=${end}`),
        fetchI10(`/summary/actives/${walletId}/Ticker?raw=1&selected_wallet_currency=BRL`),
        fetchI10(`/summary/barchart/${walletId}/12/all`).catch(() => null),
      ]);
      return json({
        metrics,
        earnings,
        actives,
        barchart,
        fetchedAt: new Date().toISOString(),
        walletId,
      });
    }

    return err('Unknown endpoint', 404);
  } catch (e) {
    return err('Upstream error: ' + e.message, 502);
  }
}

export default {
  async fetch(request) {
    return handle(request);
  },
};
