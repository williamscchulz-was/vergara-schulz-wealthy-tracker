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
//    /fx/rate                        → cotação USD→BRL (AwesomeAPI)
//
//  Segurança: só permite paths em allowlist. Não é proxy aberto.
// ============================================================

const I10_BASE = 'https://investidor10.com.br/wallet/api/proxy/wallet-app';
const CACHE_TTL = 300; // 5 min — reduz carga no I10 e melhora resposta
const FX_CACHE_TTL = 900; // 15 min pra cotação USD→BRL

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
  // NOTA: removido `cacheEverything: true` (era 100% truncado em 2026-04
  // quando uma wallet privada gerou 502 e o erro ficou cacheado mesmo
  // depois de a wallet ser publicada). Sem `cacheEverything`, Cloudflare
  // só cacheia respostas 2xx que o upstream marcar como cacheáveis — é
  // o comportamento default e o que a gente quer. Performance fica
  // praticamente igual pra respostas válidas.
  const res = await fetch(url, {
    cf: { cacheTtl: CACHE_TTL },
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

// AwesomeAPI is a free, no-auth Brazilian endpoint that gives spot
// USD→BRL pretty close to PTAX. Bid is what consumer apps usually show.
async function fetchUSDBRL() {
  const url = 'https://economia.awesomeapi.com.br/last/USD-BRL';
  const res = await fetch(url, {
    cf: { cacheTtl: FX_CACHE_TTL },
    headers: { 'Accept': 'application/json', 'User-Agent': 'LedgerBot/1.0' },
  });
  if (!res.ok) throw new Error(`AwesomeAPI ${res.status}`);
  const data = await res.json();
  const node = data && data.USDBRL;
  if (!node || !node.bid) throw new Error('AwesomeAPI unexpected shape');
  return {
    rateUSD: +node.bid,
    rateSource: 'awesomeapi:USD-BRL',
    rateUpdatedAt: node.create_date || new Date().toISOString(),
  };
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
  const parts = url.pathname.split('/').filter(Boolean); // ['i10', 'metrics', '2814459']

  // /fx/rate — cotação USD→BRL (independente do I10)
  if (parts[0] === 'fx' && parts[1] === 'rate') {
    try {
      const data = await fetchUSDBRL();
      return json(data, 200, { 'Cache-Control': `public, max-age=${FX_CACHE_TTL}` });
    } catch (e) {
      return err('FX upstream error: ' + e.message, 502);
    }
  }

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
