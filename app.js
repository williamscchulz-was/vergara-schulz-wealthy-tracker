// ============================================================
//  LEDGER — Wealth Tracker (app.js)
//  Entrega B: brapi.dev + CoinGecko + 4h refresh + year-close
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- Firebase ----
const firebaseConfig = {
  apiKey: "AIzaSyA5zsPOxpOBPN8BVnJRIN0mIJ4gdlUntc8",
  authDomain: "wealthy-tracker-68658.firebaseapp.com",
  projectId: "wealthy-tracker-68658",
  storageBucket: "wealthy-tracker-68658.firebasestorage.app",
  messagingSenderId: "559892333696",
  appId: "1:559892333696:web:3272f0f8e86449f4885265"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ---- API config ----
const BRAPI_TOKEN = "sagKZLJeR9rdAVWK9xMhgT";
const BRAPI_QUOTE = (tickers) => `https://brapi.dev/api/quote/${tickers}?token=${BRAPI_TOKEN}`;
const BRAPI_CURRENCY = `https://brapi.dev/api/v2/currency?currency=USD-BRL&token=${BRAPI_TOKEN}`;
const COINGECKO_BTC = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true`;

const COINGECKO_MAP = { BTC: 'bitcoin' };
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---- Paths ----
const colSnapshots = () => collection(db, "household", "main", "snapshots");
const colStocks    = () => collection(db, "household", "main", "stocks");
const colCrypto    = () => collection(db, "household", "main", "crypto");
const colFx        = () => collection(db, "household", "main", "fxAccounts");
const colYearly    = () => collection(db, "household", "main", "dividendsYearly");
const colFixed     = () => collection(db, "household", "main", "fixedIncome");
const docStock  = (id) => doc(db, "household", "main", "stocks", id);
const docCrypto = (id) => doc(db, "household", "main", "crypto", id);
const docFx     = (id) => doc(db, "household", "main", "fxAccounts", id);
const docYearly = (id) => doc(db, "household", "main", "dividendsYearly", id);
const docFixed  = (id) => doc(db, "household", "main", "fixedIncome", id);
const docConfig    = doc(db, "household", "main", "config", "settings");
const docDividends = doc(db, "household", "main", "config", "dividends");
const docQuotes    = doc(db, "household", "main", "config", "quotes");

// ---- State ----
const state = {
  user: null,
  snapshots: [],
  stocks: [],
  crypto: [],
  bonds: [],
  fxAccounts: [],
  yearly: [],
  fxRate: 5.1530,
  fxRateSource: 'manual', // 'manual' | 'live'
  fxRateChange: 0,
  monthlyDividends: {},
  dividendsYearlyGoal: 1_000_000,
  dividendsYearlyGoalYear: 2035,
  quotes: {}, // { PETR4: { price, change }, BTC: { price, change }, ... }
  lastUpdate: null,
  isRefreshing: false,
  refreshTimer: null,
};

// ---- Utils ----
const $ = (id) => document.getElementById(id);
const fmtBRL = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL0 = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtUSD = (n) => 'US$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function badgeFromTicker(t) { return t ? t.slice(0,2).toUpperCase() : '?'; }
function shortMoney(n) {
  if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n/1_000).toFixed(0) + 'k';
  return n.toFixed(0);
}
function formatDateShort(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatMaturity(date) {
  if (!date) return '—';
  try {
    const d = new Date(date);
    return d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}
function formatTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
//                      API FETCHERS
// ============================================================
async function fetchStockQuotes() {
  if (!state.stocks.length) return {};
  const tickers = [...new Set(state.stocks.map(s => s.ticker).filter(Boolean))].join(',');
  if (!tickers) return {};
  try {
    const res = await fetch(BRAPI_QUOTE(tickers));
    if (!res.ok) throw new Error(`brapi ${res.status}`);
    const data = await res.json();
    const out = {};
    (data.results || []).forEach(r => {
      out[r.symbol] = {
        price: +r.regularMarketPrice || 0,
        change: +r.regularMarketChangePercent || 0,
        name: r.longName || r.shortName || '',
      };
    });
    return out;
  } catch (err) {
    console.error('brapi stocks error:', err);
    throw err;
  }
}

async function fetchCurrencyQuote() {
  try {
    const res = await fetch(BRAPI_CURRENCY);
    if (!res.ok) throw new Error(`brapi currency ${res.status}`);
    const data = await res.json();
    const first = (data.currency && data.currency[0]) || null;
    if (!first) throw new Error('no currency data');
    return {
      rate: +first.bidPrice || +first.askPrice || 0,
      change: +first.percentageChange || 0,
    };
  } catch (err) {
    console.error('brapi currency error:', err);
    throw err;
  }
}

async function fetchCryptoQuotes() {
  if (!state.crypto.length) return {};
  const ids = [...new Set(state.crypto
    .map(c => COINGECKO_MAP[(c.symbol||'').toUpperCase()])
    .filter(Boolean))].join(',');
  if (!ids) return {};
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=brl&include_24hr_change=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const data = await res.json();
    const out = {};
    Object.entries(data).forEach(([geckoId, vals]) => {
      const symbol = Object.entries(COINGECKO_MAP).find(([_, v]) => v === geckoId)?.[0];
      if (symbol) {
        out[symbol] = {
          price: +vals.brl || 0,
          change: +vals.brl_24h_change || 0,
        };
      }
    });
    return out;
  } catch (err) {
    console.error('coingecko error:', err);
    throw err;
  }
}

// ============================================================
//                      REFRESH CONTROLLER
// ============================================================
async function refreshAllQuotes(manual = false) {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  updateRefreshUI('fetching');
  $('btnRefresh').classList.add('spinning');

  const results = { stocks: null, crypto: null, fx: null, errors: [] };

  // Stocks
  try { results.stocks = await fetchStockQuotes(); }
  catch (err) { results.errors.push('Stocks: ' + err.message); }

  // Crypto
  try { results.crypto = await fetchCryptoQuotes(); }
  catch (err) { results.errors.push('Crypto: ' + err.message); }

  // FX rate
  try { results.fx = await fetchCurrencyQuote(); }
  catch (err) { results.errors.push('FX: ' + err.message); }

  // Merge into state.quotes and save to Firestore
  const allQuotes = { ...state.quotes };
  if (results.stocks) Object.assign(allQuotes, results.stocks);
  if (results.crypto) Object.assign(allQuotes, results.crypto);

  const updateData = {
    quotes: allQuotes,
    lastUpdate: serverTimestamp(),
    updatedBy: state.user?.displayName || 'unknown',
  };
  if (results.fx && results.fx.rate > 0) {
    updateData.fxRate = results.fx.rate;
    updateData.fxRateChange = results.fx.change || 0;
    updateData.fxRateSource = 'live';
  }

  try {
    await setDoc(docQuotes, updateData, { merge: true });
    if (results.fx && results.fx.rate > 0) {
      await setDoc(docConfig, {
        fxRate: results.fx.rate,
        fxRateChange: results.fx.change || 0,
        fxRateSource: 'live',
      }, { merge: true });
    }
  } catch (err) {
    console.error('firestore quote save error:', err);
    results.errors.push('Save: ' + err.message);
  }

  state.isRefreshing = false;
  $('btnRefresh').classList.remove('spinning');

  if (results.errors.length > 0 && (!results.stocks && !results.crypto && !results.fx)) {
    updateRefreshUI('error');
    if (manual) showToast('⚠️ Refresh failed — check console');
  } else {
    updateRefreshUI('ok');
    if (manual) {
      const partial = results.errors.length > 0 ? ' (some failed)' : '';
      showToast('✓ Quotes updated' + partial);
    }
  }
}

function updateRefreshUI(status) {
  const info = $('updateInfo');
  info.classList.remove('fetching', 'error');
  if (status === 'fetching') {
    info.classList.add('fetching');
    info.textContent = 'Fetching quotes...';
  } else if (status === 'error') {
    info.classList.add('error');
    info.textContent = 'Refresh failed';
  } else {
    const t = state.lastUpdate ? formatTime(state.lastUpdate) : '—';
    info.textContent = 'Last update: ' + t;
  }
}

function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    refreshAllQuotes(false);
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
}

// ============================================================
//                      TOTALS (using live quotes)
// ============================================================
function getPriceFor(ticker) {
  const q = state.quotes[ticker];
  return q ? (+q.price || 0) : 0;
}
function getChangeFor(ticker) {
  const q = state.quotes[ticker];
  return q ? (+q.change || 0) : 0;
}

function computeTotals() {
  const stocks = state.stocks.reduce((s, x) => {
    const live = getPriceFor(x.ticker);
    const price = live > 0 ? live : (+x.avg || 0);
    return s + ((+x.qty||0) * price);
  }, 0);
  const stocksInvested = state.stocks.reduce((s, x) => s + ((+x.qty||0) * (+x.avg||0)), 0);

  // Stocks day change (weighted)
  let stocksDayValue = 0;
  state.stocks.forEach(x => {
    const live = getPriceFor(x.ticker);
    const change = getChangeFor(x.ticker);
    if (live > 0 && change !== 0) {
      const currentVal = (+x.qty||0) * live;
      const prevVal = currentVal / (1 + change/100);
      stocksDayValue += (currentVal - prevVal);
    }
  });

  const crypto = state.crypto.reduce((s, x) => {
    const live = getPriceFor((x.symbol||'').toUpperCase());
    const price = live > 0 ? live : (+x.avg || 0);
    return s + ((+x.qty||0) * price);
  }, 0);
  const cryptoInvested = state.crypto.reduce((s, x) => s + ((+x.qty||0) * (+x.avg||0)), 0);

  let cryptoDayValue = 0;
  state.crypto.forEach(x => {
    const sym = (x.symbol||'').toUpperCase();
    const live = getPriceFor(sym);
    const change = getChangeFor(sym);
    if (live > 0 && change !== 0) {
      const currentVal = (+x.qty||0) * live;
      const prevVal = currentVal / (1 + change/100);
      cryptoDayValue += (currentVal - prevVal);
    }
  });

  const fxUsd = state.fxAccounts.reduce((s, x) => s + (+x.usd||0), 0);
  const fx = fxUsd * state.fxRate;

  const fiReserve = state.bonds.filter(b => b.category === 'reserve').reduce((s,x)=>s+(+x.value||0),0);
  const fiApps = state.bonds.filter(b => b.category === 'apps').reduce((s,x)=>s+(+x.value||0),0);
  const fiKids = state.bonds.filter(b => b.category === 'kids').reduce((s,x)=>s+(+x.value||0),0);
  const fixed = fiReserve + fiApps + fiKids;

  const total = stocks + fixed + crypto + fx;
  return {
    stocks, stocksInvested, stocksDayValue,
    crypto, cryptoInvested, cryptoDayValue,
    fixed, fiReserve, fiApps, fiKids,
    fx, fxUsd, total
  };
}

// ============================================================
//                      OVERVIEW
// ============================================================
function renderOverview() {
  const t = computeTotals();
  const totalStr = t.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [intPart, centPart] = totalStr.split(',');
  $('heroAmt').textContent = intPart;
  $('heroCents').textContent = ',' + (centPart || '00');

  const pct = (v) => t.total > 0 ? ((v / t.total) * 100).toFixed(1) : '0.0';
  $('statStocks').textContent = fmtBRL(t.stocks);
  $('statStocksSub').textContent = `${state.stocks.length} holdings · ${pct(t.stocks)}%`;
  $('statFixed').textContent = fmtBRL(t.fixed);
  $('statFixedSub').textContent = `${state.bonds.length} items · ${pct(t.fixed)}%`;
  $('statCrypto').textContent = fmtBRL(t.crypto);
  $('statCryptoSub').textContent = `${state.crypto.length} coins · ${pct(t.crypto)}%`;
  $('statFx').textContent = fmtBRL(t.fx);
  $('statFxSub').textContent = `${state.fxAccounts.length} accounts · ${pct(t.fx)}%`;

  const bars = document.querySelectorAll('#allocBar i');
  if (t.total > 0) {
    bars[0].style.width = (t.stocks / t.total * 100) + '%';
    bars[1].style.width = (t.fixed / t.total * 100) + '%';
    bars[2].style.width = (t.crypto / t.total * 100) + '%';
    bars[3].style.width = (t.fx / t.total * 100) + '%';
  } else { bars.forEach(b => b.style.width = '0%'); }

  $('allocList').innerHTML = `
    <div class="alloc-row"><div class="name"><span class="dot" style="background:#0071e3"></span>Stocks · ${state.stocks.length} holdings</div><div class="v"><b>${pct(t.stocks)}%</b>${fmtBRL(t.stocks)}</div></div>
    <div class="alloc-row"><div class="name"><span class="dot" style="background:#30d158"></span>Fixed Income · ${state.bonds.length} items</div><div class="v"><b>${pct(t.fixed)}%</b>${fmtBRL(t.fixed)}</div></div>
    <div class="alloc-row"><div class="name"><span class="dot" style="background:#af52de"></span>Crypto · ${state.crypto.length} coins</div><div class="v"><b>${pct(t.crypto)}%</b>${fmtBRL(t.crypto)}</div></div>
    <div class="alloc-row"><div class="name"><span class="dot" style="background:#ff9500"></span>USD · ${state.fxAccounts.length} accounts</div><div class="v"><b>${pct(t.fx)}%</b>${fmtBRL(t.fx)}</div></div>
  `;

  renderDividendsGrowthChart();
  renderNetWorthGrowthChart();
  renderSinceLast();
  updateHeroDelta();
  checkNewYearBanner();
}

// ============================================================
//                      BAR CHART BUILDER
// ============================================================
function buildBarChart(years, values, opts = {}) {
  const W = 780, H = 280, padL = 50, padR = 20, padT = 30, padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (!years.length) {
    return `<div class="empty-chart"><div class="ico">📊</div><h4>No data yet</h4><p>Add yearly history entries to see the growth chart.</p></div>`;
  }

  const maxData = Math.max(...values, 0);
  const maxVal = opts.goal ? Math.max(maxData, opts.goal) : maxData;
  const yMax = maxVal * 1.15 || 1;

  const barSlot = innerW / years.length;
  const barWidth = Math.min(barSlot * 0.6, 32);
  const currentYearActual = new Date().getFullYear();
  const color = opts.color || '#0071e3';

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<defs>
    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity=".5"/>
    </linearGradient>
    <linearGradient id="barGradientCurrent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity=".7"/>
    </linearGradient>
  </defs>`;

  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i / 4);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#f0f0f2" stroke-width="1"/>`;
    const val = yMax * (4-i) / 4;
    svg += `<text class="axis" x="${padL - 8}" y="${y + 4}" text-anchor="end">${shortMoney(val)}</text>`;
  }

  if (opts.goal) {
    const goalY = padT + innerH - (opts.goal / yMax) * innerH;
    svg += `<line class="goal-line" x1="${padL}" y1="${goalY}" x2="${W - padR}" y2="${goalY}"/>`;
    svg += `<text class="goal-label" x="${W - padR - 4}" y="${goalY - 6}" text-anchor="end">Goal: ${shortMoney(opts.goal)}</text>`;
  }

  years.forEach((y, i) => {
    const v = values[i] || 0;
    const barH = (v / yMax) * innerH;
    const x = padL + barSlot * i + (barSlot - barWidth) / 2;
    const barY = padT + innerH - barH;
    const isCurrent = y === currentYearActual;
    const fillUrl = isCurrent ? 'url(#barGradientCurrent)' : 'url(#barGradient)';
    const cls = isCurrent ? 'bar bar-current' : 'bar';
    svg += `<rect class="${cls}" x="${x}" y="${barY}" width="${barWidth}" height="${barH}" rx="4" fill="${fillUrl}"><title>${y}: ${fmtBRL0(v)}</title></rect>`;
    svg += `<text class="axis" x="${x + barWidth/2}" y="${H - 18}" text-anchor="middle">${y}</text>`;
  });

  // Tooltip for most recent non-zero year
  let lastIdx = values.length - 1;
  while (lastIdx >= 0 && !values[lastIdx]) lastIdx--;
  if (lastIdx >= 0) {
    const lastYear = years[lastIdx];
    const lastVal = values[lastIdx];
    const barH = (lastVal / yMax) * innerH;
    const x = padL + barSlot * lastIdx + (barSlot - barWidth) / 2 + barWidth / 2;
    const tipY = padT + innerH - barH - 14;
    const labelText = `${lastYear}`;
    const valueText = fmtBRL0(lastVal);
    const textW = Math.max(labelText.length, valueText.length) * 6.5 + 20;
    const tipX = Math.max(padL + textW/2, Math.min(W - padR - textW/2, x));
    svg += `<g class="tooltip-group">
      <rect class="tooltip-bg" x="${tipX - textW/2}" y="${tipY - 26}" width="${textW}" height="32" rx="6"/>
      <text class="tooltip-text" x="${tipX}" y="${tipY - 13}" text-anchor="middle">${labelText}</text>
      <text class="tooltip-value" x="${tipX}" y="${tipY + 1}" text-anchor="middle">${valueText}</text>
    </g>`;
  }

  svg += `</svg>`;
  return `<div class="bar-chart">${svg}</div>`;
}

function renderDividendsGrowthChart() {
  const wrap = $('divChartWrap');
  const currentYear = new Date().getFullYear();
  const goalYear = state.dividendsYearlyGoalYear;
  const startYear = 2021;
  const years = [];
  for (let y = startYear; y <= goalYear; y++) years.push(y);

  const values = years.map(y => {
    const yh = state.yearly.find(r => r.year === y);
    if (yh) return +yh.divs || 0;
    if (y === currentYear) {
      let ytd = 0;
      for (let m = 1; m <= 12; m++) {
        ytd += (+state.monthlyDividends[`${y}-${String(m).padStart(2,'0')}`] || 0);
      }
      return ytd;
    }
    return 0;
  });

  wrap.innerHTML = buildBarChart(years, values, {
    goal: state.dividendsYearlyGoal,
    goalYear: goalYear,
    color: '#0071e3',
    currentYear
  });

  const yearsLeft = Math.max(0, goalYear - currentYear);
  const currentYearValue = values[years.indexOf(currentYear)] || 0;
  const progress = state.dividendsYearlyGoal > 0 ? (currentYearValue / state.dividendsYearlyGoal) * 100 : 0;
  $('divGoalPill').textContent = shortMoney(state.dividendsYearlyGoal).replace('.0','') + ' by ' + goalYear;
  $('divYearsLeft').textContent = yearsLeft + (yearsLeft === 1 ? ' year' : ' years');
  $('divProgress').textContent = progress.toFixed(1) + '%';
}

function renderNetWorthGrowthChart() {
  const wrap = $('plChartWrap');
  const currentYear = new Date().getFullYear();
  const yearsWithData = state.yearly
    .filter(y => y.equity != null)
    .sort((a, b) => a.year - b.year);

  if (yearsWithData.length === 0) {
    const t = computeTotals();
    if (t.total > 0) {
      wrap.innerHTML = buildBarChart([currentYear], [t.total], { color: '#0071e3', currentYear });
    } else {
      wrap.innerHTML = `<div class="empty-chart"><div class="ico">📈</div><h4>No net worth history yet</h4><p>Add yearly history entries to see the growth chart.</p></div>`;
    }
    $('plSinceFirst').textContent = '—';
    $('plCagr').textContent = '—';
    return;
  }

  const t = computeTotals();
  const currentYearEntry = yearsWithData.find(y => y.year === currentYear);
  let yearsArr = yearsWithData.map(y => y.year);
  let valuesArr = yearsWithData.map(y => +y.equity || 0);
  if (!currentYearEntry && t.total > 0) {
    yearsArr.push(currentYear);
    valuesArr.push(t.total);
  } else if (currentYearEntry && t.total > 0) {
    const idx = yearsArr.indexOf(currentYear);
    if (t.total > valuesArr[idx]) valuesArr[idx] = t.total;
  }

  wrap.innerHTML = buildBarChart(yearsArr, valuesArr, { color: '#0071e3', currentYear });

  const first = valuesArr[0];
  const last = valuesArr[valuesArr.length - 1];
  const yearsSpan = yearsArr[yearsArr.length - 1] - yearsArr[0];
  if (first > 0 && yearsSpan > 0) {
    const totalGrowth = ((last - first) / first) * 100;
    const cagr = (Math.pow(last / first, 1 / yearsSpan) - 1) * 100;
    $('plSinceFirst').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
    $('plCagr').textContent = cagr.toFixed(1) + '% /yr';
  } else {
    $('plSinceFirst').textContent = '—';
    $('plCagr').textContent = '—';
  }
}

function updateHeroDelta() {
  const t = computeTotals();
  const snaps = state.snapshots;
  const heroDelta = $('heroDelta');
  if (snaps.length === 0) {
    heroDelta.innerHTML = `<span class="pill flat">— No snapshots yet</span><span class="meta">Save your first snapshot to track growth</span>`;
    return;
  }
  const last = snaps[snaps.length - 1];
  const diff = t.total - last.total;
  const pct = last.total > 0 ? (diff / last.total) * 100 : 0;
  const cls = diff > 0 ? '' : (diff < 0 ? 'dn' : 'flat');
  const arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '·');
  heroDelta.innerHTML = `<span class="pill ${cls}">${arrow} ${fmtPct(pct)}</span><span class="meta">${diff>=0?'+':''}${fmtBRL(diff)} since ${formatDateShort(last.date)}</span>`;
}

function renderSinceLast() {
  const t = computeTotals();
  const snaps = state.snapshots;
  $('monthSnaps').textContent = snaps.length;
  if (snaps.length === 0) {
    $('monthChange').textContent='—'; $('monthChangePct').textContent='No previous snapshot';
    $('monthDays').textContent='—'; $('monthMeta').textContent='—';
    return;
  }
  const last = snaps[snaps.length-1];
  const diff = t.total - last.total;
  const pct = last.total > 0 ? (diff/last.total)*100 : 0;
  const days = Math.max(0, Math.floor((Date.now() - new Date(last.date).getTime()) / (1000*60*60*24)));
  const sign = diff >= 0 ? '+' : '';
  const cls = diff > 0 ? 'pos' : (diff < 0 ? 'neg' : '');
  $('monthChange').innerHTML = `<span class="${cls}">${sign}${fmtBRL(diff)}</span>`;
  $('monthChangePct').innerHTML = `<span class="${cls}">${fmtPct(pct)}</span> vs last snapshot`;
  $('monthDays').textContent = days + (days===1?' day':' days');
  $('monthMeta').textContent = formatDateShort(last.date);
}

// ============================================================
//                      STOCKS
// ============================================================
function renderStocks() {
  const t = computeTotals();
  const tbody = $('stocksBody');
  $('stockTotalInvested').textContent = fmtBRL(t.stocksInvested);
  $('stockCount').textContent = `${state.stocks.length} holding${state.stocks.length!==1?'s':''}`;
  $('stockCurrentValue').textContent = fmtBRL(t.stocks);

  // Return
  if (t.stocksInvested > 0 && t.stocks > 0) {
    const ret = t.stocks - t.stocksInvested;
    const pct = (ret / t.stocksInvested) * 100;
    const cls = ret >= 0 ? 'up' : 'dn';
    $('stockReturn').innerHTML = `<span class="${ret>=0?'pos':'neg'}">${ret>=0?'+':''}${fmtBRL(ret)}</span>`;
    $('stockReturnSub').innerHTML = `<span class="${cls}">${fmtPct(pct)}</span>`;
  } else {
    $('stockReturn').textContent = '—';
    $('stockReturnSub').textContent = 'Awaiting quotes';
  }

  // Today
  if (t.stocksDayValue !== 0) {
    const cls = t.stocksDayValue >= 0 ? 'pos' : 'neg';
    $('stockToday').innerHTML = `<span class="${cls}">${t.stocksDayValue>=0?'+':''}${fmtBRL(t.stocksDayValue)}</span>`;
    $('stockTodaySub').textContent = 'Today variation';
  } else {
    $('stockToday').textContent = '—';
    $('stockTodaySub').textContent = 'Today variation';
  }

  if (state.stocks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-table"><h4>No stocks yet</h4><p>Click "Add stock" to get started.</p></div></td></tr>`;
    return;
  }
  const sorted = [...state.stocks].sort((a,b) => {
    const aVal = (+a.qty||0) * (getPriceFor(a.ticker) || +a.avg || 0);
    const bVal = (+b.qty||0) * (getPriceFor(b.ticker) || +b.avg || 0);
    return bVal - aVal;
  });
  tbody.innerHTML = sorted.map(s => {
    const livePrice = getPriceFor(s.ticker);
    const dayChange = getChangeFor(s.ticker);
    const price = livePrice > 0 ? livePrice : 0;
    const invested = (+s.qty||0)*(+s.avg||0);
    const position = (+s.qty||0)*(price || (+s.avg||0));
    const pl = position - invested;
    const plPct = invested > 0 ? (pl/invested)*100 : 0;
    const hasPrice = price > 0;
    const dayClass = dayChange >= 0 ? '' : 'dn';
    const plClass = pl >= 0 ? 'pos' : 'neg';
    return `<tr data-id="${s.id}">
      <td><span class="ticker"><span class="badge">${badgeFromTicker(s.ticker)}</span>${s.ticker||'—'}</span></td>
      <td>${s.sector||'—'}</td>
      <td class="mono">${(+s.qty||0).toLocaleString('pt-BR')}</td>
      <td class="mono">${(+s.avg||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="mono ${hasPrice?'':'empty'}">${hasPrice?price.toLocaleString('pt-BR',{minimumFractionDigits:2}):'—'}</td>
      <td class="mono">${hasPrice && dayChange!==0 ? `<span class="chip ${dayClass}">${fmtPct(dayChange)}</span>` : '—'}</td>
      <td class="mono">${position.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
      <td class="mono ${hasPrice?'':'empty'}"><span class="${hasPrice?plClass:''}">${hasPrice?(pl>=0?'+':'')+fmtPct(plPct):'—'}</span></td>
      <td><span class="row-actions"><button>Edit</button></span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openStockModal(tr.dataset.id)));
}

// ============================================================
//                      CRYPTO
// ============================================================
function renderCrypto() {
  const t = computeTotals();
  const tbody = $('cryptoBody');
  $('cryptoTotalInvested').textContent = fmtBRL(t.cryptoInvested);
  $('cryptoCount').textContent = `${state.crypto.length} coin${state.crypto.length!==1?'s':''}`;
  $('cryptoCurrentValue').textContent = fmtBRL(t.crypto);

  if (t.cryptoInvested > 0 && t.crypto > 0) {
    const ret = t.crypto - t.cryptoInvested;
    const pct = (ret / t.cryptoInvested) * 100;
    $('cryptoReturn').innerHTML = `<span class="${ret>=0?'pos':'neg'}">${ret>=0?'+':''}${fmtBRL(ret)}</span>`;
    $('cryptoReturnSub').innerHTML = `<span class="${ret>=0?'up':'dn'}">${fmtPct(pct)}</span>`;
  } else {
    $('cryptoReturn').textContent = '—';
    $('cryptoReturnSub').textContent = 'Awaiting quotes';
  }

  if (t.cryptoDayValue !== 0) {
    const cls = t.cryptoDayValue >= 0 ? 'pos' : 'neg';
    $('cryptoToday').innerHTML = `<span class="${cls}">${t.cryptoDayValue>=0?'+':''}${fmtBRL(t.cryptoDayValue)}</span>`;
    $('cryptoTodaySub').textContent = '24h variation';
  } else {
    $('cryptoToday').textContent = '—';
    $('cryptoTodaySub').textContent = '24h variation';
  }

  if (state.crypto.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-table"><h4>No coins yet</h4><p>Click "Add coin" to get started.</p></div></td></tr>`;
    return;
  }
  const sorted = [...state.crypto].sort((a,b) => ((+b.qty||0)*(+b.avg||0)) - ((+a.qty||0)*(+a.avg||0)));
  tbody.innerHTML = sorted.map(c => {
    const sym = (c.symbol||'').toUpperCase();
    const livePrice = getPriceFor(sym);
    const dayChange = getChangeFor(sym);
    const price = livePrice > 0 ? livePrice : 0;
    const invested = (+c.qty||0)*(+c.avg||0);
    const position = (+c.qty||0)*(price || (+c.avg||0));
    const pl = position - invested;
    const plPct = invested > 0 ? (pl/invested)*100 : 0;
    const hasPrice = price > 0;
    const dayClass = dayChange >= 0 ? '' : 'dn';
    const plClass = pl >= 0 ? 'pos' : 'neg';
    return `<tr data-id="${c.id}">
      <td><span class="ticker"><span class="badge">${sym.slice(0,2) || '?'}</span>${c.name||'—'}</span></td>
      <td>${c.symbol||'—'}</td>
      <td class="mono">${(+c.qty||0).toLocaleString('pt-BR',{maximumFractionDigits:8})}</td>
      <td class="mono">${(+c.avg||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="mono ${hasPrice?'':'empty'}">${hasPrice?price.toLocaleString('pt-BR',{minimumFractionDigits:2}):'—'}</td>
      <td class="mono">${hasPrice && dayChange!==0 ? `<span class="chip ${dayClass}">${fmtPct(dayChange)}</span>` : '—'}</td>
      <td class="mono">${position.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
      <td class="mono ${hasPrice?'':'empty'}"><span class="${hasPrice?plClass:''}">${hasPrice?(pl>=0?'+':'')+fmtPct(plPct):'—'}</span></td>
      <td><span class="row-actions"><button>Edit</button></span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openCryptoModal(tr.dataset.id)));
}

// ============================================================
//                      FX
// ============================================================
function renderFx() {
  const t = computeTotals();
  const tbody = $('fxBody');
  $('fxRate').textContent = 'R$ ' + state.fxRate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  $('fxRateMeta').textContent = state.fxRateSource === 'live' ? 'Live · brapi.dev' : 'Manual rate';
  $('fxTotalUsd').textContent = fmtUSD(t.fxUsd);
  $('fxTotalBrl').textContent = fmtBRL(t.fx);
  $('fxCount').textContent = `${state.fxAccounts.length} account${state.fxAccounts.length!==1?'s':''}`;

  // Day variation for FX rate
  if (state.fxRateChange !== 0) {
    const cls = state.fxRateChange >= 0 ? 'pos' : 'neg';
    $('fxDay').innerHTML = `<span class="${cls}">${fmtPct(state.fxRateChange)}</span>`;
    $('fxDaySub').textContent = 'USD/BRL today';
  } else {
    $('fxDay').textContent = '—';
  }

  if (state.fxAccounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-table"><h4>No accounts yet</h4><p>Click "Add account" to register your USD positions.</p></div></td></tr>`;
    $('fxLargest').textContent = '—'; $('fxLargestSub').textContent = '—';
    return;
  }
  const sorted = [...state.fxAccounts].sort((a,b) => (+b.usd||0) - (+a.usd||0));
  const largest = sorted[0];
  $('fxLargest').textContent = largest.name || '—';
  $('fxLargestSub').textContent = `${fmtUSD(+largest.usd||0)} · ${t.fxUsd>0?((largest.usd/t.fxUsd)*100).toFixed(1):'0.0'}%`;

  tbody.innerHTML = sorted.map(a => {
    const usd = +a.usd || 0;
    const brl = usd * state.fxRate;
    const pct = t.fxUsd > 0 ? (usd / t.fxUsd) * 100 : 0;
    return `<tr data-id="${a.id}">
      <td><span class="ticker"><span class="badge">$</span>${a.name||'—'}</span></td>
      <td></td>
      <td class="mono">${fmtUSD(usd)}</td>
      <td class="mono">${fmtBRL(brl)}</td>
      <td class="mono">${pct.toFixed(1)}%</td>
      <td><span class="row-actions"><button>Edit</button></span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openFxModal(tr.dataset.id)));
}

// ============================================================
//                      FIXED INCOME
// ============================================================
function renderFixedIncome() {
  const t = computeTotals();
  $('fiTotal').textContent = fmtBRL(t.fixed);
  $('fiCount').textContent = `${state.bonds.length} items`;
  $('fiReserve').textContent = fmtBRL(t.fiReserve);
  $('fiApps').textContent = fmtBRL(t.fiApps);
  $('fiKids').textContent = fmtBRL(t.fiKids);

  const reserveItems = state.bonds.filter(b => b.category === 'reserve');
  const appsItems = state.bonds.filter(b => b.category === 'apps');
  const kidsItems = state.bonds.filter(b => b.category === 'kids');

  $('fiReserveSub').textContent = `${reserveItems.length} item${reserveItems.length!==1?'s':''}`;
  $('fiAppsSub').textContent = `${appsItems.length} item${appsItems.length!==1?'s':''}`;
  $('fiKidsSub').textContent = `${kidsItems.length} item${kidsItems.length!==1?'s':''}`;

  $('fiReserveTotal').textContent = fmtBRL(t.fiReserve);
  $('fiAppsTotal').textContent = fmtBRL(t.fiApps);
  $('fiKidsTotal').textContent = fmtBRL(t.fiKids);

  renderFiSection('Reserve', reserveItems);
  renderFiSection('Apps', appsItems);
  renderFiSection('Kids', kidsItems);
}

function renderFiSection(cat, items) {
  const tbody = $('fi' + cat + 'Body');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-table"><h4>No items yet</h4><p>Click "+ Add" to register the first one.</p></div></td></tr>`;
    return;
  }
  const sorted = [...items].sort((a,b) => (+b.value||0) - (+a.value||0));
  tbody.innerHTML = sorted.map(b => `
    <tr data-id="${b.id}">
      <td><span class="ticker"><span class="badge">${(b.type||'??').slice(0,2).toUpperCase()}</span>${b.name||'—'}</span></td>
      <td>${b.type||'—'}</td>
      <td>${b.yield||'—'}</td>
      <td class="mono">${formatMaturity(b.maturity)}</td>
      <td class="mono">${fmtBRL(+b.value||0)}</td>
      <td><span class="row-actions"><button>Edit</button></span></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openFiModal(tr.dataset.id)));
}

// ============================================================
//                      DIVIDENDS
// ============================================================
function renderDividends() {
  const md = state.monthlyDividends;
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  const currentMonth = new Date().getMonth() + 1;

  let ytd = 0;
  for (let m = 1; m <= 12; m++) ytd += (+md[`${currentYear}-${String(m).padStart(2,'0')}`] || 0);

  let ytdLastSamePeriod = 0;
  for (let m = 1; m <= currentMonth; m++) ytdLastSamePeriod += (+md[`${lastYear}-${String(m).padStart(2,'0')}`] || 0);

  let last12 = 0;
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    last12 += (+md[k] || 0);
  }

  let allTime = 0;
  Object.values(md).forEach(v => allTime += (+v || 0));
  state.yearly.forEach(y => {
    const hasMonthly = Object.keys(md).some(k => k.startsWith(y.year + '-'));
    if (!hasMonthly) allTime += (+y.divs || 0);
  });

  let bestKey = null, bestVal = 0;
  Object.entries(md).forEach(([k,v]) => { if ((+v||0) > bestVal) { bestVal = +v; bestKey = k; } });

  $('divHeroYear').textContent = currentYear;
  $('divHeroAmt').textContent = ytd.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const avg = currentMonth > 0 ? ytd / currentMonth : 0;
  $('divHeroAvg').textContent = `${fmtBRL0(avg)} / month average`;

  if (ytdLastSamePeriod > 0) {
    const vsPct = ((ytd - ytdLastSamePeriod) / ytdLastSamePeriod) * 100;
    const arrow = vsPct >= 0 ? '↑' : '↓';
    $('divHeroVs').className = 'vs ' + (vsPct >= 0 ? '' : 'dn');
    $('divHeroVs').innerHTML = `${arrow} ${vsPct >= 0 ? '+' : ''}${vsPct.toFixed(1)}%`;
  } else {
    $('divHeroVs').textContent = '—';
  }

  $('divLast12').textContent = fmtBRL0(last12);
  $('divLast12Sub').textContent = `Across last 12 months`;
  $('divAvg').textContent = fmtBRL0(last12 / 12);
  $('divAll').textContent = fmtBRL0(allTime);
  $('divAllSub').textContent = `Monthly + yearly combined`;

  if (bestKey) {
    const [yy, mm] = bestKey.split('-');
    $('divBest').textContent = fmtBRL0(bestVal);
    $('divBestSub').textContent = `${MONTHS[parseInt(mm)-1]} ${yy}`;
  } else {
    $('divBest').textContent = '—'; $('divBestSub').textContent = '—';
  }

  renderMonthInputs();
  renderYearlyTable();
  renderDividendsGrowthChart();
  renderNetWorthGrowthChart();
}

function renderMonthInputs() {
  const md = state.monthlyDividends;
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];
  const thead = `<thead><tr><th>Month</th>${years.map(y => `<th>${y}</th>`).join('')}</tr></thead><tbody>`;
  let rows = '';
  const totals = {}; years.forEach(y => totals[y] = 0);
  for (let m = 0; m < 12; m++) {
    const mm = String(m+1).padStart(2,'0');
    rows += `<tr><td>${MONTHS[m]}</td>`;
    years.forEach(y => {
      const k = `${y}-${mm}`;
      const v = +md[k] || 0;
      totals[y] += v;
      rows += `<td><input type="number" data-key="${k}" value="${v||''}" placeholder="—" step="0.01" min="0" /></td>`;
    });
    rows += `</tr>`;
  }
  rows += `<tr class="total"><td>Total</td>${years.map(y => `<td>${fmtBRL0(totals[y])}</td>`).join('')}</tr>`;
  rows += `</tbody>`;
  $('monthInputTable').innerHTML = thead + rows;

  $('monthInputTable').querySelectorAll('input[data-key]').forEach(inp => {
    let timer = null;
    inp.addEventListener('input', () => {
      inp.classList.remove('saved');
      inp.classList.add('saving');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => saveMonthlyDividend(inp.dataset.key, inp.value, inp), 600);
    });
  });
}

async function saveMonthlyDividend(key, value, inp) {
  const v = parseFloat(value) || 0;
  state.monthlyDividends[key] = v;
  try {
    await setDoc(docDividends, { monthly: state.monthlyDividends }, { merge: true });
    inp.classList.remove('saving');
    inp.classList.add('saved');
    setTimeout(() => inp.classList.remove('saved'), 1200);
    renderDividends();
    renderOverview();
  } catch (err) { console.error(err); showToast('Error saving'); }
}

function renderYearlyTable() {
  const tbody = $('yearlyBody');
  const sorted = [...state.yearly].sort((a,b) => (a.year||0) - (b.year||0));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-table"><h4>No yearly data</h4><p>Click "Add year" to start tracking.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map((y, i) => {
    const dy = (+y.equity > 0) ? ((+y.divs / +y.equity) * 100).toFixed(2) + '%' : '—';
    let yoy = '—';
    if (i > 0) {
      const prev = +sorted[i-1].divs || 0;
      if (prev > 0) {
        const growth = (((+y.divs || 0) - prev) / prev) * 100;
        yoy = (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%';
      }
    }
    return `<tr data-id="${y.id}"><td>${y.year}</td><td>${fmtBRL0(+y.equity||0)}</td><td>${fmtBRL0(+y.divs||0)}</td><td>${dy}</td><td>${yoy}</td></tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openYearlyModal(tr.dataset.id)));
}

// ============================================================
//                      NEW YEAR BANNER & MODAL
// ============================================================
function checkNewYearBanner() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // Show banner from November onwards OR if in new year without closure
  const prevYear = currentYear - 1;
  const hasPrevYearEntry = state.yearly.some(y => y.year === prevYear);
  const hasCurrentYearEntry = state.yearly.some(y => y.year === currentYear);

  let show = false;
  let titleText = '';
  let subText = '';

  if (month >= 11 && !hasCurrentYearEntry) {
    // Nov/Dec of current year — offer to close current year
    show = true;
    titleText = `Ready to close ${currentYear}?`;
    subText = `The year is ending. Click to lock in ${currentYear}'s totals and start the new year.`;
  } else if (!hasPrevYearEntry && month <= 6) {
    // Jan-Jun of new year, prev year not closed yet
    show = true;
    titleText = `${prevYear} is not closed yet`;
    subText = `The previous year still needs to be locked into your yearly history. Click to close it.`;
  }

  const banner = $('newYearBanner');
  if (show) {
    $('newYearTitle').textContent = titleText;
    $('newYearSub').textContent = subText;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

function openNewYearModal() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;

  // Determine which year to close
  const prevYear = currentYear - 1;
  const hasPrevYearEntry = state.yearly.some(y => y.year === prevYear);
  const yearToClose = (month >= 11) ? currentYear : (hasPrevYearEntry ? currentYear : prevYear);

  // Pre-fill equity: current total net worth
  const t = computeTotals();
  const equity = t.total;

  // Pre-fill dividends: sum of monthly entries for that year
  let divs = 0;
  for (let m = 1; m <= 12; m++) {
    divs += (+state.monthlyDividends[`${yearToClose}-${String(m).padStart(2,'0')}`] || 0);
  }

  $('newYearModalTitle').textContent = `Close ${yearToClose}`;
  $('nyYear').value = yearToClose;
  $('nyEquity').value = equity.toFixed(2);
  $('nyDivs').value = divs.toFixed(2);

  $('newYearModal').classList.add('show');
}

function closeNewYearModal() { $('newYearModal').classList.remove('show'); }

async function confirmNewYear() {
  const year = parseInt($('nyYear').value);
  const equity = parseFloat($('nyEquity').value);
  const divs = parseFloat($('nyDivs').value);
  if (!year) { showToast('Year required'); return; }
  if (isNaN(equity) || isNaN(divs)) { showToast('Valid values required'); return; }

  const existing = state.yearly.find(y => y.year === year);
  const btn = $('nyConfirm');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (existing) {
      await setDoc(docYearly(existing.id), { year, equity, divs, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      await addDoc(colYearly(), { year, equity, divs, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    showToast(`✓ ${year} closed`);
    closeNewYearModal();
  } catch (err) { console.error(err); showToast('Error closing year'); }
  finally { btn.disabled = false; btn.textContent = 'Close year'; }
}

// ============================================================
//                      MODALS — STOCK
// ============================================================
let editingStockId = null;
function openStockModal(id = null) {
  editingStockId = id;
  if (id) {
    const s = state.stocks.find(x => x.id === id); if (!s) return;
    $('stockModalTitle').textContent = 'Edit stock';
    $('stockTicker').value = s.ticker || ''; $('stockSector').value = s.sector || '';
    $('stockQty').value = s.qty || ''; $('stockAvg').value = s.avg || '';
    $('stockDelete').style.display = '';
  } else {
    $('stockModalTitle').textContent = 'Add stock';
    $('stockTicker').value = ''; $('stockSector').value = '';
    $('stockQty').value = ''; $('stockAvg').value = '';
    $('stockDelete').style.display = 'none';
  }
  $('stockModal').classList.add('show');
  setTimeout(() => $('stockTicker').focus(), 50);
}
function closeStockModal() { $('stockModal').classList.remove('show'); editingStockId = null; }

async function saveStock() {
  const ticker = $('stockTicker').value.trim().toUpperCase();
  const sector = $('stockSector').value;
  const qty = parseFloat($('stockQty').value);
  const avg = parseFloat($('stockAvg').value);
  if (!ticker) { showToast('Ticker is required'); return; }
  if (!qty || qty <= 0) { showToast('Quantity must be > 0'); return; }
  if (!avg || avg < 0) { showToast('Average price required'); return; }
  const data = { ticker, sector: sector || 'Other', qty, avg, updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'unknown' };
  const btn = $('stockSave');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (editingStockId) { await setDoc(docStock(editingStockId), data, { merge: true }); showToast('✓ Stock updated'); }
    else { await addDoc(colStocks(), { ...data, createdAt: serverTimestamp() }); showToast('✓ Stock added'); }
    closeStockModal();
    // Refresh quotes for new ticker
    setTimeout(() => refreshAllQuotes(false), 500);
  } catch (err) { console.error(err); showToast('Error saving'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function deleteStock() {
  if (!editingStockId) return;
  if (!confirm('Delete this stock? This cannot be undone.')) return;
  try { await deleteDoc(docStock(editingStockId)); showToast('✓ Stock removed'); closeStockModal(); }
  catch (err) { console.error(err); showToast('Error deleting'); }
}

// ============================================================
//                      MODALS — CRYPTO
// ============================================================
let editingCryptoId = null;
function openCryptoModal(id = null) {
  editingCryptoId = id;
  if (id) {
    const c = state.crypto.find(x => x.id === id); if (!c) return;
    $('cryptoModalTitle').textContent = 'Edit coin';
    $('cryptoName').value = c.name || ''; $('cryptoSymbol').value = c.symbol || '';
    $('cryptoQty').value = c.qty || ''; $('cryptoAvg').value = c.avg || '';
    $('cryptoDelete').style.display = '';
  } else {
    $('cryptoModalTitle').textContent = 'Add coin';
    $('cryptoName').value = ''; $('cryptoSymbol').value = '';
    $('cryptoQty').value = ''; $('cryptoAvg').value = '';
    $('cryptoDelete').style.display = 'none';
  }
  $('cryptoModal').classList.add('show');
  setTimeout(() => $('cryptoName').focus(), 50);
}
function closeCryptoModal() { $('cryptoModal').classList.remove('show'); editingCryptoId = null; }

async function saveCrypto() {
  const name = $('cryptoName').value.trim();
  const symbol = $('cryptoSymbol').value.trim().toUpperCase();
  const qty = parseFloat($('cryptoQty').value);
  const avg = parseFloat($('cryptoAvg').value);
  if (!name) { showToast('Coin name required'); return; }
  if (!symbol) { showToast('Symbol required'); return; }
  if (!qty || qty <= 0) { showToast('Quantity must be > 0'); return; }
  if (!avg || avg < 0) { showToast('Average price required'); return; }
  const data = { name, symbol, qty, avg, updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'unknown' };
  const btn = $('cryptoSave');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (editingCryptoId) { await setDoc(docCrypto(editingCryptoId), data, { merge: true }); showToast('✓ Coin updated'); }
    else { await addDoc(colCrypto(), { ...data, createdAt: serverTimestamp() }); showToast('✓ Coin added'); }
    closeCryptoModal();
    setTimeout(() => refreshAllQuotes(false), 500);
  } catch (err) { console.error(err); showToast('Error saving'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function deleteCrypto() {
  if (!editingCryptoId) return;
  if (!confirm('Delete this coin? This cannot be undone.')) return;
  try { await deleteDoc(docCrypto(editingCryptoId)); showToast('✓ Coin removed'); closeCryptoModal(); }
  catch (err) { console.error(err); showToast('Error deleting'); }
}

// ============================================================
//                      MODALS — FX
// ============================================================
let editingFxId = null;
function openFxModal(id = null) {
  editingFxId = id;
  if (id) {
    const a = state.fxAccounts.find(x => x.id === id); if (!a) return;
    $('fxModalTitle').textContent = 'Edit account';
    $('fxName').value = a.name || ''; $('fxUsd').value = a.usd || '';
    $('fxDelete').style.display = '';
  } else {
    $('fxModalTitle').textContent = 'Add account';
    $('fxName').value = ''; $('fxUsd').value = '';
    $('fxDelete').style.display = 'none';
  }
  updateFxBrlPreview();
  $('fxModal').classList.add('show');
  setTimeout(() => $('fxName').focus(), 50);
}
function closeFxModal() { $('fxModal').classList.remove('show'); editingFxId = null; }
function updateFxBrlPreview() {
  const usd = parseFloat($('fxUsd').value) || 0;
  $('fxBrlPreview').textContent = 'BRL: ' + fmtBRL(usd * state.fxRate);
}
async function saveFx() {
  const name = $('fxName').value.trim();
  const usd = parseFloat($('fxUsd').value);
  if (!name) { showToast('Account name required'); return; }
  if (isNaN(usd) || usd < 0) { showToast('Valid USD amount required'); return; }
  const data = { name, usd, updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'unknown' };
  const btn = $('fxSave');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (editingFxId) { await setDoc(docFx(editingFxId), data, { merge: true }); showToast('✓ Account updated'); }
    else { await addDoc(colFx(), { ...data, createdAt: serverTimestamp() }); showToast('✓ Account added'); }
    closeFxModal();
  } catch (err) { console.error(err); showToast('Error saving'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}
async function deleteFx() {
  if (!editingFxId) return;
  if (!confirm('Delete this account? This cannot be undone.')) return;
  try { await deleteDoc(docFx(editingFxId)); showToast('✓ Account removed'); closeFxModal(); }
  catch (err) { console.error(err); showToast('Error deleting'); }
}

// ============================================================
//                      MODAL — RATE
// ============================================================
function openRateModal() {
  $('rateInput').value = state.fxRate;
  $('rateModal').classList.add('show');
  setTimeout(() => $('rateInput').focus(), 50);
}
function closeRateModal() { $('rateModal').classList.remove('show'); }
async function saveRate() {
  const r = parseFloat($('rateInput').value);
  if (!r || r <= 0) { showToast('Invalid rate'); return; }
  try {
    await setDoc(docConfig, { fxRate: r, fxRateSource: 'manual' }, { merge: true });
    showToast('✓ Rate updated');
    closeRateModal();
  } catch (err) { console.error(err); showToast('Error saving'); }
}

// ============================================================
//                      MODAL — YEARLY
// ============================================================
let editingYearlyId = null;
function openYearlyModal(id = null) {
  editingYearlyId = id;
  if (id) {
    const y = state.yearly.find(x => x.id === id); if (!y) return;
    $('yearlyModalTitle').textContent = 'Edit year';
    $('yearlyYear').value = y.year || ''; $('yearlyEquity').value = y.equity || ''; $('yearlyDivs').value = y.divs || '';
    $('yearlyDelete').style.display = '';
  } else {
    $('yearlyModalTitle').textContent = 'Add year';
    $('yearlyYear').value = ''; $('yearlyEquity').value = ''; $('yearlyDivs').value = '';
    $('yearlyDelete').style.display = 'none';
  }
  $('yearlyModal').classList.add('show');
  setTimeout(() => $('yearlyYear').focus(), 50);
}
function closeYearlyModal() { $('yearlyModal').classList.remove('show'); editingYearlyId = null; }
async function saveYearly() {
  const year = parseInt($('yearlyYear').value);
  const equity = parseFloat($('yearlyEquity').value);
  const divs = parseFloat($('yearlyDivs').value);
  if (!year) { showToast('Year required'); return; }
  if (isNaN(equity)) { showToast('Equity required'); return; }
  if (isNaN(divs)) { showToast('Dividends required'); return; }
  const data = { year, equity, divs, updatedAt: serverTimestamp() };
  const btn = $('yearlySave');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (editingYearlyId) { await setDoc(docYearly(editingYearlyId), data, { merge: true }); showToast('✓ Year updated'); }
    else { await addDoc(colYearly(), { ...data, createdAt: serverTimestamp() }); showToast('✓ Year added'); }
    closeYearlyModal();
  } catch (err) { console.error(err); showToast('Error saving'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}
async function deleteYearly() {
  if (!editingYearlyId) return;
  if (!confirm('Delete this year? This cannot be undone.')) return;
  try { await deleteDoc(docYearly(editingYearlyId)); showToast('✓ Year removed'); closeYearlyModal(); }
  catch (err) { console.error(err); showToast('Error deleting'); }
}

// ============================================================
//                      MODAL — FIXED INCOME
// ============================================================
let editingFiId = null;
let editingFiCategory = null;
function openFiModal(id = null, category = null) {
  editingFiId = id;
  editingFiCategory = category;
  if (id) {
    const b = state.bonds.find(x => x.id === id); if (!b) return;
    editingFiCategory = b.category;
    const catLabels = { reserve: 'Emergency reserve', apps: 'Application', kids: 'Kids portfolio' };
    $('fiModalTitle').textContent = `Edit ${catLabels[b.category] || 'item'}`;
    $('fiName').value = b.name || '';
    $('fiType').value = b.type || '';
    $('fiYield').value = b.yield || '';
    $('fiMaturity').value = b.maturity || '';
    $('fiValue').value = b.value || '';
    $('fiDelete').style.display = '';
  } else {
    const catLabels = { reserve: 'Add to Emergency Reserve', apps: 'Add to Applications', kids: 'Add to Kids portfolio' };
    $('fiModalTitle').textContent = catLabels[category] || 'Add fixed income';
    $('fiName').value = ''; $('fiType').value = ''; $('fiYield').value = '';
    $('fiMaturity').value = ''; $('fiValue').value = '';
    $('fiDelete').style.display = 'none';
  }
  $('fiModal').classList.add('show');
  setTimeout(() => $('fiName').focus(), 50);
}
function closeFiModal() { $('fiModal').classList.remove('show'); editingFiId = null; editingFiCategory = null; }

async function saveFi() {
  const name = $('fiName').value.trim();
  const type = $('fiType').value;
  const yieldText = $('fiYield').value.trim();
  const maturity = $('fiMaturity').value;
  const value = parseFloat($('fiValue').value);
  if (!name) { showToast('Product name required'); return; }
  if (isNaN(value) || value < 0) { showToast('Valid value required'); return; }
  if (!editingFiCategory) { showToast('Category missing'); return; }
  const data = {
    name, type: type || 'Outro', yield: yieldText, maturity, value,
    category: editingFiCategory,
    updatedAt: serverTimestamp(),
    updatedBy: state.user?.displayName || 'unknown'
  };
  const btn = $('fiSave');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    if (editingFiId) { await setDoc(docFixed(editingFiId), data, { merge: true }); showToast('✓ Item updated'); }
    else { await addDoc(colFixed(), { ...data, createdAt: serverTimestamp() }); showToast('✓ Item added'); }
    closeFiModal();
  } catch (err) { console.error(err); showToast('Error saving'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function deleteFi() {
  if (!editingFiId) return;
  if (!confirm('Delete this item? This cannot be undone.')) return;
  try { await deleteDoc(docFixed(editingFiId)); showToast('✓ Item removed'); closeFiModal(); }
  catch (err) { console.error(err); showToast('Error deleting'); }
}

// ============================================================
//                      MODAL — SNAPSHOT
// ============================================================
function openSnapshotModal() {
  const t = computeTotals();
  $('snapSummary').innerHTML = `
    <div class="snap-row"><span class="l">Stocks</span><span class="v">${fmtBRL(t.stocks)}</span></div>
    <div class="snap-row"><span class="l">Fixed Income</span><span class="v">${fmtBRL(t.fixed)}</span></div>
    <div class="snap-row"><span class="l">Crypto</span><span class="v">${fmtBRL(t.crypto)}</span></div>
    <div class="snap-row"><span class="l">USD</span><span class="v">${fmtBRL(t.fx)}</span></div>
    <div class="snap-row total"><span class="l">Total</span><span class="v">${fmtBRL(t.total)}</span></div>
  `;
  $('snapshotModal').classList.add('show');
}
function closeSnapshotModal() { $('snapshotModal').classList.remove('show'); }

async function saveSnapshot() {
  const t = computeTotals();
  const btn = $('snapConfirm');
  try {
    btn.disabled = true; btn.textContent = 'Saving...';
    await addDoc(colSnapshots(), {
      date: serverTimestamp(),
      stocks: t.stocks, fixed: t.fixed, crypto: t.crypto, fx: t.fx, total: t.total,
      savedBy: state.user?.displayName || 'unknown'
    });
    closeSnapshotModal();
    showToast('✓ Snapshot saved');
  } catch (err) { console.error(err); showToast('Error saving snapshot'); }
  finally { btn.disabled = false; btn.textContent = 'Save snapshot'; }
}

// ============================================================
//                      EVENTS
// ============================================================
$('btnSnapshot').addEventListener('click', openSnapshotModal);
$('snapCancel').addEventListener('click', closeSnapshotModal);
$('snapConfirm').addEventListener('click', saveSnapshot);
$('snapshotModal').addEventListener('click', e => { if (e.target.id === 'snapshotModal') closeSnapshotModal(); });

$('btnAddStock').addEventListener('click', () => openStockModal());
$('stockCancel').addEventListener('click', closeStockModal);
$('stockSave').addEventListener('click', saveStock);
$('stockDelete').addEventListener('click', deleteStock);
$('stockModal').addEventListener('click', e => { if (e.target.id === 'stockModal') closeStockModal(); });

$('btnAddCrypto').addEventListener('click', () => openCryptoModal());
$('cryptoCancel').addEventListener('click', closeCryptoModal);
$('cryptoSave').addEventListener('click', saveCrypto);
$('cryptoDelete').addEventListener('click', deleteCrypto);
$('cryptoModal').addEventListener('click', e => { if (e.target.id === 'cryptoModal') closeCryptoModal(); });

$('btnAddFx').addEventListener('click', () => openFxModal());
$('fxCancel').addEventListener('click', closeFxModal);
$('fxSave').addEventListener('click', saveFx);
$('fxDelete').addEventListener('click', deleteFx);
$('fxUsd').addEventListener('input', updateFxBrlPreview);
$('fxModal').addEventListener('click', e => { if (e.target.id === 'fxModal') closeFxModal(); });

$('btnEditRate').addEventListener('click', openRateModal);
$('rateCancel').addEventListener('click', closeRateModal);
$('rateSave').addEventListener('click', saveRate);
$('rateModal').addEventListener('click', e => { if (e.target.id === 'rateModal') closeRateModal(); });

$('btnAddYear').addEventListener('click', () => openYearlyModal());
$('yearlyCancel').addEventListener('click', closeYearlyModal);
$('yearlySave').addEventListener('click', saveYearly);
$('yearlyDelete').addEventListener('click', deleteYearly);
$('yearlyModal').addEventListener('click', e => { if (e.target.id === 'yearlyModal') closeYearlyModal(); });

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => openFiModal(null, btn.dataset.add));
});
$('fiCancel').addEventListener('click', closeFiModal);
$('fiSave').addEventListener('click', saveFi);
$('fiDelete').addEventListener('click', deleteFi);
$('fiModal').addEventListener('click', e => { if (e.target.id === 'fiModal') closeFiModal(); });

$('btnStartNewYear').addEventListener('click', openNewYearModal);
$('nyCancel').addEventListener('click', closeNewYearModal);
$('nyConfirm').addEventListener('click', confirmNewYear);
$('newYearModal').addEventListener('click', e => { if (e.target.id === 'newYearModal') closeNewYearModal(); });

$('btnRefresh').addEventListener('click', () => refreshAllQuotes(true));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSnapshotModal(); closeStockModal(); closeCryptoModal();
    closeFxModal(); closeRateModal(); closeYearlyModal();
    closeFiModal(); closeNewYearModal();
  }
});

// ============================================================
//                      FIRESTORE SUBSCRIPTIONS
// ============================================================
let unsub = {};
function subscribeAll() {
  unsub.snapshots = onSnapshot(query(colSnapshots(), orderBy('date','asc')), (snap) => {
    state.snapshots = snap.docs.map(d => { const data = d.data(); return { id: d.id, ...data, date: data.date?.toDate?.() || new Date() }; });
    renderOverview();
  });
  unsub.stocks = onSnapshot(colStocks(), (snap) => {
    state.stocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStocks(); renderOverview();
  });
  unsub.crypto = onSnapshot(colCrypto(), (snap) => {
    state.crypto = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCrypto(); renderOverview();
  });
  unsub.fx = onSnapshot(colFx(), (snap) => {
    state.fxAccounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFx(); renderOverview();
  });
  unsub.fixed = onSnapshot(colFixed(), (snap) => {
    state.bonds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFixedIncome(); renderOverview();
  });
  unsub.yearly = onSnapshot(colYearly(), (snap) => {
    state.yearly = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderYearlyTable();
    renderDividends();
    renderOverview();
  });
  unsub.config = onSnapshot(docConfig, (snap) => {
    const data = snap.data() || {};
    if (typeof data.fxRate === 'number') state.fxRate = data.fxRate;
    if (typeof data.fxRateChange === 'number') state.fxRateChange = data.fxRateChange;
    if (typeof data.fxRateSource === 'string') state.fxRateSource = data.fxRateSource;
    if (typeof data.dividendsYearlyGoal === 'number') state.dividendsYearlyGoal = data.dividendsYearlyGoal;
    if (typeof data.dividendsYearlyGoalYear === 'number') state.dividendsYearlyGoalYear = data.dividendsYearlyGoalYear;
    renderFx(); renderOverview();
  });
  unsub.dividends = onSnapshot(docDividends, (snap) => {
    const data = snap.data() || {};
    if (data.monthly) state.monthlyDividends = data.monthly;
    renderDividends();
  });
  unsub.quotes = onSnapshot(docQuotes, (snap) => {
    const data = snap.data() || {};
    if (data.quotes) state.quotes = data.quotes;
    if (data.lastUpdate) {
      state.lastUpdate = data.lastUpdate.toDate?.() || new Date(data.lastUpdate);
      updateRefreshUI('ok');
    }
    renderStocks(); renderCrypto(); renderOverview();
  });
}
function unsubscribeAll() { Object.values(unsub).forEach(fn => fn && fn()); unsub = {}; }

// ============================================================
//                      AUTH & TABS
// ============================================================
$('btnLogin').addEventListener('click', async () => {
  $('loginError').classList.remove('show');
  $('btnLoginText').textContent = 'Signing in...';
  try { await signInWithPopup(auth, provider); }
  catch (err) {
    console.error(err);
    $('loginError').textContent = 'Sign in failed: ' + (err.message || err.code);
    $('loginError').classList.add('show');
    $('btnLoginText').textContent = 'Sign in with Google';
  }
});
$('btnLogout').addEventListener('click', async () => { unsubscribeAll(); stopAutoRefresh(); await signOut(auth); });
$('btnCopyUid').addEventListener('click', () => {
  const uid = $('uidDisplay').textContent;
  if (!uid || uid === '—') return;
  navigator.clipboard.writeText(uid).then(() => {
    const b = $('btnCopyUid');
    b.textContent = '✓ Copied'; b.classList.add('copied');
    setTimeout(() => { b.textContent = 'Copy UID'; b.classList.remove('copied'); }, 2000);
  });
});
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    t.classList.add('active');
    $(t.dataset.tab).classList.add('active');
  });
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.user = user;
    $('loginScreen').classList.add('hide');
    $('app').classList.add('show');
    $('userName').textContent = user.displayName || user.email;
    if (user.photoURL) $('userPhoto').src = user.photoURL;
    $('uidDisplay').textContent = user.uid;
    try {
      await setDoc(doc(db, 'household', 'main', 'meta', 'connection'), {
        lastSeenBy: user.displayName || user.email, lastSeenAt: serverTimestamp(), uid: user.uid
      }, { merge: true });
      subscribeAll();
      renderOverview(); renderStocks(); renderCrypto(); renderFx();
      renderFixedIncome(); renderDividends();

      // Initial quote fetch after subscriptions warm up
      setTimeout(() => refreshAllQuotes(false), 1500);
      startAutoRefresh();
    } catch (err) {
      console.error('Firestore error:', err);
    }
  } else {
    state.user = null;
    unsubscribeAll();
    stopAutoRefresh();
    $('loginScreen').classList.remove('hide');
    $('app').classList.remove('show');
    $('btnLoginText').textContent = 'Sign in with Google';
  }
});
