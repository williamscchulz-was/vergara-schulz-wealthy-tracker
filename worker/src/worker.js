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
//    /i10/yearly/:walletId           → soma de proventos ano a ano
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
// I10 returns one /summary/actives endpoint per asset type. We don't
// have a single endpoint that returns 'all assets across all types',
// so we fan out and merge. Each failure is non-fatal: a missing type
// just contributes an empty list to the merged result.
const I10_ASSET_TYPES = [
  'Ticker',           // ações
  'TesouroDireto',
  'RendaFixa',
  'Fii',              // fundos imobiliários
  'Etf',
  'Bdr',
  'FundoInvestimento',
  'Criptomoeda',
];

async function fetchAllActives(walletId) {
  const fetches = I10_ASSET_TYPES.map(async (type) => {
    try {
      const data = await fetchI10(`/summary/actives/${walletId}/${type}?raw=1&selected_wallet_currency=BRL`);
      const rows = Array.isArray(data?.data) ? data.data : [];
      // Tag each row with the upstream type so the app maps to a
      // human-friendly category without guessing from the ticker.
      return rows.map(r => ({ ...r, __assetClass: type }));
    } catch (e) {
      return []; // Asset type not present in this wallet — fine.
    }
  });
  const results = await Promise.all(fetches);
  return { data: results.flat() };
}

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

// Today (UTC) as YYYY-MM-DD — Cloudflare runs in UTC.
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
// End date for a dividends window: the year's Dec 31, but NEVER past today —
// so we sum only proventos JÁ PAGOS, not the ones announced with a future
// payment date (provisionados). I10's total-period soma por data de pagamento,
// e com end_date no futuro ele inclui os anunciados-mas-não-pagos. ISO date
// strings compare lexicographically, so this min() is a plain string compare.
function dividendsEndDate(y) {
  const dec31 = `${y}-12-31`;
  const today = todayUTC();
  return today < dec31 ? today : dec31;
}
function currentYearRange(year) {
  const y = year && /^\d{4}$/.test(year) ? year : new Date().getUTCFullYear();
  return { start: `${y}-01-01`, end: dividendsEndDate(y) };
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
      const data = await fetchAllActives(walletId);
      return json(data);
    }

    if (kind === 'barchart') {
      const data = await fetchI10(`/summary/barchart/${walletId}/12/all`);
      return json(data);
    }

    if (kind === 'yearly') {
      // Reconstrói histórico anual real:
      //  - equity: pega o último mês de cada ano do barchart longo
      //    (/summary/barchart/<id>/<months>/all). O parâmetro de meses
      //    aceita números maiores que 12 — pedimos 120 (10 anos) e o I10
      //    devolve o que tiver. Cada item: { month: 'MM/YY', sum_equity,
      //    sum_applied, sum_flow }.
      //  - divs: continua via /earnings/total-period (um por ano).
      const startYear = Number(url.searchParams.get('start') || '2018');
      const currentYear = new Date().getUTCFullYear();

      // 1) Long barchart for equity. Try 120 months; fall back to 60.
      let barchart = null;
      try { barchart = await fetchI10(`/summary/barchart/${walletId}/120/all`); }
      catch (e) {
        try { barchart = await fetchI10(`/summary/barchart/${walletId}/60/all`); }
        catch (e2) { barchart = null; }
      }

      // Parse barchart → { 'YYYY': { month, equity, applied, flow } }
      // Keep the LATEST month seen for each year so December (or the most
      // recent available) wins.
      const yearEnd = {};
      if (Array.isArray(barchart)) {
        for (const row of barchart) {
          const lab = row && (row.month || row.date);
          if (!lab) continue;
          const m = String(lab).match(/^(\d{1,2})\/(\d{2,4})$/);
          if (!m) continue;
          const mo = +m[1];
          let yr = +m[2]; if (yr < 100) yr += 2000;
          const eq = +row.sum_equity || 0;
          if (eq <= 0) continue;
          const cur = yearEnd[String(yr)];
          if (!cur || cur.month < mo) {
            yearEnd[String(yr)] = {
              month: mo,
              equity: eq,
              applied: +row.sum_applied || null,
              flow: +row.sum_flow || null,
            };
          }
        }
      }

      // 2) For each year, get divs from /earnings/total-period (parallel).
      const years = [];
      for (let y = startYear; y <= currentYear; y++) years.push(y);
      const results = await Promise.all(years.map(async (y) => {
        let divs = 0;
        try {
          const d = await fetchI10(`/earnings/total-period/${walletId}?start_date=${y}-01-01&end_date=${dividendsEndDate(y)}`);
          divs = +d.sum || 0;
        } catch (e) {}
        const e = yearEnd[String(y)];
        return {
          year: y,
          divs,
          equity: e ? e.equity : null,
          applied: e ? e.applied : null,
          flow: e ? e.flow : null,
        };
      }));
      return json({ years: results, walletId });
    }

    if (kind === 'all') {
      // Busca em paralelo tudo que o Ledger precisa em UMA chamada.
      // Barchart é tolerante a falha: se quebrar, o resto da resposta
      // continua válida e o app trata `barchart === null`.
      const { start, end } = currentYearRange(url.searchParams.get('year'));
      const [metrics, earnings, actives, barchart] = await Promise.all([
        fetchI10(`/summary/metrics/${walletId}?type=without-earnings&raw=1`),
        fetchI10(`/earnings/total-period/${walletId}?start_date=${start}&end_date=${end}`),
        fetchAllActives(walletId),
        // 120 months (10y) so the app derives year-end equity per year
        // straight from the barchart — no Firestore equity write, nothing
        // to wipe. Falls back to 12 if the long range ever fails.
        fetchI10(`/summary/barchart/${walletId}/120/all`)
          .catch(() => fetchI10(`/summary/barchart/${walletId}/12/all`).catch(() => null)),
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

// ============================================================
//  CRON — sync diário às 8h BRT, grava direto no Firestore.
//  Roda sem ninguém abrir o app. Autentica com uma service account
//  do Firebase (secret FIREBASE_SA, JSON inteiro) → token OAuth →
//  Firestore REST API. Escreve config/i10, config/i10-louise, config/fx.
// ============================================================
const PROJECT_ID = 'wealthy-tracker-68658';
const WALLET_W = '2814459';      // William (principal) — atualizar se migrar de novo
const WALLET_LOUISE = '2699282'; // Louise (filha)
const I10_TYPE_TO_CAT = {
  Ticker: 'Ações', TesouroDireto: 'Tesouro Direto', RendaFixa: 'Renda Fixa',
  Fii: 'FIIs', Etf: 'ETFs', Bdr: 'BDRs', FundoInvestimento: 'Fundos', Criptomoeda: 'Criptomoedas',
};

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function importPrivateKey(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error('token ' + res.status + ' ' + (await res.text()));
  return (await res.json()).access_token;
}
const tsNow = () => ({ __fsTimestamp: new Date().toISOString() });
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'object' && v.__fsTimestamp) return { timestampValue: v.__fsTimestamp };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFsValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
async function firestoreWrite(token, docPath, obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toFsValue(obj[k]);
  // updateMask → merge (preserves fields we don't touch, e.g. fx.usd/note)
  const mask = Object.keys(obj).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('fs ' + docPath + ' ' + res.status + ' ' + (await res.text()));
}
function parseBarchartMonthly(raw) {
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  const out = [];
  for (const r of rows) {
    const m = String(r.month || r.date || '').match(/^(\d{1,2})\/(\d{2,4})$/);
    if (!m) continue;
    const mo = +m[1]; let yr = +m[2]; if (yr < 100) yr += 2000;
    const eq = +r.sum_equity || +r.equity || 0;
    if (!yr || !mo || !(eq > 0)) continue;
    out.push({ year: yr, month: mo, equity: eq });
  }
  out.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return out;
}
async function cronSyncMain(token) {
  const year = new Date().getUTCFullYear();
  const [metrics, earnings, activesRaw, barchart] = await Promise.all([
    fetchI10(`/summary/metrics/${WALLET_W}?type=without-earnings&raw=1`),
    fetchI10(`/earnings/total-period/${WALLET_W}?start_date=${year}-01-01&end_date=${dividendsEndDate(year)}`),
    fetchAllActives(WALLET_W),
    fetchI10(`/summary/barchart/${WALLET_W}/120/all`).catch(() => null),
  ]);
  const rawAssets = Array.isArray(activesRaw?.data) ? activesRaw.data : [];
  const assets = rawAssets.map(a => ({
    ticker: a.ticker || a.ticker_name || '',
    quantity: +a.quantity || 0, avgPrice: +a.avg_price || 0,
    currentPrice: parseFloat(a.current_price) || 0,
    equity: +a.equity_total || parseFloat(a.equity_brl) || 0,
    appreciation: +a.appreciation || 0, percentWallet: +a.percent_wallet || 0,
    earnings: +a.earnings_received || 0, image: a.image || '', url: a.url || '',
    category: I10_TYPE_TO_CAT[a.__assetClass] || 'Outros',
  }));
  await firestoreWrite(token, 'household/main/config/i10', {
    equity: +metrics.equity || 0, applied: +metrics.applied || 0,
    variation: +metrics.variation || 0, profitTwr: +metrics.profit_twr || 0,
    dividends: +earnings?.sum || 0, year, assets, monthly: parseBarchartMonthly(barchart),
    updatedAt: tsNow(), updatedBy: 'cron 8h', source: 'investidor10-sync',
  });
}
async function cronSyncLouise(token) {
  const year = new Date().getUTCFullYear();
  const [metrics, earnings] = await Promise.all([
    fetchI10(`/summary/metrics/${WALLET_LOUISE}?type=without-earnings&raw=1`),
    fetchI10(`/earnings/total-period/${WALLET_LOUISE}?start_date=${year}-01-01&end_date=${dividendsEndDate(year)}`),
  ]);
  await firestoreWrite(token, 'household/main/config/i10-louise', {
    equity: +metrics.equity || 0, applied: +metrics.applied || 0,
    variation: +metrics.variation || 0, dividends: +earnings?.sum || 0, year,
    updatedAt: tsNow(), updatedBy: 'cron 8h', source: 'investidor10-sync',
  });
}
async function cronSyncFx(token) {
  const fx = await fetchUSDBRL();
  await firestoreWrite(token, 'household/main/config/fx', {
    rateUSD: fx.rateUSD, rateSource: fx.rateSource, rateUpdatedAt: fx.rateUpdatedAt, updatedAt: tsNow(),
  });
}
async function scheduled(event, env) {
  if (!env || !env.FIREBASE_SA) { console.log('cron: secret FIREBASE_SA ausente'); return; }
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SA); } catch (e) { console.log('cron: FIREBASE_SA JSON inválido'); return; }
  try {
    const token = await getAccessToken(sa);
    await cronSyncMain(token);
    await cronSyncLouise(token).catch(e => console.log('cron louise:', e.message));
    await cronSyncFx(token).catch(e => console.log('cron fx:', e.message));
    console.log('cron sync OK');
  } catch (e) {
    console.log('cron erro:', e.message);
  }
}

export default {
  async fetch(request) {
    return handle(request);
  },
  scheduled,
};
