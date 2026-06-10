// ============================================================
//  LEDGER - Personal Finance (app.js)
//  Modules: Expenses + Investments (I10 link)
// ============================================================
import { app, auth, db, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from "./firebase.js";
import { I18N } from "./i18n.js";
import { ICONS, CATEGORIES, INCOME_SOURCES, INCOME_OPTS, MONTH_NAMES_PT, MONTH_NAMES_EN } from "./constants.js";
import { IMP_GATEWAY, IMP_UF, IMP_STOP, impNormalize, impTokens, impRuleKey, impToISO, impFp, parseBRMoney } from "./import-core.js";
import { projectMonth as projectRecurring, toYM, ymOf } from "./recurring-core.js";

// ============================================================
//  EARLY AUTH GUARD - login works even if main code crashes
// ============================================================
let _mainAuthRegistered = false;
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('[early-auth] User logged in:', user.email);
    setTimeout(() => {
      if (!_mainAuthRegistered) {
        console.warn('[early-auth] Main auth did not register - reloading');
        location.reload();
      }
    }, 2000);
  }
});

const provider = new GoogleAuthProvider();

// ---- Paths ----
const colExpenses = () => collection(db, "household", "main", "expenses");
const colYearly   = () => collection(db, "household", "main", "dividendsYearly");
const colContrib  = () => collection(db, "household", "main", "contributions");
const colRecurring = () => collection(db, "household", "main", "recurring");   // templates de despesa fixa
const docRecurring = (id) => doc(db, "household", "main", "recurring", id);
const docExpense  = (id) => doc(db, "household", "main", "expenses", id);
const docYearly   = (id) => doc(db, "household", "main", "dividendsYearly", id);
const docConfig   = doc(db, "household", "main", "config", "settings");
const docI10      = doc(db, "household", "main", "config", "i10");
const docI10Louise = doc(db, "household", "main", "config", "i10-louise");
const docFx = doc(db, "household", "main", "config", "fx");
const docI10Cfg   = doc(db, "household", "main", "config", "i10sync");
const docReserves = doc(db, "household", "main", "config", "reserves");
const docPension  = doc(db, "household", "main", "config", "pension");
const docShareGoals = doc(db, "household", "main", "config", "shareGoals");
const docBudgets  = doc(db, "household", "main", "config", "budgets");
const docCategories = doc(db, "household", "main", "config", "categories");
const docImportMeta = doc(db, "household", "main", "config", "importMeta");
const docUserPrefs = doc(db, "household", "main", "config", "userPrefs");
const docImportRules = doc(db, "household", "main", "config", "importRules");  // memória do importador (estabelecimento → categoria/de-quem)

// Known primary account → defaults to Investments on first login.
// Any other UID defaults to Expenses (household spouse use case).
const KNOWN_PRIMARY_EMAIL = 'williamscchulz@gmail.com';

// ---- Constants ----
// Inline SVG icon registry (Lucide-style: stroke currentColor, 24x24 viewBox,
// round caps/joins). Keeping them as strings here avoids a separate fetch
// and lets us interpolate straight into innerHTML. Each icon is wrapped so
// renderers can do `${meta.icon}` exactly like before (now producing SVG
// instead of an emoji glyph).
// _svg() helper foi pra constants.js (só ICONS usa).
// --- Categorias customizáveis (config/categories) -------------------------
// CATEGORIES é lido em ~12 lugares. Em vez de trocar todos os call-sites,
// guardamos um snapshot dos defaults e MUTAMOS CATEGORIES in-place quando o
// usuário edita/cria categorias — todo render pega o merge de graça.
const DEFAULT_CATEGORIES = {};
Object.entries(CATEGORIES).forEach(([k, v]) => { DEFAULT_CATEGORIES[k] = { ...v }; });
const DEFAULT_CAT_KEYS = Object.keys(CATEGORIES);
const CAT_PALETTE = ['#0071e3', '#30d158', '#ff9500', '#ff375f', '#af52de', '#64d2ff', '#bf5af2', '#ff453a', '#ffd60a', '#8e8e93', '#c7f73e', '#d8fa72'];
const CAT_ICON_KEYS = ['tag', 'home', 'utensils', 'cart', 'car', 'plane', 'heartPulse', 'gamepad', 'book', 'repeat', 'creditCard', 'shoppingBag', 'package', 'briefcase', 'wrench', 'pieChart', 'trendingUp', 'gift'];
function applyCategoryConfig(cfg) {
  cfg = cfg || {};
  // 1. reset ao default (tira custom antigas, restaura label/cor padrão)
  Object.keys(CATEGORIES).forEach(k => { if (!DEFAULT_CAT_KEYS.includes(k)) delete CATEGORIES[k]; });
  DEFAULT_CAT_KEYS.forEach(k => {
    CATEGORIES[k] = { ...DEFAULT_CATEGORIES[k] };
    const tl = t('cat.label.' + k);                       // traduz o label padrão pelo idioma atual
    if (tl && tl !== 'cat.label.' + k) CATEGORIES[k].label = tl;
  });
  // 2. overrides (renome/recolor das padrão)
  const ov = cfg.overrides || {};
  Object.entries(ov).forEach(([k, v]) => { if (CATEGORIES[k] && v) { if (v.label) CATEGORIES[k].label = v.label; if (v.color) CATEGORIES[k].color = v.color; } });
  // 3. categorias novas (custom) — nunca sobrescreve 'outros' (fallback)
  const cu = cfg.custom || {};
  Object.entries(cu).forEach(([k, v]) => {
    if (!v || DEFAULT_CAT_KEYS.includes(k)) return;
    const ik = ICONS[v.icon] ? v.icon : 'tag';
    CATEGORIES[k] = { label: v.label || k, color: v.color || '#8e8e93', icon: ICONS[ik], iconKey: ik, custom: true };
  });
}
// Categorias em ordem ALFABÉTICA (por label) — usado em todo seletor de categoria do app.
const catsAZ = () => Object.entries(CATEGORIES).sort((a, b) => String(a[1].label).localeCompare(String(b[1].label), 'pt', { sensitivity: 'base' }));
// Repovoa o <select> de categoria do modal de despesa a partir do CATEGORIES vivo.
function populateCategorySelect() {
  const sel = $('expCategory');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = catsAZ().map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');
  if (cur && CATEGORIES[cur]) sel.value = cur;
}
// Income sources (labels resolved via i18n at render time)

// ---- State ----
const state = {
  user: null,
  mode: 'investments',          // 'expenses' | 'investments'
  expenses: [],
  recurring: [],   // templates de despesa fixa/recorrente (projetados, nunca duplicados)
  yearly: [],
  i10: { equity: 0, dividends: 0, updatedAt: null, year: new Date().getFullYear(), assets: [], categories: [], monthly: [] },
  contributions: [],
  i10Cfg: { workerUrl: '', walletId: '', publicHash: '', autoSync: false },
  i10Louise: { equity: 0, dividends: 0, applied: 0, variation: 0, updatedAt: null },
  i10LouiseCfg: { walletId: '2699282' },
  fx: { usd: 0, rateUSD: 0, rateUpdatedAt: null, rateSource: '', note: '' },
  reserves: { accounts: [], loaded: false, editingId: null },
  pension:  { accounts: [], loaded: false, editingId: null },
  budgets: {},                   // { [categoryKey]: monthlyLimitBRL }
  userPrefs: {},                 // { [uid]: { defaultMode, updatedAt } }
  i10Syncing: false,
  dividendsYearlyGoal: 1_000_000,
  dividendsYearlyGoalYear: 2035,
  shareGoals: [],                // metas de quantidade de ações [{id,ticker,target,startYear,year}]
  currentViewMonth: new Date(),  // month being viewed in Expenses
};

// ============================================================
//  i18n - declared early so functions can use t()
// ============================================================
// ---- I18N movido para ./i18n.js ----

function getLang() { return localStorage.getItem('ledger-lang') || 'pt'; }

function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || (I18N.pt[key]) || key;
}
window.t = t;
window.getLang = getLang;

// Count-up: anima um número de onde estava até o alvo (o "delight" que o
// dono curtiu). Memo em el._cuVal pra só animar quando o valor muda;
// respeita prefers-reduced-motion (seta direto).
function countUpEl(el, target, fmt) {
  if (!el) return;
  target = +target || 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = typeof el._cuVal === 'number' ? el._cuVal : 0;
  el._cuVal = target;
  if (reduce || Math.abs(target - from) < 1) { el.textContent = fmt(target); return; }
  const dur = 650, t0 = performance.now();
  (function step(now) {
    let p = Math.min(1, (now - t0) / dur);
    p = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (target - from) * p);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

function applyI18n() {
  const lang = getLang();
  document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'pt-BR');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val.includes('<')) el.innerHTML = val;
    else el.textContent = val;
  });
  // Placeholders (input/textarea)
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  // Tooltips (title) + aria-labels
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  // Update lang label in topbar
  const label = document.getElementById('langLabel');
  if (label) label.textContent = lang === 'pt' ? 'EN' : 'PT';
  // Categorias padrão traduzem junto com o idioma (override do usuário vence)
  if (typeof applyCategoryConfig === 'function') {
    try { applyCategoryConfig(state && state.catConfig); populateCategorySelect(); populateExpFilterCat(); populateContribMonths(); } catch (e) {}
  }
  // Re-render dynamic views ONLY if app is loaded and user is logged in
  try {
    if (typeof state !== 'undefined' && state && state.user) {
      if (state.mode === 'investments' && typeof renderInvestments === 'function') renderInvestments();
      if (state.mode === 'expenses' && typeof renderExpenses === 'function') renderExpenses();
      if (state.mode === 'resumo' && typeof renderResumo === 'function') renderResumo();
    }
  } catch (err) {
    console.warn('[i18n] re-render skipped:', err);
  }
}

function toggleLang() {
  const next = getLang() === 'pt' ? 'en' : 'pt';
  try { localStorage.setItem('ledger-lang', next); } catch(e) {}
  applyI18n();
  if (state.user) {
    setDoc(docConfig, { lang: next, updatedAt: serverTimestamp() }, { merge: true }).catch(()=>{});
  }
}


// ---- Utils ----
const $ = (id) => document.getElementById(id);
// HTML-escape any string before injecting into innerHTML. Used on every
// user- or API-controlled value (expense desc/notes, account names, I10
// tickers/categories) to close stored-XSS sinks.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtBRL = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL0 = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtInt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

// Currency helpers for typed BRL inputs ("R$ 1.234,56" ⇄ 1234.56).
// Tolerates raw numbers ("1234.56"), dot-thousands ("1.234,56"),
// and plain comma decimal ("1234,56").
function parseBRLInput(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  let s = String(raw).replace(/R\$\s?/gi, '').trim();
  if (!s) return 0;
  // If both '.' and ',' are present: '.' is thousands, ',' is decimal.
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  // Only ',': treat it as decimal.
  else if (s.includes(',')) s = s.replace(',', '.');
  // Only '.': ambiguous (decimal vs thousands). BR-correct heuristic:
  // if the segment after the LAST dot has exactly 3 digits, every dot is
  // a thousands separator → strip them all ('20.000'→20000, '1.234.567'→
  // 1234567). Otherwise the last dot is a decimal point ('12.50'→12.5,
  // '12.5'→12.5).
  else if (s.includes('.')) {
    const parts = s.split('.');
    if (parts[parts.length - 1].length === 3) s = parts.join('');
    else s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function fmtBRLInput(n) {
  if (n == null || n === '' || !isFinite(+n)) return '';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Normalize the I10 barchart response to [{ year, month, equity }] sorted
// ascending by (year, month). The upstream shape has drifted between API
// versions — we try a handful of common shapes and give up gracefully.
// Returns [] on anything unrecognized.
function parseI10Barchart(raw) {
  if (!raw) return [];
  // Possible shapes:
  //   [ { date: '2025-11-01', value: 123 }, ... ]
  //   { data: [ ... ] }
  //   { labels: ['Nov/25', ...], values: [123, ...] }
  //   [ { month: 11, year: 2025, equity: 123 }, ... ]
  let rows = [];
  if (Array.isArray(raw)) rows = raw;
  else if (Array.isArray(raw.data)) rows = raw.data;
  else if (Array.isArray(raw.values) && Array.isArray(raw.labels)) {
    // labels + values parallel arrays. Labels like "Nov/25" or "2025-11".
    rows = raw.labels.map((lab, i) => ({ label: lab, value: raw.values[i] }));
  } else if (Array.isArray(raw.result)) rows = raw.result;
  else return [];

  const parseLabel = (lab) => {
    if (!lab) return null;
    const s = String(lab);
    // Try YYYY-MM(-DD)
    let m = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) return { year: +m[1], month: +m[2] };
    // Try MM/YY or MM/YYYY (I10's actual format — e.g. '05/25')
    m = s.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const mo = +m[1];
      let yr = +m[2];
      if (mo < 1 || mo > 12) return null;
      if (yr < 100) yr += 2000;
      return { year: yr, month: mo };
    }
    // Try 'MonPT/YY' e.g. 'Nov/25'
    const monthMap = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12, feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12 };
    m = s.match(/^([a-zA-Zç]{3})\/(\d{2,4})/i);
    if (m) {
      const mo = monthMap[m[1].toLowerCase()];
      if (!mo) return null;
      let yr = +m[2];
      if (yr < 100) yr += 2000;
      return { year: yr, month: mo };
    }
    return null;
  };

  const out = rows.map(r => {
    // I10 uses sum_equity as the canonical "patrimônio" field. We fall
    // through other names in case the upstream changes shape later.
    const equityRaw = r.sum_equity ?? r.equity ?? r.value ?? r.patrimony ?? r.patrimonio ?? r.total ?? 0;
    const equity = +equityRaw;
    let year = 0, month = 0;
    // I10's `month` and `date` fields are strings like '05/25', NOT
    // numeric. So parse the label first; only fall back to numeric
    // year/month if the upstream provided those explicitly.
    if (r.date || r.label || r.month) {
      const parsed = parseLabel(r.date || r.label || r.month);
      if (parsed) { year = parsed.year; month = parsed.month; }
    }
    if (!year && +r.year) year = +r.year;
    if (!month && typeof r.month === 'number') month = r.month;
    if (!year || !month || !isFinite(equity)) return null;
    return { year, month, equity };
  }).filter(Boolean);

  out.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return out;
}
function shortMoney(n) {
  if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n/1_000).toFixed(0) + 'k';
  return n.toFixed(0);
}
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
// Popup de ERRO visível — em vez de o sistema "não fazer nada" calado. Mostra
// um título humano + o detalhe técnico (mensagem/stack) copiável (pra mandar pro
// dev). opts.once = não repetir o mesmo erro na sessão (usado no auto-sync e nos
// handlers globais, pra não ficar piscando popup toda hora).
const _errSeen = new Set();
function showErrorPopup(title, err, opts = {}) {
  try {
    const msg = (err && err.message) ? err.message : String(err == null ? '(sem detalhe)' : err);
    const key = (title || '') + '|' + msg;
    if (opts.once && _errSeen.has(key)) return;
    _errSeen.add(key);
    const detail = [
      msg,
      (err && err.stack) ? '\n\n' + err.stack : '',
      opts.extra ? '\n\n— — —\n' + opts.extra : '',
    ].join('');
    let bg = document.getElementById('errPopup');
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'errPopup'; bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" role="alertdialog" aria-modal="true" style="max-width:540px">'
        + '<h3 class="err-pop-title" style="color:var(--loss)"></h3>'
        + '<p class="sub" style="margin:-4px 0 10px">Detalhe técnico (toque em Copiar pra me mandar):</p>'
        + '<pre class="err-pop-body"></pre>'
        + '<div class="modal-foot"><div class="spacer"></div><button class="btn-secondary err-pop-copy" type="button">Copiar</button><button class="btn-primary err-pop-close" type="button">Fechar</button></div>'
        + '</div>';
      document.body.appendChild(bg);
      bg.querySelector('.err-pop-close').addEventListener('click', () => bg.classList.remove('show'));
      bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('show'); });
      bg.querySelector('.err-pop-copy').addEventListener('click', () => {
        const txt = bg.querySelector('.err-pop-title').textContent + '\n\n' + bg.querySelector('.err-pop-body').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => showToast('Erro copiado')).catch(() => showToast('Copie manualmente'));
      });
    }
    bg.querySelector('.err-pop-title').textContent = title || 'Algo falhou';
    bg.querySelector('.err-pop-body').textContent = detail || '(sem detalhes)';
    bg.classList.add('show');
  } catch (e2) { console.error('showErrorPopup falhou', e2, 'orig:', err); try { alert((title || 'Erro') + '\n\n' + ((err && err.message) || err)); } catch (_) {} }
}
// Rede de segurança: qualquer erro não-tratado vira popup (1x por mensagem/sessão).
window.addEventListener('unhandledrejection', e => showErrorPopup('Erro não tratado (promessa)', e && e.reason, { once: true }));
window.addEventListener('error', e => { if (e && e.error) showErrorPopup('Erro não tratado', e.error, { once: true }); });

// ---- Versão do app + popup de novidades (minimal) ----
// Bump APP_VERSION quando lançar algo visível: quem já usou vê o popup 1× com
// a lista APP_CHANGES; a versão aparece no header (clicável reabre o popup).
const APP_VERSION = '9.1';
const APP_CHANGES = [
  'Investimentos: dividendos no topo, carteira ao lado do donut de diversificação, gráficos com números maiores e cards da Análise do mesmo tamanho.',
  'Resumo: gauge de poupança, patrimônio por ano com crescimento (e 2026).',
  'Despesas: sub-aba Lançamentos com navegação de meses; categorias com ícones neutros e sem o "X" nas padrão.',
  'Padrão de fontes unificado (escala tipográfica) e textos traduzindo certo.',
];
function showUpdatePopup() {
  let bg = document.getElementById('updPopup');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'updPopup'; bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" style="max-width:440px">'
      + '<h3 style="display:flex;align-items:center;gap:9px;margin:0">Novidades <span class="app-ver" style="cursor:default">v' + esc(APP_VERSION) + '</span></h3>'
      + '<ul class="upd-list">' + APP_CHANGES.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul>'
      + '<div class="modal-foot"><button class="btn-primary upd-ok" type="button">Entendi</button></div>'
      + '</div>';
    document.body.appendChild(bg);
    const close = () => { bg.classList.remove('show'); try { localStorage.setItem('ledger_seen_ver', APP_VERSION); } catch (_) {} };
    bg.querySelector('.upd-ok').addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
  }
  bg.classList.add('show');
}
// Mostra 1× por versão (quem nunca viu uma versão anterior também vê, pra conhecer).
function maybeShowUpdatePopup() {
  let seen = null; try { seen = localStorage.getItem('ledger_seen_ver'); } catch (_) {}
  if (seen !== APP_VERSION) showUpdatePopup();
}
// Versão no header (módulo deferido → o DOM já existe aqui) + clique reabre as novidades.
{
  const _vb = document.getElementById('appVerBtn');
  if (_vb) { _vb.textContent = 'v' + APP_VERSION; _vb.addEventListener('click', showUpdatePopup); }
}
// Parse a value into a Date WITHOUT the UTC-midnight timezone trap.
// `new Date('2026-05-01')` is parsed as UTC midnight → in BRT (UTC-3)
// that's Apr 30 21:00 local, so getMonth()/getDate() return the previous
// day. Expense dates are stored as date-only 'YYYY-MM-DD'; parse those
// as LOCAL dates. Anything else (Date objects, full timestamps) passes
// through to the native parser.
function parseLocalDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(d);
}
function formatDateBR(d) {
  if (!d) return '-';
  const dt = parseLocalDate(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function formatDateTimeBR(d) {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function monthKey(d) {
  const dt = parseLocalDate(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const names = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
  return `${names[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Build the public I10 wallet link from i10Cfg (no hardcoded wallet/hash in HTML).
function updateI10Link() {
  const a = $('i10PublicLink');
  if (!a) return;
  const { walletId, publicHash } = state.i10Cfg;
  if (!walletId) { a.removeAttribute('href'); a.style.opacity = '0.5'; return; }
  const base = `https://investidor10.com.br/wallet/public/${walletId}`;
  a.href = publicHash ? `${base}?h=${publicHash}` : base;
  a.style.opacity = '';
}

// Sum of all reserve account values (treated as cash; counts in equity AND applied).
function reservesTotal() {
  const accs = state.reserves.accounts || [];
  return accs.reduce((s, a) => s + (+a.value || 0), 0);
}

// Sum of all pension (previdência privada) account values.
function pensionTotal() {
  const accs = state.pension.accounts || [];
  return accs.reduce((s, a) => s + (+a.value || 0), 0);
}

// Expose net equity (i10 + USD + reserves + pension) to the Goal Simulator via window.__ledgerEquity.
function updateLedgerEquity() {
  window.__ledgerEquity = calcTotalNetWorth();
  // Whenever the underlying numbers move, refresh the Expenses net-worth
  // pill if it's on screen (idempotent on Investments mode).
  renderExpensesNetWorthPill();
}

// Shared formula between the Investments hero and the Expenses pill.
// Mirrors renderInvestments' _heroTotal: I10 (W) + USD·rate + reserves
// + pension. Louise's wallet is tracked separately (as a chip) and
// intentionally NOT summed into the household total here.
// Monthly return calculator — modified Dietz with total return.
//
// Inputs:
//   monthlyEquity: [{ year, month, equity }] sorted asc (from I10 barchart)
//   contributions: state.contributions = [{ year, month, amount }]
//   dividends:     state.yearly = [{ year, amount, ... }] (yearly only — we
//                  distribute ratably across 12 months as a fallback when
//                  per-month dividend data isn't available)
//
// Output per month (except the first one, which has no 'start'):
//   { year, month, start, end, contrib, dividends, returnBRL, returnPct }
//
// Formula (modified Dietz):
//   cash_flow = contrib - dividends_received_in_month  // net cash in
//   return_brl = end - start - cash_flow
//   denom = start + (cash_flow / 2)
//   return_pct = denom > 0 ? return_brl / denom : 0
//
// "Total return" here: we ADD back dividends paid out to the return
// numerator by treating them as negative cash flow (they reduced end
// but shouldn't count as a withdrawal). This keeps the mental model
// "dividends are part of your return, not cash taken out".
function computeMonthlyReturns(monthlyEquity, contributions, yearlyDividends) {
  if (!Array.isArray(monthlyEquity) || monthlyEquity.length < 2) return [];

  // Build { 'YYYY-MM': amount } for contributions
  const contribMap = {};
  (contributions || []).forEach(c => {
    const k = `${+c.year}-${String(+c.month).padStart(2, '0')}`;
    contribMap[k] = (contribMap[k] || 0) + (+c.amount || 0);
  });

  // Distribute yearly dividends evenly across 12 months (best-effort
  // approximation; if a month has 0 equity it gets 0).
  const divMonthlyMap = {};
  (yearlyDividends || []).forEach(y => {
    // Field is `divs` (not `amount`) — see dividendsYearly schema.
    const per = (+y.divs || 0) / 12;
    for (let mo = 1; mo <= 12; mo++) {
      const k = `${+y.year}-${String(mo).padStart(2, '0')}`;
      divMonthlyMap[k] = (divMonthlyMap[k] || 0) + per;
    }
  });

  const out = [];
  for (let i = 1; i < monthlyEquity.length; i++) {
    const prev = monthlyEquity[i - 1];
    const curr = monthlyEquity[i];
    const k = `${curr.year}-${String(curr.month).padStart(2, '0')}`;
    const contrib = +contribMap[k] || 0;
    const divs = +divMonthlyMap[k] || 0;
    const start = +prev.equity || 0;
    const end = +curr.equity || 0;
    // Net external cash flow: contribution into the portfolio, minus
    // dividends paid out (which are part of return, not withdrawal).
    const cashFlow = contrib - divs;
    const returnBRL = end - start - cashFlow;
    const denom = start + cashFlow / 2;
    const returnPct = denom > 0 ? (returnBRL / denom) * 100 : 0;
    out.push({
      year: curr.year,
      month: curr.month,
      start,
      end,
      contrib,
      dividends: divs,
      returnBRL,
      returnPct,
    });
  }
  return out;
}

function calcTotalNetWorth() {
  const i10Eq = +state.i10.equity || 0;
  const usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  return i10Eq + usdBRL + reservesTotal() + pensionTotal();
}

// Live household net worth pill shown on the Expenses tab.
// Hidden when we have no data at all yet (both i10.equity and FX empty).
function renderExpensesNetWorthPill() {
  const pill = $('expNwPill');
  if (!pill) return;
  const total = calcTotalNetWorth();
  if (total <= 0) { pill.hidden = true; return; }
  pill.hidden = false;
  $('expNwAmt').textContent = total.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  // Meta line: "atualizado DD/MM · via I10" or "manual" — mirrors investments hero
  const meta = $('expNwMeta');
  if (meta) {
    if (state.i10.updatedAt) {
      const sourceTag = state.i10.source === 'investidor10-sync' ? t('via.i10') : 'manual';
      meta.textContent = `${t('hero.updated.prefix')} ${formatDateTimeBR(state.i10.updatedAt)} · ${sourceTag}`;
    } else {
      meta.textContent = t('hero.updated.never');
    }
  }
}

// ============================================================
//                 RESUMO (planejamento) — aba dashboard
// ============================================================
let _resumoView = 'mensal';  // 'mensal' | 'anual'
const RZ_PERSON = { william: ['William', '#64d2ff', 'W'], flavia: ['Flávia', '#d8fa72', 'F'], louise: ['Louise', '#30d158', 'L'], familia: ['Família', '#c7f73e', 'Fam'] };
// Ícones dos KPIs do Resumo (cor herda do CSS via currentColor).
const RZ_KIC = {
  income:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
  expense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>',
  debt:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  savings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="16" height="11" rx="2.5"/><path d="M8 9V6.5a4 4 0 0 1 8 0V9"/></svg>',
  balance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><circle cx="16.5" cy="14.5" r="1.3" fill="currentColor"/></svg>',
};
function setResumoView(v) { _resumoView = v === 'anual' ? 'anual' : 'mensal'; renderResumo(); }
function resumoNav(dir) {
  const d = state.currentViewMonth || new Date();
  state.currentViewMonth = _resumoView === 'anual'
    ? new Date(d.getFullYear() + dir, d.getMonth(), 1)
    : new Date(d.getFullYear(), d.getMonth() + dir, 1);
  renderResumo();
}
// Resumo — PORTE DO MOCKUP: gauge de poupança + 4 KPIs + ganhos×saídas +
// "onde foi o dinheiro" (donut) + patrimônio por ano + meta de dividendos.
function renderResumo() {
  const body = $('resumoBody'); if (!body) return;
  const m = (typeof fmtBRL0 === 'function') ? fmtBRL0 : (n => 'R$ ' + Math.round(+n || 0).toLocaleString('pt-BR'));
  // compacto estilo mockup: R$ 312,4k · R$ 1,28M
  const mc = n => { n = +n || 0; const a = Math.abs(n); const sg = n < 0 ? '-' : ''; if (a >= 1e6) return 'R$ ' + sg + (a / 1e6).toFixed(2).replace('.', ',') + 'M'; if (a >= 1000) return 'R$ ' + sg + (a / 1000).toFixed(1).replace('.', ',') + 'k'; return m(n); };
  const mk = n => { n = +n || 0; const a = Math.abs(n); if (a >= 1e6) return (a / 1e6).toFixed(2).replace('.', ',') + 'M'; if (a >= 1000) return Math.round(a / 1000) + 'k'; return Math.round(a).toString(); };
  const vd = state.currentViewMonth || new Date();
  const annual = _resumoView === 'anual';
  const year = vd.getFullYear();
  const prefix = annual ? (year + '-') : (year + '-' + String(vd.getMonth() + 1).padStart(2, '0'));
  const MN = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
  const periodLabel = annual ? String(year) : (MN[vd.getMonth()] + ' ' + year);
  const periodWord = annual ? t('rz.inyear') : t('rz.inmonth');
  const startsWith = (e, p) => (e.competencia || e.date || '').startsWith(p);

  // Período corrente (mensal ou anual) — hero/KPIs/donut
  const items = (state.expenses || []).filter(e => startsWith(e, prefix));
  const exp = items.filter(e => e.type !== 'income');
  const inc = items.filter(e => e.type === 'income');
  const sum = arr => arr.reduce((s, e) => s + (+e.value || 0), 0);
  const ganhos = sum(inc), despesas = sum(exp);
  const saldo = ganhos - despesas;
  const rate = ganhos > 0 ? Math.round((saldo / ganhos) * 100) : 0;
  const ringPct = Math.max(0, Math.min(100, rate));

  // Período anterior (p/ "vs") — ano-1 (anual) ou mês-1 (mensal)
  const prevDate = annual ? new Date(year - 1, 0, 1) : new Date(vd.getFullYear(), vd.getMonth() - 1, 1);
  const prevPrefix = annual ? ((year - 1) + '-') : (prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0'));
  const prevLabel = annual ? String(year - 1) : MN[prevDate.getMonth()];
  const prevItems = (state.expenses || []).filter(e => startsWith(e, prevPrefix));
  const prevGanhos = sum(prevItems.filter(e => e.type === 'income'));
  const prevDespesas = sum(prevItems.filter(e => e.type !== 'income'));
  const ganhosVs = prevGanhos > 0 ? Math.round((ganhos - prevGanhos) / prevGanhos * 100) : null;
  const despesasVs = prevDespesas > 0 ? Math.round((despesas - prevDespesas) / prevDespesas * 100) : null;

  // Dividendos + média mensal · Patrimônio (= net worth) + variação no ano
  const divs = +state.i10.dividends || 0;
  const monthsSoFar = (year === new Date().getFullYear()) ? (new Date().getMonth() + 1) : 12;
  const divAvg = divs / (monthsSoFar || 12);
  const patrimonio = (+state.i10.equity || 0) + (+state.fx.usd || 0) * (+state.fx.rateUSD || 0) + reservesTotal() + pensionTotal();
  const nwYears = [...(state.yearly || [])].filter(y => y.equity != null && +y.equity > 0).sort((a, b) => a.year - b.year);
  const prevNW = nwYears.length ? +nwYears[nwYears.length - 1].equity : 0;
  const nwDelta = prevNW > 0 ? (patrimonio - prevNW) : 0;

  // Categorias do período (donut "onde foi o dinheiro")
  const byCat = {};
  for (const e of exp) { const c = e.category || 'outros'; byCat[c] = (byCat[c] || 0) + (+e.value || 0); }
  const catArr = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const dTotal = despesas || 1;
  let dcum = 0;
  let dSegs = '<circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--bg-elevated-2)" stroke-width="6"/>';
  let dLeg = '';
  catArr.slice(0, 6).forEach(([c, v]) => {
    const pct = v / dTotal * 100; if (pct <= 0) return;
    const col = (CATEGORIES[c] && CATEGORIES[c].color) || '#8e8e93';
    dSegs += '<circle cx="21" cy="21" r="15.9" fill="none" stroke="' + col + '" stroke-width="6" stroke-dasharray="' + pct.toFixed(1) + ' ' + (100 - pct).toFixed(1) + '" stroke-dashoffset="' + (25 - dcum).toFixed(1) + '" transform="rotate(-90 21 21)"/>';
    dcum += pct;
    const label = (CATEGORIES[c] && CATEGORIES[c].label) || c;
    dLeg += '<div class="it"><span class="dot" style="background:' + col + '"></span><span class="nm">' + esc(label) + '</span><span class="pc">' + Math.round(pct) + '%</span></div>';
  });
  if (!catArr.length) dLeg = '<div class="rz-empty">' + esc(t('rz.empty')) + '</div>';

  // Ganhos vs Saídas — 12 meses do ano (sempre anual, dá contexto)
  const MS = (getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT).map(s => String(s).toLowerCase());
  const mo = Array.from({ length: 12 }, () => ({ rec: 0, desp: 0 }));
  for (const e of (state.expenses || []).filter(e => startsWith(e, year + '-'))) {
    const i = +String(e.competencia || e.date || '').slice(5, 7) - 1;
    if (i < 0 || i > 11) continue;
    if (e.type === 'income') mo[i].rec += (+e.value || 0); else mo[i].desp += (+e.value || 0);
  }
  const maxMo = Math.max(1, ...mo.map(x => Math.max(x.rec, x.desp)));
  const gbars = mo.map((x, i) => '<div class="rz-gcol"><div class="rz-gpair"><i class="in" style="height:' + (x.rec / maxMo * 100).toFixed(1) + '%" title="' + m(x.rec) + '"></i><i class="out" style="height:' + (x.desp / maxMo * 100).toFixed(1) + '%" title="' + m(x.desp) + '"></i></div><span class="rz-gx">' + MS[i] + '</span></div>').join('');

  // Patrimônio por ano — inclui o ano atual (patrimônio ao vivo) + % de crescimento ano a ano
  const _cy = new Date().getFullYear();
  const nwChart = nwYears.some(y => +y.year === _cy)
    ? nwYears.slice()
    : (patrimonio > 0 ? nwYears.concat([{ year: _cy, equity: patrimonio }]) : nwYears.slice());
  const nwMax = Math.max(1, ...nwChart.map(y => +y.equity || 0));
  const yearsHtml = nwChart.length
    ? nwChart.map((y, i) => {
        const eq = +y.equity || 0;
        const prev = i > 0 ? (+nwChart[i - 1].equity || 0) : 0;
        const grow = (i > 0 && prev > 0) ? Math.round((eq - prev) / prev * 100) : null;
        const gChip = grow != null
          ? '<div class="rz-yr-g ' + (grow >= 0 ? 'pos' : 'neg') + '">' + (grow >= 0 ? '+' : '') + grow + '%</div>'
          : '<div class="rz-yr-g">&nbsp;</div>';
        return '<div class="rz-yr' + (i === nwChart.length - 1 ? ' cur' : '') + '"><i style="height:' + (eq / nwMax * 100).toFixed(1) + '%"></i><div class="rz-yr-v">' + mk(eq) + '</div>' + gChip + '<div class="rz-yr-l">' + y.year + '</div></div>';
      }).join('')
    : '<div class="rz-empty">' + esc(t('rz.empty')) + '</div>';

  // Meta de dividendos
  const goal = +state.dividendsYearlyGoal || 1e6;
  const goalYear = state.dividendsYearlyGoalYear || 2035;
  const goalPct = goal > 0 ? Math.min(100, divs / goal * 100) : 0;
  const falta = Math.max(0, goal - divs);

  const vsTxt = (v, lbl) => v == null ? '' : (v >= 0 ? '↑' : '↓') + ' ' + Math.abs(v) + '% vs ' + lbl;

  body.innerHTML = `
    <div class="rz-head">
      <div class="rz-seg">
        <button class="${annual ? '' : 'on'}" data-rzview="mensal">${esc(t('rz.monthly'))}</button>
        <button class="${annual ? 'on' : ''}" data-rzview="anual">${esc(t('rz.annual'))}</button>
      </div>
      <div class="rz-nav"><button data-rznav="-1" aria-label="${esc(t('a11y.prev'))}">‹</button><span class="rz-period">${esc(periodLabel)}</span><button data-rznav="1" aria-label="${esc(t('a11y.next'))}">›</button></div>
    </div>
    <div class="rz-grid12">
      <div class="rz-bal ${saldo < 0 ? 'is-neg' : ''}">
        <div class="rz-gauge">
          <svg width="152" height="152" viewBox="0 0 42 42" style="transform:rotate(-90deg)">
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="4"/>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--hero-num)" stroke-width="4" stroke-linecap="round" stroke-dasharray="100 100" stroke-dashoffset="${(100 - ringPct).toFixed(1)}"/>
          </svg>
          <div class="rz-gauge-c"><b>${rate}%</b><span>${esc(t('rz.poupanca'))}</span></div>
        </div>
        <div class="rz-bal-info">
          <div class="rz-bal-eye"><span class="rz-hero-dot"></span>${esc(t('rz.balanceof'))} ${esc(periodLabel)}</div>
          <div class="rz-bal-stats">
            <div><div class="k">${esc(t('rz.income'))}</div><div class="v">${mc(ganhos)}</div></div>
            <div><div class="k">${esc(t('rz.expenses'))}</div><div class="v">${mc(despesas)}</div></div>
            <div><div class="k">${esc(t('rz.saved'))}</div><div class="v">${mc(saldo)}</div></div>
          </div>
        </div>
      </div>
      <div class="rz-kpis2">
        <div class="card rz-kpi2"><div class="klabel">${esc(t('rz.income'))} ${esc(periodWord)}</div><div class="rz-kpi2-v mono">${mc(ganhos)}</div><div class="rz-kpi2-s ${ganhosVs >= 0 ? 'pos' : 'neg'}">${esc(vsTxt(ganhosVs, prevLabel))}</div></div>
        <div class="card rz-kpi2"><div class="klabel">${esc(t('rz.expenses'))} ${esc(periodWord)}</div><div class="rz-kpi2-v mono">${mc(despesas)}</div><div class="rz-kpi2-s ${despesasVs <= 0 ? 'pos' : 'neg'}">${esc(vsTxt(despesasVs, prevLabel))}</div></div>
        <div class="card rz-kpi2"><div class="klabel">${esc(t('rz.dividends'))}</div><div class="rz-kpi2-v mono">${mc(divs)}</div><div class="rz-kpi2-s">${divs > 0 ? esc(t('rz.avgmonth')) + ' ' + mc(divAvg) + '/' + esc(t('rz.mo')) : ''}</div></div>
        <div class="card rz-kpi2"><div class="klabel">${esc(t('rz.networth'))}</div><div class="rz-kpi2-v mono">${mc(patrimonio)}</div><div class="rz-kpi2-s ${nwDelta >= 0 ? 'pos' : 'neg'}">${nwDelta ? (nwDelta >= 0 ? '↑ ' : '↓ ') + mc(Math.abs(nwDelta)) + ' ' + esc(t('rz.inyear')) : ''}</div></div>
      </div>
      <div class="card rz-gvs">
        <div class="rz-card-h">${esc(t('rz.recVsExp'))}<span class="rz-legend"><span class="lg"><i class="rz-rec"></i>${esc(t('rz.income'))}</span><span class="lg"><i class="rz-desp"></i>${esc(t('rz.expenses'))}</span></span></div>
        <div class="rz-gbars">${gbars}</div>
      </div>
      <div class="card rz-onde">
        <div class="rz-card-h">${esc(t('rz.wheremoney'))}<span class="more">${esc(periodLabel)}</span></div>
        <div class="rz-alloc"><svg class="rz-odonut" width="128" height="128" viewBox="0 0 42 42">${dSegs}</svg><div class="rz-leg">${dLeg}</div></div>
      </div>
      <div class="card rz-anos">
        <div class="rz-card-h">${esc(t('rz.networthyear'))}${nwChart.length ? '<span class="more">' + nwChart[0].year + '–' + nwChart[nwChart.length - 1].year + '</span>' : ''}</div>
        <div class="rz-years">${yearsHtml}</div>
      </div>
      <div class="card rz-meta">
        <div class="rz-card-h">${esc(t('rz.divgoal'))}<span class="more">${goalYear}</span></div>
        <div class="rz-note">${mc(divs)} ${esc(t('rz.of'))} <b>${mc(goal)}</b>/${esc(t('rz.year'))}</div>
        <div class="rz-goalbar"><i style="width:${goalPct.toFixed(1)}%"></i></div>
        <div class="rz-note">${esc(t('rz.atpace'))} <b class="pos">${esc(t('rz.onplan'))}</b> · ${esc(t('rz.missing'))} ${mc(falta)}</div>
      </div>
    </div>`;
  body.querySelectorAll('[data-rzview]').forEach(b => b.addEventListener('click', () => setResumoView(b.dataset.rzview)));
  body.querySelectorAll('[data-rznav]').forEach(b => b.addEventListener('click', () => resumoNav(+b.dataset.rznav)));
}

// ============================================================
//                 MODE SWITCH (Expenses/Invest)
// ============================================================
function switchMode(mode, opts = {}) {
  state.mode = mode;
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  if (mode === 'expenses') {
    $('moduleExpenses').classList.add('active');
    renderExpenses();
  } else if (mode === 'resumo') {
    $('moduleResumo').classList.add('active');
    renderResumo();
  } else {
    $('moduleInvestments').classList.add('active');
    renderInvestments();
  }
  wireCardCollapse();   // botões de recolher (cobre Despesas + Investimentos)
  // Persist this as the user's preferred default for next session.
  // `opts.persist === false` skips writing (used during the initial boot
  // so we don't overwrite the value we just read).
  if (opts.persist !== false && state.user?.uid) {
    const uid = state.user.uid;
    setDoc(docUserPrefs, {
      [uid]: { defaultMode: mode, updatedAt: serverTimestamp() }
    }, { merge: true }).catch(err => console.warn('[prefs] persist failed:', err));
  }
}

// Decide the initial mode for a just-logged-in user:
// 1. Previously-persisted choice in config/userPrefs.{uid}.defaultMode
// 2. Known primary email → 'investments'
// 3. Anyone else → 'expenses' (household spouse / secondary user)
async function pickInitialMode(user) {
  try {
    const snap = await getDoc(docUserPrefs);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const persisted = data?.[user.uid]?.defaultMode;
    if (persisted === 'expenses' || persisted === 'investments') return persisted;
  } catch (err) {
    console.warn('[prefs] read failed, falling back to email default:', err);
  }
  const email = (user.email || '').toLowerCase().trim();
  return email === KNOWN_PRIMARY_EMAIL ? 'investments' : 'expenses';
}

// ============================================================
//                      EXPENSES MODULE
// ============================================================
function filterExpensesByMonth(date) {
  const targetKey = monthKey(date);
  return state.expenses.filter(e => {
    // Agrupa pela competência (mês da fatura) quando existe; senão, pelo mês da data real.
    const key = e.competencia || (e.date ? monthKey(parseLocalDate(e.date)) : null);
    return key === targetKey;
  });
}

// Legacy entries (pre-type-split) are treated as expenses.
const isIncome = (e) => e && e.type === 'income';
const isExpense = (e) => !isIncome(e);

// Resolve icon/color/label for any entry, handling both CATEGORIES and
// INCOME_SOURCES dictionaries.
function entryMeta(e) {
  if (isIncome(e)) {
    const s = INCOME_SOURCES[e.category] || INCOME_SOURCES.outros;
    return { icon: s.icon, color: s.color, label: t(s.labelKey) };
  }
  const c = CATEGORIES[e.category] || CATEGORIES.outros;
  return { icon: c.icon, color: c.color, label: c.label };
}

// Ordenação da tabela "Todas as despesas do mês" (cabeçalho clicável).
let _expSort = { key: 'date', dir: 'desc' };   // default: data, mais recente primeiro
function expCompare(a, b) {
  const dir = _expSort.dir === 'asc' ? 1 : -1;
  let r;
  switch (_expSort.key) {
    case 'value': r = (+a.value || 0) - (+b.value || 0); break;
    case 'desc': r = String(a.description || '').localeCompare(String(b.description || ''), 'pt', { sensitivity: 'base' }); break;
    case 'category': r = String(entryMeta(a).label || '').localeCompare(String(entryMeta(b).label || ''), 'pt', { sensitivity: 'base' }); break;
    default: r = parseLocalDate(a.date) - parseLocalDate(b.date);   // date
  }
  r *= dir;
  if (r === 0) r = parseLocalDate(b.date) - parseLocalDate(a.date); // desempate: mais recente primeiro
  return r;
}
function updateExpSortHeaders() {
  document.querySelectorAll('.exp-table thead th[data-sort]').forEach(th => {
    th.classList.toggle('is-sorted-asc', th.dataset.sort === _expSort.key && _expSort.dir === 'asc');
    th.classList.toggle('is-sorted-desc', th.dataset.sort === _expSort.key && _expSort.dir === 'desc');
  });
}
// Desenha uma sparkline (linha + área opcional) num <svg> a partir de uma série.
function sparkPath(svgEl, values, W, H, fill) {
  if (!svgEl) return;
  const v = (values && values.length > 1) ? values : [0, 0, 0];
  const max = Math.max(...v), min = Math.min(...v), rng = (max - min) || 1, n = v.length;
  const X = i => (i / (n - 1)) * W;
  const Y = val => H - 3 - ((val - min) / rng) * (H - 6);
  const line = 'M' + v.map((val, i) => X(i).toFixed(1) + ' ' + Y(val).toFixed(1)).join(' L');
  let html = '';
  if (fill) html += '<path class="spk-fill" d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z"/>';
  html += '<path class="spk-line" vector-effect="non-scaling-stroke" fill="none" d="' + line + '"/>';
  svgEl.innerHTML = html;
}
function renderExpenses() {
  updateExpSortHeaders();   // indicador de ordenação sempre reflete _expSort (mesmo c/ tabela vazia)
  const viewDate = state.currentViewMonth;
  const realThisMonth = filterExpensesByMonth(viewDate);
  // Recorrências (fixas) projetadas pro mês — VIRTUAIS, nunca persistidas. A
  // reconciliação é automática: `projectRecurring` suprime a recorrência quando
  // já existe o lançamento real (manual OU da fatura importada) → nunca duplica.
  // Inerte se não há templates (state.recurring vazio → [] → `all` intacto).
  const virtuals = projectRecurring(state.recurring, realThisMonth, monthKey(viewDate), monthKey(new Date()));
  const all = virtuals.length ? realThisMonth.concat(virtuals) : realThisMonth;
  // Provisão (parcela do mês) CONTA como gasto do mês — é parte da fatura paga nesse mês.
  const monthExp = all.filter(e => isExpense(e));
  const monthIncome = all.filter(isIncome);
  const prevDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  const prevMonthExp = filterExpensesByMonth(prevDate).filter(e => isExpense(e));

  const total = monthExp.reduce((s,e) => s + (+e.value||0), 0);
  const prevTotal = prevMonthExp.reduce((s,e) => s + (+e.value||0), 0);

  // Hero: "Saldo do mês" = ganhos − saídas
  $('currentMonthLabel').textContent = monthLabel(viewDate);
  if ($('lancMonthLabel')) $('lancMonthLabel').textContent = monthLabel(viewDate);
  const incomeTotal = monthIncome.reduce((s, e) => s + (+e.value || 0), 0);
  const saldo = incomeTotal - total;
  const heroAmtEl = $('expHeroAmt');
  const heroCurEl = document.querySelector('.exp-hero .amt .cur');
  const hero = document.querySelector('.exp-hero');
  // Amount: show absolute; class on hero signals sign (positive vs negative)
  countUpEl(heroAmtEl, Math.abs(saldo), n => Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  if (hero) {
    hero.classList.toggle('is-positive', saldo >= 0 && (incomeTotal > 0 || total > 0));
    hero.classList.toggle('is-negative', saldo < 0);
  }
  // Prepend sign to currency label so "R$ 46" for positive, "−R$ 46" for negative
  if (heroCurEl) heroCurEl.textContent = saldo < 0 ? '− R$' : 'R$';
  // Subline: "↑ 46k entraram · ↓ 82k saíram" — or empty state
  const heroSub = $('expHeroSub');
  if (monthExp.length === 0 && monthIncome.length === 0) {
    heroSub.textContent = t('exp.hero.empty');
  } else {
    heroSub.innerHTML = t('exp.hero.balance.sub')
      .replace('{in}', `<span class="pos">↑ ${fmtBRL0(incomeTotal)}</span>`)
      .replace('{out}', `<span class="neg">↓ ${fmtBRL0(total)}</span>`);
  }
  // Label swap "TOTAL DO MÊS" → "SALDO DO MÊS" (also honored by data-i18n)
  const heroLabelEl = document.querySelector('.exp-hero-eyebrow .label');
  if (heroLabelEl) {
    heroLabelEl.setAttribute('data-i18n', 'exp.hero.balance');
    heroLabelEl.textContent = t('exp.hero.balance');
  }

  // Stats 2×2 (igual mockup): Gastos do mês (valor + nº), Despesas fixas (+sparkline)
  $('expTotal').textContent = fmtBRL0(total);
  $('expTotalSub').textContent = monthExp.length + (monthExp.length === 1 ? ' lançamento' : ' lançamentos');
  const fixasTotal = monthExp.filter(e => e.nature === 'fixa' || e.recurring).reduce((s, e) => s + (+e.value || 0), 0);
  $('expFixas').textContent = fmtBRL0(fixasTotal);
  {
    const dim = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const byDay = {}, fxDay = {};
    for (const e of monthExp) { const d = +String(e.date || '').slice(8, 10) || 1; byDay[d] = (byDay[d] || 0) + (+e.value || 0); if (e.nature === 'fixa' || e.recurring) fxDay[d] = (fxDay[d] || 0) + (+e.value || 0); }
    let c = 0, fc = 0; const cum = [], fcum = [];
    for (let d = 1; d <= dim; d++) { c += (byDay[d] || 0); fc += (fxDay[d] || 0); cum.push(c); fcum.push(fc); }
    sparkPath($('expHeroArea'), cum, 600, 120, true);
    sparkPath($('expFixasSpark'), fcum, 120, 32, false);
  }

  if (prevTotal > 0) {
    const diff = total - prevTotal;
    const pct = (diff / prevTotal) * 100;
    const arrow = diff >= 0 ? '↑' : '↓';
    $('expVsPrev').innerHTML = `<span class="${diff>=0?'neg':'pos'}">${arrow} ${fmtPct(Math.abs(pct) * (diff>=0?1:-1))}</span>`;
    const prevLabel = (getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT)[prevDate.getMonth()];
    $('expVsPrevSub').textContent = t('exp.stat.vs.sub')
      .replace('{diff}', (diff>=0?'+':'') + fmtBRL0(diff))
      .replace('{prev}', prevLabel);
  } else {
    $('expVsPrev').textContent = '—';
    $('expVsPrevSub').textContent = t('exp.stat.vs.empty');
  }

  // Biggest expense
  if (monthExp.length > 0) {
    const biggest = [...monthExp].sort((a,b) => (+b.value||0) - (+a.value||0))[0];
    $('expBiggest').textContent = fmtBRL0(+biggest.value||0);
    $('expBiggestSub').textContent = biggest.description || '—';
  } else {
    $('expBiggest').textContent = '—';
    $('expBiggestSub').textContent = '—';
  }

  // Expense-only surfaces (category breakdown, daily chart, trend, recurring, budgets)
  const allExpHistory = (state.expenses || []).filter(e => isExpense(e) && !e.provisioned);
  renderCategoryBreakdown(monthExp, total);
  renderTrend12m(allExpHistory, viewDate);
  renderTopRecurring(allExpHistory, viewDate);
  updateHeroOverBudgetBadge(monthExp);

  // Tabela = só DESPESAS por padrão; `all` ainda entra porque o filtro "Ganho"
  // precisa dos ganhos no conjunto. (Card "recentes" e "ritmo diário" removidos.)
  renderExpenseTable(all);

  renderExpensesNetWorthPill();
  updateImportsBtn();
}

function renderCategoryBreakdown(monthExp, total) {
  const wrap = $('catList');
  const totalEl = $('expBudgetTotal');
  const budgets = state.budgets || {};

  if (monthExp.length === 0) {
    wrap.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.cat.title')}</h4><p>${t('exp.empty.cat.sub')}</p></div>`;
    if (totalEl) totalEl.hidden = true;
    return;
  }
  // Group by category (include cats with a budget even if no spend)
  const byCat = {};
  monthExp.forEach(e => {
    const cat = e.category || 'outros';
    byCat[cat] = (byCat[cat] || 0) + (+e.value||0);
  });
  Object.keys(budgets).forEach(k => { if (!(k in byCat)) byCat[k] = 0; });

  // Sort: rows with spending first (desc), then 0-spend budgeted cats alpha
  const sorted = Object.entries(byCat).sort((a, b) => {
    if (a[1] === 0 && b[1] === 0) return a[0].localeCompare(b[0]);
    return b[1] - a[1];
  });

  const catRowsHtml = sorted.map(([catKey, val], idx) => {
    const cat = CATEGORIES[catKey] || CATEGORIES.outros;
    const limit = +budgets[catKey] || 0;
    // Bar width: % of month total if no budget; % of own limit if budgeted
    const barPct = limit > 0
      ? Math.min(100, (val / limit) * 100)
      : (total > 0 ? (val / total) * 100 : 0);
    const overBudget = limit > 0 && val > limit;
    const pctOfLimit = limit > 0 ? (val / limit) * 100 : null;
    const shareOfMonth = total > 0 ? (val / total) * 100 : 0;

    // Primary right-side value: % of limit (when budgeted) or % of month
    const rightPctStr = limit > 0 ? `${Math.round(pctOfLimit)}%` : `${Math.round(shareOfMonth)}%`;
    const amtStr = limit > 0
      ? `${fmtBRL0(val)} <span class="exp-cat-of">${t('exp.budget.of').replace('{limit}', fmtBRL0(limit))}</span>`
      : fmtBRL0(val);

    return `<div class="exp-cat-row${idx >= 8 ? ' exp-cat-extra' : ''}${overBudget ? ' over-budget' : ''}${limit > 0 ? ' has-budget' : ''}" style="--cat-color:${cat.color};--cat-delay:${0.05 + idx * 0.04}s">
      <div class="exp-cat-icon">${cat.icon}</div>
      <div class="exp-cat-meta">
        <div class="exp-cat-name">${cat.label}</div>
        <div class="exp-cat-bar"><i style="--w:${barPct}%"></i></div>
      </div>
      <div class="exp-cat-v">
        <div class="exp-cat-pct">${rightPctStr}</div>
        <div class="exp-cat-amt">${amtStr}</div>
      </div>
    </div>`;
  }).join('');
  // Mostra as 8 maiores no painel; "Ver todas" leva pra sub-aba Categorias (gerenciar todas).
  const _extra = sorted.length - 8;
  const _moreLbl = `Ver todas (${sorted.length})`;
  wrap.innerHTML = catRowsHtml + (_extra > 0 ? `<button class="exp-cat-more" type="button">${_moreLbl}</button>` : '');
  wrap.classList.remove('show-all');
  const _mb = wrap.querySelector('.exp-cat-more');
  if (_mb) _mb.addEventListener('click', () => setExpSub('categorias'));

  // Footer: total spent vs total budgeted (across categories that have a limit)
  if (totalEl) {
    const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);
    if (totalBudget > 0) {
      const totalSpentInBudgeted = Object.keys(budgets).reduce((s, k) => s + (byCat[k] || 0), 0);
      const pct = (totalSpentInBudgeted / totalBudget) * 100;
      const over = totalSpentInBudgeted > totalBudget;
      totalEl.hidden = false;
      totalEl.className = 'exp-budget-total' + (over ? ' over' : '');
      totalEl.innerHTML = `
        <div class="exp-budget-total-head">
          <span class="lbl">${t('exp.budget.total')}</span>
          <span class="v">${fmtBRL0(totalSpentInBudgeted)} <span class="sep">/</span> ${fmtBRL0(totalBudget)}</span>
        </div>
        <div class="exp-budget-total-bar"><i style="width:${Math.min(100, pct)}%"></i></div>
      `;
    } else {
      totalEl.hidden = true;
    }
  }
}

// Owner short chip renderer — returns '' when the owner tag adds no info
// (undefined or a legacy entry without owner field).
function ownerChipHtml(e) {
  const owner = normOwner(e.owner);
  if (!owner) return '';
  const short = t(`exp.owner.short.${owner}`);
  const full = t(`exp.owner.${owner}`);
  return `<span class="exp-owner-chip exp-owner-${owner}" title="${full}">${short}</span>`;
}

function renderRecentList(entries) {
  const wrap = $('recentList');
  if (entries.length === 0) {
    wrap.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.recent.title')}</h4><p>${t('exp.empty.recent.sub')}</p></div>`;
    $('recentMeta').textContent = '—';
    return;
  }
  const sorted = [...entries]
    .sort((a,b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime())
    .slice(0, 6);
  $('recentMeta').textContent = t('exp.card.recent.sub').replace('{n}', sorted.length);
  wrap.innerHTML = sorted.map((e, idx) => {
    const meta = entryMeta(e);
    const isIn = isIncome(e);
    const amt = (+e.value || 0);
    const amtText = isIn ? `+ ${fmtBRL(amt)}` : fmtBRL(amt);
    const ownerChip = ownerChipHtml(e);
    return `<div class="exp-recent-row${isIn ? ' is-income' : ''}" data-id="${e.id}" style="--cat-color:${meta.color};--row-delay:${0.05 + idx * 0.04}s">
      <div class="exp-recent-icon">${meta.icon}</div>
      <div class="exp-recent-main">
        <div class="exp-recent-desc">${esc(e.description) || '—'}${ownerChip}</div>
        <div class="exp-recent-meta">${formatDateBR(e.date)} · ${meta.label}</div>
      </div>
      <div class="exp-recent-amt">${amtText}</div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.exp-recent-row[data-id]').forEach(row =>
    row.addEventListener('click', () => openExpenseModal(row.dataset.id))
  );
}

// Keep last rendered month so CSV export + search filter can operate
// on the same dataset without re-querying state.
let _lastMonthExp = [];
let _expSearchQuery = '';
let _expFilters = { cat: '', owner: '', nature: '' };
// Repovoa o dropdown de Categoria do filtro a partir do CATEGORIES vivo.
function populateExpFilterCat() {
  const sel = $('expFilterCat'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(t('exp.filter.cat.all'))}</option>` + catsAZ().map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');
  if (cur && CATEGORIES[cur]) sel.value = cur;
  sel.classList.toggle('on', !!sel.value);
}
// Popula o select de mês do modal de aporte conforme o idioma atual.
function populateContribMonths() {
  const sel = $('contribMonth'); if (!sel) return;
  const names = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
  const cur = sel.value;
  sel.innerHTML = names.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  if (cur) sel.value = cur;
}

function renderExpenseTable(entries) {
  _lastMonthExp = entries;
  const tbody = $('expBody');
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="exp-empty"><h4>${t('exp.empty.table.title')}</h4><p>${t('exp.empty.table.sub')}</p></div></td></tr>`;
    return;
  }

  // Apply search filter (description + category/source label + notes +
  // owner full/short label, case-insensitive)
  const q = _expSearchQuery.trim().toLowerCase();
  const filtered = q
    ? entries.filter(e => {
        const meta = entryMeta(e);
        const hay = [
          e.description || '',
          e.notes || '',
          meta.label,
          isIncome(e) ? t('exp.income.pill') : '',
          e.owner ? t(`exp.owner.${e.owner}`) : '',
          e.owner ? t(`exp.owner.short.${e.owner}`) : '',
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
    : entries;

  // Filtros (categoria / pessoa / tipo) — combinam com a busca de texto
  const fc = _expFilters.cat, fo = _expFilters.owner, ft = _expFilters.nature;
  let result = filtered;
  if (fc) result = result.filter(e => (e.category || 'outros') === fc);
  if (fo) result = result.filter(e => (e.owner === 'joint' ? 'familia' : (e.owner || 'familia')) === fo);
  // Sub-aba Ganhos = só ganhos; senão DESPESAS por padrão (ganhos via filtro "Ganho").
  if (state.expSub === 'ganhos' || ft === 'ganho') result = result.filter(e => isIncome(e));
  else {
    result = result.filter(e => !isIncome(e));
    if (ft === 'fixa' || ft === 'variavel') result = result.filter(e => (e.nature || 'variavel') === ft);
  }

  // Totalizador (acima da coluna Valor): nº de lançamentos + soma do que está à vista.
  const _tb = $('expTotalBar');
  if (_tb) {
    if (result.length) {
      const tot = result.reduce((s, e) => s + (+e.value || 0), 0);
      _tb.hidden = false;
      _tb.innerHTML = `<span class="exp-total-lbl">${result.length} ${result.length === 1 ? 'lançamento' : 'lançamentos'}</span><span class="exp-total-val">${fmtBRL(tot)}</span>`;
    } else { _tb.hidden = true; }
  }

  if (result.length === 0) {
    const msg = q ? t('exp.search.none').replace('{q}', _expSearchQuery.trim()) : t('exp.filter.none');
    tbody.innerHTML = `<tr><td colspan="4"><div class="exp-empty"><h4>${msg}</h4><p>${t('exp.empty.table.sub')}</p></div></td></tr>`;
    return;
  }

  const sorted = [...result].sort(expCompare);
  const TLIMIT = 8;   // mostra as primeiras N linhas; o resto fica atrás de "Ver todas" (enche o card até a altura do de categoria)
  tbody.innerHTML = sorted.map((e, i) => {
    const meta = entryMeta(e);
    const isIn = isIncome(e);
    const notes = (e.notes || '').replace(/\s*·\s*provis[aã]o\b/i, '').trim();   // provisão conta como gasto → sem o selo "provisão"
    const ownerChip = ownerChipHtml(e);
    const descMain = `<div class="exp-row-desc">${esc(e.description) || '—'}${ownerChip}</div>`;
    const descHtml = notes
      ? `${descMain}<div class="exp-row-notes" title="${esc(notes)}">${esc(notes)}</div>`
      : descMain;
    const amt = (+e.value || 0);
    const amtText = isIn ? `+ ${fmtBRL(amt)}` : fmtBRL(amt);
    const pillLabel = isIn ? t('exp.income.pill') : meta.label;
    const isV = e._virtual;
    const fixaBadge = isV ? `<span class="exp-fixa-badge">${e._future ? 'fixa · prevista' : 'fixa'}</span>` : '';
    const _showAll = state._expTableAll || state.expSub === 'lancamentos' || state.expSub === 'ganhos';   // Lançamentos/Ganhos mostram TODAS
    const extraCls = (!_showAll && sorted.length > TLIMIT && i >= TLIMIT) ? ' exp-row-extra' : '';
    return `<tr ${isV ? `data-recurring-id="${esc(e.recurringId)}"` : `data-id="${e.id}"`} class="${isIn ? 'is-income' : ''}${isV ? ' is-recurring' : ''}${extraCls}" style="--cat-color:${meta.color}">
      <td class="mono exp-row-date">${formatDateBR(e.date)}</td>
      <td class="exp-row-desc-cell">${descHtml}${fixaBadge}</td>
      <td><span class="exp-cat-pill ${isIn ? 'is-income' : ''}" style="--cat-color:${meta.color}"><span class="exp-cat-pill-icon">${meta.icon}</span>${pillLabel}</span></td>
      <td class="mono exp-row-amt">${amtText}</td>
    </tr>`;
  }).join('') + ((sorted.length > TLIMIT && state.expSub !== 'lancamentos' && state.expSub !== 'ganhos')
    ? `<tr class="exp-row-more-tr"><td colspan="4"><button class="exp-row-more" type="button">Ver todas (${sorted.length})</button></td></tr>`
    : '');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openExpenseModal(tr.dataset.id)));
  tbody.querySelectorAll('tr[data-recurring-id]').forEach(tr => tr.addEventListener('click', () => openRecurringEditor(tr.dataset.recurringId)));
  const _moreBtn = tbody.querySelector('.exp-row-more');
  if (_moreBtn) _moreBtn.addEventListener('click', () => setExpSub('lancamentos'));   // abre a sub-aba Lançamentos
}

// CSV export of the currently viewed month (ignores search filter — users
// usually want the full month, not a filtered view).
function exportCurrentMonthCSV() {
  const monthExp = _lastMonthExp || [];
  const viewDate = state.currentViewMonth || new Date();
  const monthStr = String(viewDate.getMonth() + 1).padStart(2, '0');
  const yearStr = String(viewDate.getFullYear());
  const filename = t('exp.csv.filename').replace('{month}', monthStr).replace('{year}', yearStr);

  // CSV with BOM so Excel opens UTF-8 correctly. Separator = ';' (BR convention).
  const rows = [['Data', 'Tipo', 'De quem', 'Descrição', 'Categoria/Fonte', 'Valor (BRL)', 'Notas']];
  [...monthExp]
    .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))
    .forEach(e => {
      const meta = entryMeta(e);
      const typeLabel = isIncome(e) ? t('exp.type.income') : t('exp.type.expense');
      const ownerLabel = e.owner ? t(`exp.owner.${e.owner}`) : '';
      const signed = (isIncome(e) ? +e.value : -Math.abs(+e.value || 0)).toFixed(2).replace('.', ',');
      rows.push([
        e.date || '',
        typeLabel,
        ownerLabel,
        (e.description || '').replace(/"/g, '""'),
        meta.label,
        signed,
        (e.notes || '').replace(/"/g, '""'),
      ]);
    });
  const csv = '\ufeff' + rows.map(r => r.map(cell => `"${cell}"`).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

// ============================================================
//                 EXPENSES - ANALYTICS (Fase C)
// ============================================================

// Daily spending sparkline: cumulative spend across the viewed month,
// overlaid with a dotted "expected pace" line (month total / days).
function renderDailyChart(monthExp, viewDate) {
  const svg = $('expDailyChart');
  const footer = $('expDailyFooter');
  if (!svg) return;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = (new Date().getFullYear() === year) && (new Date().getMonth() === month);
  const todayDay = isCurrentMonth ? new Date().getDate() : daysInMonth;

  // Aggregate per-day spend
  const perDay = new Array(daysInMonth + 1).fill(0); // 1-indexed
  monthExp.forEach(e => {
    const d = parseLocalDate(e.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      perDay[d.getDate()] += (+e.value || 0);
    }
  });

  const total = perDay.reduce((s, v) => s + v, 0);
  const cumul = new Array(daysInMonth + 1).fill(0);
  for (let i = 1; i <= daysInMonth; i++) cumul[i] = cumul[i - 1] + perDay[i];

  // Paint
  const W = 700, H = 180, PAD_X = 14, PAD_Y = 18;
  const xAt = d => PAD_X + ((d - 1) / Math.max(1, daysInMonth - 1)) * (W - PAD_X * 2);
  const maxY = Math.max(total, 1);
  const yAt = v => H - PAD_Y - (v / maxY) * (H - PAD_Y * 2);

  // Cumulative path (only up to today)
  const endDay = isCurrentMonth ? todayDay : daysInMonth;
  const cumPoints = [];
  for (let d = 1; d <= endDay; d++) cumPoints.push(`${xAt(d).toFixed(1)},${yAt(cumul[d]).toFixed(1)}`);
  const linePath = cumPoints.length ? `M ${cumPoints[0]} L ${cumPoints.slice(1).join(' L ')}` : '';
  const areaPath = cumPoints.length
    ? `M ${xAt(1).toFixed(1)},${(H - PAD_Y).toFixed(1)} L ${cumPoints.join(' L ')} L ${xAt(endDay).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`
    : '';

  // Expected pace line: starts at (1, 0), ends at (daysInMonth, total)
  const pacePath = `M ${xAt(1).toFixed(1)},${yAt(0).toFixed(1)} L ${xAt(daysInMonth).toFixed(1)},${yAt(total).toFixed(1)}`;

  // Weekend tint bands
  const bands = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0 || dow === 6) {
      const x = xAt(d - 0.5);
      const w = (W - PAD_X * 2) / Math.max(1, daysInMonth - 1);
      bands.push(`<rect x="${x.toFixed(1)}" y="${PAD_Y.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - PAD_Y * 2).toFixed(1)}" fill="var(--ink-muted)" opacity="0.04"/>`);
    }
  }

  const todayX = xAt(todayDay);
  const todayY = yAt(cumul[endDay]);

  svg.innerHTML = `
    <defs>
      <linearGradient id="expDailyFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="var(--purple)"       stop-opacity="0.30"/>
        <stop offset="100%" stop-color="var(--purple)"      stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${bands.join('')}
    <path d="${pacePath}" stroke="var(--ink-3)" stroke-width="1.2" stroke-dasharray="3 4" fill="none" opacity="0.55"/>
    ${areaPath ? `<path d="${areaPath}" fill="url(#expDailyFill)"/>` : ''}
    ${linePath ? `<path d="${linePath}" fill="none" stroke="var(--purple-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px var(--purple-glow));"/>` : ''}
    ${cumPoints.length ? `<circle cx="${todayX.toFixed(1)}" cy="${todayY.toFixed(1)}" r="4" fill="var(--purple-light)" stroke="var(--bg-elevated)" stroke-width="2"/>` : ''}
  `;

  // Footer: pace comparison
  if (footer) {
    const expected = (total / daysInMonth) * endDay;
    const actual = cumul[endDay];
    const diff = actual - expected;
    const avgPerDay = endDay > 0 ? actual / endDay : 0;
    let paceHtml;
    if (total === 0) {
      paceHtml = `<span class="exp-daily-pace-label">${t('exp.daily.pace.match').replace('{val}', fmtBRL0(0))}</span>`;
    } else if (Math.abs(diff) < total * 0.02) {
      paceHtml = `<span class="exp-daily-pace-label match">${t('exp.daily.pace.match').replace('{val}', fmtBRL0(avgPerDay))}</span>`;
    } else if (diff > 0) {
      paceHtml = `<span class="exp-daily-pace-label neg">${t('exp.daily.pace.ahead').replace('{val}', fmtBRL0(Math.abs(diff)))}</span>`;
    } else {
      paceHtml = `<span class="exp-daily-pace-label pos">${t('exp.daily.pace.behind').replace('{val}', fmtBRL0(Math.abs(diff)))}</span>`;
    }
    footer.innerHTML = `
      <div class="exp-daily-today">${t('exp.daily.today').replace('{val}', fmtBRL0(actual))}</div>
      ${paceHtml}
    `;
  }
}

// 12-month stacked bar chart by category, ending in viewDate's month.
function renderTrend12m(allExp, viewDate) {
  const svg = $('expTrendChart');
  const legendEl = $('expTrendLegend');
  if (!svg) return;

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), key: `${d.getFullYear()}-${d.getMonth()}` });
  }

  // Group sums by {monthKey, category}
  const byMonth = Object.fromEntries(months.map(m => [m.key, {}]));
  const categoriesSeen = new Set();
  allExp.forEach(e => {
    const d = parseLocalDate(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!byMonth[key]) return;
    const cat = e.category || 'outros';
    byMonth[key][cat] = (byMonth[key][cat] || 0) + (+e.value || 0);
    categoriesSeen.add(cat);
  });

  const monthTotals = months.map(m => Object.values(byMonth[m.key]).reduce((s,v) => s+v, 0));
  const maxTotal = Math.max(1, ...monthTotals);

  // If no history at all, show empty state
  if (monthTotals.every(v => v === 0)) {
    svg.innerHTML = `<text x="350" y="120" text-anchor="middle" fill="var(--ink-muted)" font-size="12" font-family="Inter, sans-serif">${t('exp.trend.empty')}</text>`;
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const W = 700, H = 240, PAD_X = 24, PAD_BOTTOM = 26, PAD_TOP = 12;
  const barGap = 6;
  const slot = (W - PAD_X * 2) / months.length;
  const barW = Math.max(8, slot - barGap);
  const plotH = H - PAD_BOTTOM - PAD_TOP;

  // Category draw order: by total desc (biggest at bottom of stack)
  const catTotals = {};
  categoriesSeen.forEach(c => {
    catTotals[c] = months.reduce((s, m) => s + (byMonth[m.key][c] || 0), 0);
  });
  const orderedCats = [...categoriesSeen].sort((a, b) => catTotals[b] - catTotals[a]);

  // Build bars
  const bars = months.map((m, i) => {
    const x = PAD_X + i * slot + (slot - barW) / 2;
    let y = H - PAD_BOTTOM;
    const total = monthTotals[i];
    const rects = orderedCats.map(cat => {
      const v = byMonth[m.key][cat] || 0;
      if (v <= 0) return '';
      const h = (v / maxTotal) * plotH;
      y -= h;
      const c = CATEGORIES[cat] || CATEGORIES.outros;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${c.color}" opacity="0.78" rx="1.5"><title>${c.label}: ${fmtBRL0(v)}</title></rect>`;
    }).join('');
    // Month label
    const labelY = H - PAD_BOTTOM + 14;
    const isCurrent = m.year === viewDate.getFullYear() && m.month === viewDate.getMonth();
    const monthChar = ['J','F','M','A','M','J','J','A','S','O','N','D'][m.month];
    const labelFill = isCurrent ? 'var(--purple-light)' : 'var(--ink-muted)';
    const labelWeight = isCurrent ? 700 : 500;
    // Total on top of bar (only if visible and not tiny)
    const totalLabel = total > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" fill="var(--ink-3)" font-size="9" font-family="Geist Mono, monospace" opacity="0.7">${shortMoney(total)}</text>` : '';
    return `${rects}${totalLabel}<text x="${(x + barW/2).toFixed(1)}" y="${labelY}" text-anchor="middle" fill="${labelFill}" font-weight="${labelWeight}" font-size="10" font-family="Geist Mono, monospace">${monthChar}</text>`;
  }).join('');

  svg.innerHTML = bars;

  // Legend (only categories that contributed this year)
  if (legendEl) {
    legendEl.innerHTML = orderedCats.map(cat => {
      const c = CATEGORIES[cat] || CATEGORIES.outros;
      return `<span class="exp-trend-legend-item"><span class="swatch" style="background:${c.color}"></span>${c.label}</span>`;
    }).join('');
  }
}

// Top recurring descriptions for the year-to-date of viewDate.
// Normalizes description casing/whitespace, groups, ranks by total spend.
function renderTopRecurring(allExp, viewDate) {
  const listEl = $('expRecList');
  if (!listEl) return;
  const year = viewDate.getFullYear();

  const groups = {};
  allExp.forEach(e => {
    const d = parseLocalDate(e.date);
    if (d.getFullYear() !== year) return;
    const raw = (e.description || '').trim();
    if (!raw) return;
    const key = raw.toLowerCase().replace(/\s+/g, ' ');
    if (!groups[key]) groups[key] = { label: raw, count: 0, total: 0, category: e.category || 'outros' };
    groups[key].count += 1;
    groups[key].total += (+e.value || 0);
  });

  const rows = Object.values(groups)
    .filter(g => g.count >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.recent.title')}</h4><p>${t('exp.rec.empty')}</p></div>`;
    return;
  }

  listEl.innerHTML = rows.map((g, idx) => {
    const c = CATEGORIES[g.category] || CATEGORIES.outros;
    const avg = g.total / g.count;
    return `<div class="exp-rec-row" style="--cat-color:${c.color};--row-delay:${0.05 + idx * 0.04}s">
      <div class="exp-rec-icon">${c.icon}</div>
      <div class="exp-rec-main">
        <div class="exp-rec-desc">${g.label}</div>
        <div class="exp-rec-meta">${t('exp.rec.times').replace('{n}', g.count).replace('{avg}', fmtBRL0(avg))}</div>
      </div>
      <div class="exp-rec-amt">${fmtBRL0(g.total)}</div>
    </div>`;
  }).join('');
}

// Over-budget hero badge: if any category exceeded its monthly limit, surface it.
function updateHeroOverBudgetBadge(monthExp) {
  const alertEl = $('expHeroAlert');
  if (!alertEl) return;
  const budgets = state.budgets || {};
  const byCat = {};
  monthExp.forEach(e => {
    const k = e.category || 'outros';
    byCat[k] = (byCat[k] || 0) + (+e.value || 0);
  });
  const over = Object.entries(budgets).filter(([k, v]) => (byCat[k] || 0) > +v).length;
  if (over === 0 || Object.keys(budgets).length === 0) {
    alertEl.hidden = true;
    alertEl.innerHTML = '';
    return;
  }
  const key = over === 1 ? 'exp.hero.over.one' : 'exp.hero.over';
  alertEl.hidden = false;
  alertEl.innerHTML = `<span class="exp-hero-overbudget">${ICONS.alertTri}${t(key).replace('{n}', over)}</span>`;
}

// ============================================================
//                 EXPENSES - MODAL
// ============================================================
let editingExpenseId = null;
let _modalType = 'expense'; // 'expense' | 'income'
let _modalOwner = 'familia';  // 'william' | 'flavia' | 'louise' | 'familia'
// New "de quem é o gasto" model. Legacy entries used 'joint' (W+F) →
// shown/edited as 'familia' (the shared/household bucket).
const OWNERS = ['william', 'flavia', 'louise', 'familia'];
const normOwner = (o) => (o === 'joint' ? 'familia' : o);

// Map Firebase Auth email → owner slot. William hardcoded; any other
// authenticated user defaults to Flávia (the spouse). 'joint' is a
// manual choice in the modal.
function ownerFromUser(user) {
  const email = (user?.email || '').toLowerCase().trim();
  if (email === KNOWN_PRIMARY_EMAIL) return 'william';
  return 'flavia';
}

function setModalOwner(owner) {
  owner = normOwner(owner);
  _modalOwner = OWNERS.includes(owner) ? owner : 'familia';
  document.querySelectorAll('#expenseModal .exp-owner-opt').forEach(b => {
    const on = b.dataset.owner === _modalOwner;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

let _modalNature = 'variavel';  // 'variavel' | 'fixa' (despesa fixa vs variável)
function setModalNature(nat) {
  _modalNature = nat === 'fixa' ? 'fixa' : 'variavel';
  document.querySelectorAll('#expenseModal .exp-nat-opt').forEach(b => {
    const on = b.dataset.nature === _modalNature;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  // Fixa ⇒ repete todo mês automaticamente (sem checkbox). Mostra só o "até quando" opcional.
  const rf = $('expRepeatField');
  if (rf) rf.hidden = _modalNature !== 'fixa';
}

// Toggle the modal's internal state between expense and income. Swaps
// title/subtitle copy and which of {category, source} fields is visible.
function setModalType(type) {
  _modalType = type === 'income' ? 'income' : 'expense';
  document.querySelectorAll('#expenseModal .exp-type-opt').forEach(b => {
    const on = b.dataset.type === _modalType;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  // Swap category vs source field
  $('expCategoryField').hidden = _modalType === 'income';
  $('expSourceField').hidden = _modalType !== 'income';
  { const _nf = $('expNatureField'); if (_nf) _nf.hidden = _modalType === 'income'; }  // fixa/variável só faz sentido em despesa
  // Ganho enxuto: esconde descrição-texto, de-quem e notas (fica só dropdown + valor + data)
  { const _df = $('expDescField'); if (_df) _df.hidden = _modalType === 'income'; }
  { const _of = $('expOwnerField'); if (_of) _of.hidden = _modalType === 'income'; }
  { const _ntf = $('expNotesField'); if (_ntf) _ntf.hidden = _modalType === 'income'; }
  // Swap title/sub based on new type + edit/create context
  const editing = !!editingExpenseId;
  const titleKey = _modalType === 'income'
    ? (editing ? 'exp.modal.income.edit.title' : 'exp.modal.income.new.title')
    : (editing ? 'exp.modal.edit.title' : 'exp.modal.new.title');
  const subKey = _modalType === 'income'
    ? (editing ? 'exp.modal.income.edit.sub' : 'exp.modal.income.new.sub')
    : (editing ? 'exp.modal.edit.sub' : 'exp.modal.new.sub');
  $('expenseModalTitle').textContent = t(titleKey);
  $('expenseModalSub').textContent = t(subKey);
}

function openExpenseModal(id = null, opts = {}) {
  editingExpenseId = id;
  // reseta o controle de recorrência (setModalNature cuida de mostrar/esconder o bloco)
  if ($('expRepeat')) $('expRepeat').checked = false;
  if ($('expRepeatUntil')) $('expRepeatUntil').value = '';
  if ($('expRepeatUntilWrap')) $('expRepeatUntilWrap').hidden = true;
  const today = new Date();
  if (id) {
    const e = state.expenses.find(x => x.id === id); if (!e) return;
    const type = e.type === 'income' ? 'income' : 'expense';
    setModalType(type);
    setModalOwner(e.owner || 'familia');
    setModalNature(e.nature || 'variavel');
    $('expDesc').value = e.description || '';
    $('expValue').value = fmtBRLInput(e.value);
    $('expDate').value = e.date || '';
    if (type === 'income') $('expSource').value = (INCOME_OPTS.find(o => o.label === e.description) || INCOME_OPTS[0]).val;
    else $('expCategory').value = e.category || 'outros';
    $('expNotes').value = e.notes || '';
    $('expDelete').style.display = '';
  } else {
    // Starting a new entry. `opts.type` overrides default (for '+ Ganho' btn).
    setModalType(opts.type === 'income' ? 'income' : 'expense');
    setModalOwner(ownerFromUser(state.user));
    setModalNature('variavel');
    $('expDesc').value = '';
    $('expValue').value = '';
    $('expDate').value = today.toISOString().split('T')[0];
    $('expCategory').value = 'outros';
    $('expSource').value = INCOME_OPTS[0].val;
    $('expNotes').value = '';
    $('expDelete').style.display = 'none';
  }
  $('expenseModal').classList.add('show');
  setTimeout(() => { const f = (_modalType === 'income' ? $('expSource') : $('expDesc')); if (f) f.focus(); }, 50);
}
function closeExpenseModal() { $('expenseModal').classList.remove('show'); editingExpenseId = null; }

// Editor minimal de uma despesa fixa (clique numa linha "fixa" projetada): muda
// valor / "até quando" ou para de repetir. Modal montado dinamicamente.
function openRecurringEditor(id) {
  const tpl = (state.recurring || []).find(r => r.id === id);
  if (!tpl) return;
  let bg = document.getElementById('recEditPopup');
  if (!bg) {
    bg = document.createElement('div'); bg.id = 'recEditPopup'; bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true" style="max-width:420px">'
      + '<h3>Despesa fixa</h3>'
      + '<p class="sub" id="recEditDesc" style="margin:-4px 0 12px"></p>'
      + '<div class="field full"><label>Valor</label><input type="text" id="recEditVal" inputmode="decimal"></div>'
      + '<div class="field full"><label>Repetir até</label><input type="month" id="recEditEnd"><div class="meta">Em branco = indefinido</div></div>'
      + '<div class="modal-foot">'
      + '<button class="btn-danger ghost" id="recEditDel" type="button">Parar de repetir</button><div class="spacer"></div>'
      + '<button class="btn-secondary" id="recEditCancel" type="button">Cancelar</button><button class="btn-primary" id="recEditSave" type="button">Salvar</button>'
      + '</div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('show'); });
    bg.querySelector('#recEditCancel').addEventListener('click', () => bg.classList.remove('show'));
  }
  bg.querySelector('#recEditDesc').textContent = tpl.desc + (tpl.card ? ' · no cartão' : '') + (tpl.endYM ? ` · até ${tpl.endYM}` : ' · indefinido');
  bg.querySelector('#recEditVal').value = fmtBRLInput(tpl.value);
  bg.querySelector('#recEditEnd').value = tpl.endYM || '';
  bg.querySelector('#recEditSave').onclick = async () => {
    try {
      await setDoc(docRecurring(id), { value: parseBRLInput(bg.querySelector('#recEditVal').value), endYM: (bg.querySelector('#recEditEnd').value || null), updatedAt: serverTimestamp() }, { merge: true });
      bg.classList.remove('show'); showToast('Despesa fixa atualizada');
    } catch (e) { showErrorPopup('Falha ao salvar a recorrência', e); }
  };
  bg.querySelector('#recEditDel').onclick = async () => {
    try { await deleteDoc(docRecurring(id)); bg.classList.remove('show'); showToast('Recorrência removida'); }
    catch (e) { showErrorPopup('Falha ao remover a recorrência', e); }
  };
  bg.classList.add('show');
}

async function saveExpense() {
  const value = parseBRLInput($('expValue').value);
  const date = $('expDate').value;
  let description, category;
  if (_modalType === 'income') {
    const opt = INCOME_OPTS.find(o => o.val === $('expSource').value) || INCOME_OPTS[0];
    description = opt.label; category = opt.source;
  } else {
    description = $('expDesc').value.trim();
    category = $('expCategory').value;
  }
  const notes = $('expNotes').value.trim();
  const type = _modalType;

  if (!description) { showToast(t('exp.toast.err.desc')); return; }
  if (!value || value <= 0) { showToast(t('exp.toast.err.value')); return; }
  if (!date) { showToast(t('exp.toast.err.date')); return; }

  const data = {
    type, description, value, date, category, notes,
    owner: _modalOwner,
    nature: type === 'income' ? null : _modalNature,
    updatedAt: serverTimestamp(),
    updatedBy: state.user?.displayName || 'unknown',
  };
  const btn = $('expSave');
  const originalLabel = t('exp.btn.save');
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    // Despesa FIXA + "repetir todo mês" → cria o template de recorrência e linka o
    // lançamento (recurringId) pra ele não duplicar com a projeção deste mês.
    const editing = editingExpenseId ? (state.expenses || []).find(x => x.id === editingExpenseId) : null;
    if (type === 'expense' && _modalNature === 'fixa' && !(editing && editing.recurringId)) {   // Fixa ⇒ recorrente automático
      const [yy, mm, dd] = date.split('-');
      const isCard = !!(editing && /cart|import/i.test(editing.source || ''));   // cartão herda a chave p/ casar com a fatura
      const tplRef = await addDoc(colRecurring(), {
        desc: description, value, category, owner: _modalOwner, type: 'expense', nature: 'fixa',
        dayOfMonth: +dd || 1, startYM: `${yy}-${mm}`, endYM: ($('expRepeatUntil')?.value || null),
        card: isCard, ruleKey: isCard ? impRuleKey(description) : '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: state.user?.displayName || 'unknown',
      });
      data.recurringId = tplRef.id;
    }
    if (editingExpenseId) {
      await setDoc(docExpense(editingExpenseId), data, { merge: true });
      // Parcelado: propaga de-quem/categoria/descrição/natureza pra TODAS as parcelas da mesma compra.
      const entry = state.expenses.find(x => x.id === editingExpenseId);
      const grp = entry && entry.installment && entry.fpBase ? String(entry.fpBase).replace(/\|\d+\/\d+$/, '') : null;
      const sibs = grp ? (state.expenses || []).filter(e => e.id !== editingExpenseId && e.fpBase && String(e.fpBase).replace(/\|\d+\/\d+$/, '') === grp) : [];
      if (sibs.length) {
        await Promise.allSettled(sibs.map(s => setDoc(docExpense(s.id), { owner: _modalOwner, category, description, nature: _modalNature, updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'unknown' }, { merge: true })));
        showToast(t('exp.toast.cascade').replace('{n}', sibs.length + 1));
      } else {
        showToast(t(type === 'income' ? 'exp.toast.income.saved' : 'exp.toast.saved'));
      }
    } else {
      await addDoc(colExpenses(), { ...data, createdAt: serverTimestamp() });
      showToast(t(type === 'income' ? 'exp.toast.income.added' : 'exp.toast.added'));
    }
    closeExpenseModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = originalLabel; }
}

async function deleteExpense() {
  if (!editingExpenseId) return;
  const entry = state.expenses.find(x => x.id === editingExpenseId);
  const isIncome = entry?.type === 'income';
  openConfirmModal({
    title: t(isIncome ? 'exp.delete.income.title' : 'exp.delete.title'),
    sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'),
    cancelLabel: t('exp.btn.cancel'),
    danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(docExpense(editingExpenseId));
        showToast(t(isIncome ? 'exp.toast.income.deleted' : 'exp.toast.deleted'));
        closeExpenseModal();
      } catch (err) { console.error(err); showToast(t('toast.error.delete')); }
    },
  });
}

// ============================================================
//                   INVESTMENTS MODULE
// ============================================================

// v8 Turno 8 — FX (USD holdings) render + edit
function openFXModal() {
  const modal = document.getElementById('fxModal');
  if (!modal) return;
  document.getElementById('fxModalInput').value = (+state.fx.usd || 0).toString().replace('.', ',');
  const rate = +state.fx.rateUSD || 0;
  document.getElementById('fxModalRate').textContent = rate > 0 ? 'R$ ' + rate.toFixed(2).replace('.', ',') : '—';
  const upd = state.fx.rateUpdatedAt;
  document.getElementById('fxModalRateDate').textContent = upd ? formatDateTimeBR(upd) : '';
  modal.classList.add('show');
}

function closeFXModal() {
  const modal = document.getElementById('fxModal');
  if (modal) modal.classList.remove('show');
}

async function saveFX() {
  const inputEl = document.getElementById('fxModalInput');
  let raw = inputEl ? String(inputEl.value || '') : '';
  // Remove thousand-separator dots, swap comma for dot (pt-BR to JS parseFloat format)
  raw = raw.split('.').join('');
  raw = raw.split(',').join('.');
  raw = raw.trim();
  const usd = parseFloat(raw) || 0;
  await setDoc(docFx, {
    usd,
    note: '',
    updatedBy: state.user?.displayName || 'unknown',
    updatedAt: serverTimestamp(),
  }, { merge: true });
  const m = document.getElementById('fxModal');
  if (m) m.style.display = 'none';
  showToast(t('fx.toast.saved').replace('{v}', usd.toLocaleString('pt-BR')));
}

// v8 Turno 8 — refresh USD-BRL rate from worker (called on main Sync)
// v8 Turno 8 — FX modal event listeners (wired right after saveFX declaration so closures see it)
(function wireFXModal() {
  const _close = () => { const m = document.getElementById('fxModal'); if (m) m.style.display = 'none'; };
  document.getElementById('fxModalClose')?.addEventListener('click', _close);
  document.getElementById('fxModalCancel')?.addEventListener('click', _close);
  document.getElementById('fxModalSave')?.addEventListener('click', () => {
    try { saveFX(); } catch (e) { console.error('saveFX failed:', e); }
  });
  document.getElementById('fxModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'fxModal') _close();
  });
})();

async function fetchFXRate() {
  const workerUrl = state.i10Cfg.workerUrl || '';
  if (!workerUrl) return;
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const r = await fetch(base + '/fx/rate', { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data && data.rateUSD) {
      await setDoc(docFx, {
        rateUSD: data.rateUSD,
        rateSource: data.rateSource || 'awesomeapi-bcb',
        rateUpdatedAt: data.rateUpdatedAt || new Date().toISOString(),
      }, { merge: true });
      console.log('FX rate refreshed \u2713', data.rateUSD);
    }
  } catch (err) {
    console.warn('FX rate refresh failed:', err);
  }
}

// ============================================================
//  MANUAL CASH CATEGORIES (Reserves + Pension)
//  Both follow the same pattern: list of {id, name, value} accounts
//  persisted in Firestore, summed into hero/applied totals.
// ============================================================
const RESERVES_DEFAULTS = [
  { id: 'bradesco', name: 'Bradesco', value: 0 },
  { id: 'xp',       name: 'XP Investimentos', value: 0 },
  { id: 'sicoob',   name: 'Sicoob', value: 0 },
];
const PENSION_DEFAULTS = [
  { id: 'bradesco', name: 'Bradesco', value: 0 },
];

// Per-type config — UI only; data shape is identical.
const CASH_CAT = {
  reserves: {
    docRef: () => docReserves,
    state: () => state.reserves,
    iconClass: 'reserve-icon',
    rowClass: 'reserve-row',
    countColor: '#34e17a',
    rowId: 'reserveRow',
    expId: 'reserveExpanded',
    addBtnId: 'resAddBtn',
    modalId: 'reserveModal',
    modalTitleId: 'reserveModalTitle',
    nameInputId: 'reserveNameInput',
    valueInputId: 'reserveValueInput',
    deleteBtnId: 'reserveDeleteBtn',
    iconSvg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    label: () => t('reserve.label'),
    emptyLabel: () => t('reserve.empty.value'),
    addLabel: () => t('reserve.add'),
    editTitle: () => t('reserve.modal.edit'),
    addTitle: () => t('reserve.modal.add'),
    countSing: () => t('reserve.count.singular'),
    countPlur: () => t('reserve.count.plural'),
  },
  pension: {
    docRef: () => docPension,
    state: () => state.pension,
    iconClass: 'pension-icon',
    rowClass: 'pension-row',
    countColor: '#d8fa72',
    rowId: 'pensionRow',
    expId: 'pensionExpanded',
    addBtnId: 'pensionAddBtn',
    modalId: 'pensionModal',
    modalTitleId: 'pensionModalTitle',
    nameInputId: 'pensionNameInput',
    valueInputId: 'pensionValueInput',
    deleteBtnId: 'pensionDeleteBtn',
    // Leaf icon (lucide leaf)
    iconSvg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-1.5 14.2-8.2 17.04Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>',
    label: () => t('pension.label'),
    emptyLabel: () => t('pension.empty.value'),
    addLabel: () => t('pension.add'),
    editTitle: () => t('pension.modal.edit'),
    addTitle: () => t('pension.modal.add'),
    countSing: () => t('pension.count.singular'),
    countPlur: () => t('pension.count.plural'),
  },
};

function _newCashId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function persistCash(type) {
  const cfg = CASH_CAT[type];
  try {
    await setDoc(cfg.docRef(), {
      accounts: cfg.state().accounts,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    });
  } catch (err) {
    console.error('persistCash(' + type + ') failed:', err);
    showToast(t('toast.error.save'));
  }
}

function openCashModal(type, id) {
  const cfg = CASH_CAT[type];
  const modal = $(cfg.modalId);
  if (!modal) return;
  cfg.state().editingId = id;
  const acc = id ? cfg.state().accounts.find(a => a.id === id) : null;
  $(cfg.modalTitleId).textContent = acc ? cfg.editTitle() : cfg.addTitle();
  $(cfg.nameInputId).value = acc ? (acc.name || '') : '';
  const v = acc ? +acc.value || 0 : 0;
  $(cfg.valueInputId).value = v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  $(cfg.deleteBtnId).style.display = acc ? 'inline-block' : 'none';
  modal.classList.add('show');
  setTimeout(() => $(cfg.nameInputId).focus(), 50);
}

function closeCashModal(type) {
  const cfg = CASH_CAT[type];
  $(cfg.modalId)?.classList.remove('show');
  cfg.state().editingId = null;
}

async function saveCash(type) {
  const cfg = CASH_CAT[type];
  const name = ($(cfg.nameInputId).value || '').trim();
  let raw = String($(cfg.valueInputId).value || '').trim();
  raw = raw.split('.').join('').split(',').join('.');
  const value = parseFloat(raw) || 0;
  if (!name) { showToast(t('cash.toast.name')); return; }
  const id = cfg.state().editingId;
  const accs = cfg.state().accounts;
  if (id) {
    const idx = accs.findIndex(a => a.id === id);
    if (idx >= 0) accs[idx] = { ...accs[idx], name, value };
  } else {
    accs.push({ id: _newCashId(type === 'pension' ? 'p' : 'r'), name, value });
  }
  await persistCash(type);
  closeCashModal(type);
}

async function deleteCash(type) {
  const cfg = CASH_CAT[type];
  const id = cfg.state().editingId;
  if (!id) return;
  openConfirmModal({
    title: type === 'pension' ? t('cash.delete.pension') : t('cash.delete.title'),
    sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'),
    danger: true,
    onConfirm: async () => {
      cfg.state().accounts = cfg.state().accounts.filter(a => a.id !== id);
      await persistCash(type);
      closeCashModal(type);
    },
  });
}

// Render category row + expanded list inside the My Portfolio wrap.
function renderCashRow(type, wrap) {
  if (!wrap) return;
  const cfg = CASH_CAT[type];
  const accs = cfg.state().accounts || [];
  const total = accs.reduce((s, a) => s + (+a.value || 0), 0);
  const usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  const denominator = (+state.i10.equity || 0) + usdBRL + reservesTotal() + pensionTotal();
  const percent = denominator > 0 ? (total / denominator) * 100 : 0;
  const cntLbl = accs.length === 1 ? cfg.countSing() : cfg.countPlur();

  let itemsHtml = '';
  for (const a of accs) {
    const v = +a.value || 0;
    const valHtml = v > 0
      ? '<span class="res-val">R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</span>'
      : '<span class="res-val empty">' + cfg.emptyLabel() + '</span>';
    itemsHtml += '<div class="res-item" data-rid="' + a.id + '">' +
      '<span class="res-name">' + esc(a.name || '-') + '</span>' +
      '<div class="res-actions">' + valHtml +
        '<button class="res-edit" data-rid="' + a.id + '" type="button" aria-label="Edit">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }
  itemsHtml += '<button class="res-add" id="' + cfg.addBtnId + '" type="button">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    cfg.addLabel() +
  '</button>';

  const html =
    '<div class="cat-row ' + cfg.rowClass + ' clickable" id="' + cfg.rowId + '">' +
      '<div class="cat-icon ' + cfg.iconClass + '">' + cfg.iconSvg + '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">' + cfg.label() + '</div>' +
        '<div class="cat-count" style="color:' + cfg.countColor + '">' + accs.length + ' ' + cntLbl + ' &middot; ' + percent.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
      '</div>' +
      '<div><div class="cat-value">R$ ' + total.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div></div>' +
      '<svg class="cat-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</div>' +
    '<div class="reserve-expanded" id="' + cfg.expId + '">' + itemsHtml + '</div>';

  wrap.insertAdjacentHTML('beforeend', html);

  // Wire up
  const row = document.getElementById(cfg.rowId);
  const exp = document.getElementById(cfg.expId);
  row?.addEventListener('click', (e) => {
    if (e.target.closest('.res-edit, .res-add, .res-item')) return;
    row.classList.toggle('expanded');
    exp.classList.toggle('open');
  });
  document.getElementById(cfg.addBtnId)?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCashModal(type, null);
  });
  exp?.querySelectorAll('.res-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCashModal(type, btn.dataset.rid);
    });
  });
}

// Backwards-compat aliases (used by wireReserveModal in HTML wiring)
const renderReservesRow = (wrap) => renderCashRow('reserves', wrap);
const openReserveModal  = (id) => openCashModal('reserves', id);
const closeReserveModal = () => closeCashModal('reserves');
const saveReserve       = () => saveCash('reserves');
const deleteReserve     = () => deleteCash('reserves');

// Wire modals AFTER const declarations above so TDZ doesn't fire on load.
(function wireReserveModal() {
  document.getElementById('reserveModalCancel')?.addEventListener('click', closeReserveModal);
  document.getElementById('reserveModalSave')?.addEventListener('click', () => {
    try { saveReserve(); } catch (e) { console.error('saveReserve failed:', e); }
  });
  document.getElementById('reserveDeleteBtn')?.addEventListener('click', () => {
    try { deleteReserve(); } catch (e) { console.error('deleteReserve failed:', e); }
  });
  document.getElementById('reserveModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reserveModal') closeReserveModal();
  });
})();

(function wirePensionModal() {
  document.getElementById('pensionModalCancel')?.addEventListener('click', () => closeCashModal('pension'));
  document.getElementById('pensionModalSave')?.addEventListener('click', () => {
    try { saveCash('pension'); } catch (e) { console.error('savePension failed:', e); }
  });
  document.getElementById('pensionDeleteBtn')?.addEventListener('click', () => {
    try { deleteCash('pension'); } catch (e) { console.error('deletePension failed:', e); }
  });
  document.getElementById('pensionModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'pensionModal') closeCashModal('pension');
  });
})();

// Botão de minimizar nos cards com header (Investimentos + Despesas).
// Cobre as DUAS estruturas: header dentro de .card-body (carteira/gráficos)
// OU header direto no .card (cards de Despesas). Estado salvo no localStorage.
function wireCardCollapse() {
  document.querySelectorAll('#moduleInvestments .card, #moduleExpenses .card').forEach(function (card) {
    const head = card.querySelector(':scope > .card-body > .card-head') || card.querySelector(':scope > .card-head');
    if (!head) return;                                 // sem header → não recolhível (ikpi, ytd, etc.)
    if (card.classList.contains('exp-g-cat') || card.classList.contains('exp-g-table')) return;  // conteúdo do bento — nunca colapsa (some no layout)
    if (head.querySelector('.card-collapse')) return;  // já tem botão
    const titleEl = head.querySelector('.eyebrow, h3, h2');
    const key = 'cc:' + (((titleEl && titleEl.textContent) || head.textContent || '').trim().slice(0, 28));
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'card-collapse'; btn.setAttribute('aria-label', 'Minimizar');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const on = card.classList.toggle('is-collapsed');
      try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {}   // '0' explícito: expandir também persiste
    });
    let saved = null; try { saved = localStorage.getItem(key); } catch (_) {}
    // Histórico anual começa RECOLHIDO por padrão (pedido do dono) — até a pessoa abrir.
    const _t = (((titleEl && titleEl.textContent) || '')).trim().toLowerCase();
    const defaultCollapsed = _t.startsWith('histórico anual') || _t.startsWith('historico anual') || _t.startsWith('annual history');
    if (saved === '1' || (saved === null && defaultCollapsed)) card.classList.add('is-collapsed');
    head.appendChild(btn);
  });
}
function renderInvestments() {
  const currentYear = new Date().getFullYear();
  const goalYear = state.dividendsYearlyGoalYear;
  const yearsLeft = Math.max(0, goalYear - currentYear);

  // Hero - Patrimônio
  // v8 Turno 8: hero total includes USD converted to BRL
  // + reserves (cash position, no P&L)
  const _usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  const _reservesBRL = reservesTotal();
  const _pensionBRL = pensionTotal();
  const _heroTotal = (+state.i10.equity || 0) + _usdBRL + _reservesBRL + _pensionBRL;
  countUpEl($('i10Equity'), _heroTotal, n => Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));

  // USD equivalent (only shown when we have a valid FX rate)
  const _usdEqEl = $('i10EquityUSD');
  const _usdValEl = $('i10EquityUSDVal');
  if (_usdEqEl && _usdValEl) {
    const rate = +state.fx.rateUSD || 0;
    if (rate > 0 && _heroTotal > 0) {
      const usdEq = _heroTotal / rate;
      _usdValEl.textContent = usdEq.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      _usdEqEl.style.display = 'flex';
    } else {
      _usdEqEl.style.display = 'none';
    }
  }
  if (state.i10.updatedAt) {
    const sourceTag = state.i10.source === 'investidor10-sync' ? ' · via I10' : ' · manual';
    $('i10Updated').textContent = t('hero.updated.prefix') + ' ' + formatDateTimeBR(state.i10.updatedAt) + sourceTag;
  } else {
    $('i10Updated').textContent = t('hero.updated.never');
  }
  // Hero meta row: return pill + applied text
  const subEl = $('i10EquitySub');
  if (subEl) {
    if (state.i10.source === 'investidor10-sync' && state.i10.applied > 0) {
      const ytdDivs = +state.i10.dividends || 0;
      const pastDivs = state.yearly
        .filter(y => y.year < currentYear)
        .reduce((s, y) => s + (+y.divs || 0), 0);
      const totalDivs = ytdDivs + pastDivs;
      // USD holdings + reserves + pension count as both equity AND applied
      const _appliedTotal = (+state.i10.applied || 0) + _usdBRL + _reservesBRL + _pensionBRL;
      const totalReturn = ((_heroTotal - _appliedTotal + totalDivs) / _appliedTotal) * 100;
      const sign = totalReturn >= 0 ? '+' : '';
      const arrow = totalReturn >= 0
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>';
      const pillCls = totalReturn >= 0 ? 'return-pill' : 'return-pill neg';
      subEl.innerHTML = `<div class="${pillCls}">${arrow}${sign}${totalReturn.toFixed(2)}% ${t('hero.return.label')}</div><div class="applied-text">${t('hero.applied')} <b>${fmtBRL0(_appliedTotal)}</b></div>`;
    } else {
      subEl.innerHTML = `<div class="applied-text">${t('hero.manual.full')}</div>`;
    }
  }

  // Hero mini-KPIs + 3 tiles (porte do mockup): Lucro TWR · Dividendos · Variação · Dólar
  const _twr = +state.i10.profitTwr || 0;
  if ($('heroTwr')) $('heroTwr').textContent = (_twr >= 0 ? '+' : '') + _twr.toFixed(1).replace('.', ',') + '%';
  if ($('heroDiv')) $('heroDiv').textContent = fmtBRL0(+state.i10.dividends || 0);
  if ($('heroDivYear')) $('heroDivYear').textContent = currentYear;
  // AUDITORIA jun/2026: o "% no mês" vinha de i10.variation (métrica do I10 com período
  // próprio, não-mensal) — dava "+4,0% no mês" num mês que o Dietz fechava -1,7%.
  // Agora pill e tile usam a MESMA conta do card "rentabilidade mês a mês"
  // (Dietz modificado + proventos) → os números batem em todo o app.
  let _moPct = null;
  try {
    const _mr = computeMonthlyReturns((state.i10.monthly || []).slice(-3), state.contributions || [], state.yearly || []);
    if (_mr.length) _moPct = +_mr[_mr.length - 1].returnPct || 0;
  } catch (_) {}
  const _moTxt = _moPct === null ? null : (_moPct >= 0 ? '+' : '') + _moPct.toFixed(1).replace('.', ',') + '%';
  if ($('heroVar')) {
    $('heroVar').textContent = _moTxt || '—';
    $('heroVar').className = 'ikpi-v ' + ((_moPct || 0) >= 0 ? 'pos' : 'neg');
  }
  const _i10Var = +state.i10.variation || 0;   // métrica crua do I10 fica visível no sub, sem alegar período
  if ($('heroVarSub')) $('heroVarSub').textContent = _i10Var ? ('variação I10: ' + (_i10Var >= 0 ? '+' : '') + _i10Var.toFixed(1).replace('.', ',') + '%') : '';
  const _pill = $('heroMonthPill');
  if (_pill) { if (_moTxt) { _pill.hidden = false; _pill.textContent = _moTxt + ' no mês'; } else _pill.hidden = true; }
  if ($('heroUsd')) $('heroUsd').textContent = 'US$ ' + (+state.fx.usd || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if ($('heroUsdSub')) $('heroUsdSub').textContent = (+state.fx.usd > 0) ? (fmtBRL0(_usdBRL) + ' · cotação ' + (+state.fx.rateUSD || 0).toFixed(2).replace('.', ',')) : '';
  if ($('heroSpark')) sparkPath($('heroSpark'), [12, 18, 15, 24, 30, 28, 36, 42, 46, 54, 60, 66], 400, 150, true);

  // Secondary cards
  $('i10Year').textContent = currentYear;
  $('i10Dividends').textContent = (state.i10.dividends || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const remaining = Math.max(0, state.dividendsYearlyGoal - (state.i10.dividends || 0));
  $('goalRemaining').textContent = remaining.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  $('goalYearsLeft').textContent = yearsLeft;

  // Progress
  const progress = state.dividendsYearlyGoal > 0
    ? ((state.i10.dividends || 0) / state.dividendsYearlyGoal) * 100
    : 0;
  $('progressPct').textContent = progress.toFixed(1) + '%';
  $('progressSub').textContent = `${fmtBRL0(state.i10.dividends || 0)} de ${fmtBRL0(state.dividendsYearlyGoal)}`;

  // History years count
  $('historyYears').textContent = state.yearly.length;

  // PL total growth (2020 → current)
  const sortedYearly = [...state.yearly].filter(y => y.equity != null).sort((a,b) => a.year - b.year);
  if (sortedYearly.length >= 2) {
    const first = sortedYearly[0];
    const lastEquity = state.i10.equity > 0 ? state.i10.equity : (sortedYearly[sortedYearly.length-1].equity || 0);
    const yearsSpan = currentYear - first.year;
    if (first.equity > 0 && yearsSpan > 0) {
      const totalGrowth = ((lastEquity - first.equity) / first.equity) * 100;
      const cagr = (Math.pow(lastEquity / first.equity, 1 / yearsSpan) - 1) * 100;
      $('plTotalGrowth').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
      $('plCagr').textContent = `${cagr.toFixed(1)}%/ano`;
      $('plSinceFirst').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
      $('plCagrPill').textContent = cagr.toFixed(1) + '% /ano';
    }
  } else {
    $('plTotalGrowth').textContent = '-';
    $('plCagr').textContent = '-';
    $('plSinceFirst').textContent = '-';
    $('plCagrPill').textContent = '-';
  }

  // All-time dividends = soma dos anos passados (dividendsYearly, que
  // exclui o ano corrente) + os proventos YTD do ano corrente (vêm do
  // sync I10 em state.i10.dividends). Filtra o ano corrente do
  // dividendsYearly pra não contar em dobro caso alguém tenha cadastrado
  // o ano corrente manualmente.
  const pastDivs = state.yearly
    .filter(y => +y.year < currentYear)
    .reduce((s, y) => s + (+y.divs || 0), 0);
  const allTime = pastDivs + (+state.i10.dividends || 0);
  // Pair element already has a static <span class="cur">R$</span> sibling
  // in the HTML, so we render just the number here (matches i10Dividends).
  $('divAllTime').textContent = (allTime || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  // YTD progress bar (% of yearly goal)
  const ytdProgressEl = document.getElementById('ytdProgressBar');
  if (ytdProgressEl) {
    const pct = state.dividendsYearlyGoal > 0
      ? Math.min(100, ((state.i10.dividends || 0) / state.dividendsYearlyGoal) * 100)
      : 0;
    ytdProgressEl.style.width = pct.toFixed(1) + '%';
  }

  // All-time sub: "desde 2020 - X anos de historico"
  const allTimeSubEl = document.getElementById('divAllTimeSub');
  if (allTimeSubEl) {
    if (sortedYearly.length > 0) {
      const firstYear = sortedYearly[0].year;
      const yearsCount = sortedYearly.length;
      const yLabel = yearsCount === 1 ? t('years.singular') : t('years.plural');
      allTimeSubEl.textContent = t('ytd.alltime.from')
        .replace('{year}', firstYear)
        .replace('{n}', yearsCount)
        .replace('{label}', yLabel);
    } else {
      allTimeSubEl.textContent = t('ytd.alltime.empty');
    }
  }

  // All-time progress bar (proporcional ao valor recebido vs uma meta acumulada simbolica)
  const allTimeProgressEl = document.getElementById('allTimeProgressBar');
  if (allTimeProgressEl) {
    // 35% como visual fixo - representa "progresso da jornada"
    const accumGoal = state.dividendsYearlyGoal * 5; // 5x meta anual como referencia visual
    const pct = accumGoal > 0 ? Math.min(100, (allTime / accumGoal) * 100) : 0;
    allTimeProgressEl.style.width = pct.toFixed(1) + '%';
  }

  // Carteira count: "X ativos · Y categorias"
  const countEl = document.getElementById('i10AssetsCount');
  if (countEl) {
    const assets = state.i10.assets || [];
    if (assets.length === 0) {
      countEl.textContent = t('count.assets.none');
    } else {
      const cats = new Set(assets.map(a => inferCategory(a)));
      const aLbl = assets.length === 1 ? t('count.assets.singular') : t('count.assets.plural');
      const cLbl = cats.size === 1 ? t('count.cat.singular') : t('count.cat.plural');
      countEl.textContent = `${assets.length} ${aLbl} · ${cats.size} ${cLbl}`;
    }
  }

  // Pills
  $('divGoalPill').textContent = 'R$ 1M até ' + goalYear;
  $('divYearsLeft').textContent = yearsLeft + (yearsLeft === 1 ? ' ano' : ' anos');
  $('divProgress').textContent = progress.toFixed(1) + '%';

  renderDividendsChart();
  renderPLChart();
  renderYearlyTable();
  renderI10Assets();
  renderMonthlyReturns();
  renderContributions();
  // Fileira de KPIs (reservas · previdência · aportes do ano · aplicado)
  const _contribYear = (state.contributions || []).reduce((s, c) => s + ((+c.year === currentYear) ? (+c.amount || 0) : 0), 0);
  if ($('kpiReserves')) $('kpiReserves').textContent = fmtBRL0(_reservesBRL);
  if ($('kpiPension')) $('kpiPension').textContent = fmtBRL0(_pensionBRL);
  if ($('kpiContrib')) $('kpiContrib').textContent = fmtBRL0(_contribYear);
  if ($('kpiContribLbl')) $('kpiContribLbl').textContent = (getLang() === 'en' ? 'Contributions ' : 'Aportes ') + currentYear;
  if ($('kpiApplied')) $('kpiApplied').textContent = fmtBRL0(+state.i10.applied || 0);
  if (typeof renderMetas === 'function') renderMetas();
  wireCardCollapse();
}

// v8 Turno 6 — Bar chart range state (1Y / 5Y / All)
window.chartRange = window.chartRange || '5Y';
function filterByRange(years, values, range) {
  if (range === 'All') return { years, values };
  if (range === '1Y') {
    const n = years.length;
    return n > 0 ? { years: [years[n-1]], values: [values[n-1]] } : { years: [], values: [] };
  }
  const N = 5;
  if (years.length <= N) return { years, values };
  return { years: years.slice(-N), values: values.slice(-N) };
}

function buildBarChart(years, values, opts = {}) {
  // Mobile detection: narrower viewBox + bigger fonts so text stays readable when scaled to ~360px
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  const W = isMobile ? 500 : 780;
  const H = isMobile ? 320 : 260;
  const padL = isMobile ? 50 : 56;
  const padR = isMobile ? 16 : 24;
  const padT = isMobile ? 50 : 42;
  const padB = isMobile ? 44 : 38;
  const fsAxis = isMobile ? 16 : 13;       // y-axis labels (maior — pedido do usuário)
  const fsYear = isMobile ? 17 : 14;       // year labels under bars
  const fsValue = isMobile ? 15 : 14;      // value labels above bars
  const fsPill = isMobile ? 13 : 12.5;     // YoY pill text
  const pillH = isMobile ? 22 : 19;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  if (!years.length) {
    return '<div class="chart-empty"><b>sem dados ainda</b>adicione anos no historico para ver o grafico</div>';
  }
  const maxData = Math.max(...values, 0);
  const yMax = (maxData > 0 ? maxData * 1.18 : 1);
  const barSlot = innerW / years.length;
  const barWidth = Math.min(barSlot * 0.55, isMobile ? 44 : 38);
  const currentYearActual = new Date().getFullYear();
  const gradId = opts.gradId || 'barGradPurple';
  const gradIdCurrent = opts.gradIdCurrent || 'barGradPink';
  const uniqueId = Math.random().toString(36).substr(2, 6);
  const gid = gradId + uniqueId;
  const gidC = gradIdCurrent + uniqueId;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto;max-width:100%">';
  svg += '<defs>';
  svg += '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">';
  // DS audit QW-5: paleta lime via tokens (era roxa pré-rebrand) — var() em SVG inline
  // herda do tema, então o light (esmeralda) já vem certo de graça.
  svg += '<stop offset="0%" stop-color="var(--purple-deep)" stop-opacity="0.80"/>';
  svg += '<stop offset="100%" stop-color="var(--purple-deep)" stop-opacity="0.40"/>';
  svg += '</linearGradient>';
  svg += '<linearGradient id="' + gidC + '" x1="0" y1="0" x2="0" y2="1">';
  svg += '<stop offset="0%" stop-color="var(--purple)" stop-opacity="1"/>';
  svg += '<stop offset="100%" stop-color="var(--purple-deep)" stop-opacity="0.75"/>';
  svg += '</linearGradient>';
  svg += '<filter id="glowB' + uniqueId + '" x="-50%" y="-50%" width="200%" height="200%">';
  svg += '<feGaussianBlur stdDeviation="3" result="b"/>';
  svg += '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  svg += '</filter>';
  svg += '</defs>';

  // Grid horizontal
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i / 4);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 4"/>';
    const val = yMax * (4 - i) / 4;
    svg += '<text x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--ink-3)" font-family="Geist Mono, monospace" font-size="' + fsAxis + '" font-weight="600">' + shortMoney(val) + '</text>';
  }

  // Bars
  years.forEach((y, i) => {
    const v = values[i] || 0;
    if (v <= 0) {
      // Empty year - draw label only
      const x = padL + barSlot * i + barSlot / 2;
      svg += '<text x="' + x + '" y="' + (H - 14) + '" text-anchor="middle" fill="var(--ink-muted)" font-family="Geist Mono, monospace" font-size="' + fsYear + '" font-weight="600">' + y + '</text>';
      return;
    }
    const barH = (v / yMax) * innerH;
    const x = padL + barSlot * i + (barSlot - barWidth) / 2;
    const barY = padT + innerH - barH;
    const isCurrent = y === currentYearActual;
    const fillUrl = isCurrent ? 'url(#' + gidC + ')' : 'url(#' + gid + ')';
    const yearColor = isCurrent ? 'var(--purple)' : 'var(--ink-3)';
    const yearWeight = isCurrent ? '700' : '600';
    const yearLabel = isCurrent ? y + '*' : String(y);

    svg += '<rect x="' + x + '" y="' + barY + '" width="' + barWidth + '" height="' + barH + '" rx="5" fill="' + fillUrl + '"' + (isCurrent ? ' filter="url(#glowB' + uniqueId + ')"' : '') + '><title>' + y + ': ' + fmtBRL0(v) + '</title></rect>';
    // Value label above bar
    const valColor = isCurrent ? 'var(--ink)' : 'var(--ink-2)';
    svg += '<text x="' + (x + barWidth / 2) + '" y="' + (barY - (isMobile ? 10 : 6)) + '" text-anchor="middle" fill="' + valColor + '" font-family="Geist Mono, monospace" font-size="' + fsValue + '" font-weight="700">' + shortMoney(v) + '</text>';
    // Year label below
    svg += '<text x="' + (x + barWidth / 2) + '" y="' + (H - 14) + '" text-anchor="middle" fill="' + yearColor + '" font-family="Geist Mono, monospace" font-size="' + fsYear + '" font-weight="' + yearWeight + '">' + yearLabel + '</text>';
  });

  // ========================================================
  // YoY indicators - mode 'pills' or 'line'
  // ========================================================
  const yoyMode = opts.yoyMode || 'none';
  if (yoyMode !== 'none' && years.length >= 2) {
    // Compute bar centers and tops for pairs where both values > 0
    const points = [];
    for (let i = 0; i < years.length; i++) {
      const v = values[i] || 0;
      if (v <= 0) { points.push(null); continue; }
      const barH = (v / yMax) * innerH;
      const cx = padL + barSlot * i + barSlot / 2;
      const top = padT + innerH - barH;
      points.push({ cx, top, v, year: years[i] });
    }

    if (yoyMode === 'pills') {
      // v8 Turno 9 — Option C: dashed connector between bar tops + opaque pill in middle
      const firstVisibleIdx = opts.firstYoYIdx ?? 1;
      for (let i = firstVisibleIdx; i < points.length; i++) {
        const prev = points[i-1], cur = points[i];
        if (!prev || !cur || prev.v <= 0) continue;
        const yoy = ((cur.v - prev.v) / prev.v) * 100;
        if (!isFinite(yoy) || Math.abs(yoy) > 1000) continue;
        const sign = yoy >= 0 ? '+' : '';
        const txt = sign + yoy.toFixed(0) + '%';
        // v8 color: green <100%, amber >100%, red negative
        let bg, strokeCol;
        if (yoy < 0) { bg = 'var(--loss)'; strokeCol = 'var(--loss)'; }
        else if (yoy > 100) { bg = 'var(--warn)'; strokeCol = 'var(--warn)'; }
        else { bg = 'var(--gain)'; strokeCol = 'var(--gain)'; }
        // Dashed connector line between the two bar tops (from right edge of prev to left edge of cur)
        const prevRight = prev.cx + barWidth / 2;
        const curLeft = cur.cx - barWidth / 2;
        svg += '<line x1="' + prevRight + '" y1="' + prev.top + '" x2="' + curLeft + '" y2="' + cur.top + '" stroke="rgba(199,247,62,.35)" stroke-width="1.5" stroke-dasharray="2 3"/>';
        // Pill centered on midpoint of the connector, opaque fill
        const midX = (prev.cx + cur.cx) / 2;
        const midY = (prev.top + cur.top) / 2;
        const pillW = txt.length * (isMobile ? 8 : 8) + (isMobile ? 14 : 13);
        const pillTop = midY - pillH / 2;
        svg += '<g><rect x="' + (midX - pillW/2) + '" y="' + pillTop + '" width="' + pillW + '" height="' + pillH + '" rx="' + (pillH/2) + '" fill="' + bg + '" stroke="' + strokeCol + '" stroke-opacity="0.35" stroke-width="1"/>';
        svg += '<text x="' + midX + '" y="' + (pillTop + pillH * 0.72) + '" text-anchor="middle" fill="var(--on-accent)" font-family="Geist Mono, monospace" font-size="' + fsPill + '" font-weight="700">' + txt + '</text></g>';
      }
    } else if (yoyMode === 'line') {
      // Connected polyline over bar tops + dots
      const valid = points.filter(p => p !== null);
      if (valid.length >= 2) {
        const linePts = valid.map(p => p.cx + ',' + p.top).join(' ');
        svg += '<polyline points="' + linePts + '" fill="none" stroke="var(--purple-light)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>';
        for (const p of valid) {
          svg += '<circle cx="' + p.cx + '" cy="' + p.top + '" r="4" fill="var(--purple-light)" stroke="var(--bg-elevated)" stroke-width="2"/>';
        }
        // Show YoY % only on top 3 highest growths to avoid clutter
        const yoys = [];
        for (let i = 1; i < valid.length; i++) {
          const yoy = ((valid[i].v - valid[i-1].v) / valid[i-1].v) * 100;
          yoys.push({ idx: i, yoy, p: valid[i] });
        }
        yoys.sort((a, b) => Math.abs(b.yoy) - Math.abs(a.yoy));
        const topYoys = yoys.slice(0, 3);
        for (const y of topYoys) {
          const sign = y.yoy >= 0 ? '+' : '';
          const col = y.yoy >= 0 ? 'var(--gain)' : 'var(--loss)';
          svg += '<text x="' + y.p.cx + '" y="' + (y.p.top - 10) + '" text-anchor="middle" fill="' + col + '" font-family="Geist Mono, monospace" font-size="' + fsValue + '" font-weight="700">' + sign + y.yoy.toFixed(0) + '%</text>';
        }
      }
    }
  }

  svg += '</svg>';
  return '<div style="width:100%;overflow:visible">' + svg + '</div>';
}

function renderDividendsChart() {
  const wrap = $('divChartWrap');
  if (!wrap) return;
  const currentYear = new Date().getFullYear();
  // Only show YEARS WITH DATA (history) + current year YTD if there's i10 sync
  const histYears = [...state.yearly]
    .filter(y => Number.isFinite(+y.year) && (+y.divs || 0) > 0)
    .sort((a, b) => a.year - b.year);

  const years = histYears.map(y => y.year);
  const values = histYears.map(y => +y.divs || 0);

  // Add current year (YTD) if not in history yet and has value
  if (!years.includes(currentYear) && (state.i10.dividends || 0) > 0) {
    years.push(currentYear);
    values.push(+state.i10.dividends || 0);
  }

  // Need at least 1 year
  if (years.length === 0) {
    wrap.innerHTML = '<div class="chart-empty"><b>sem historico ainda</b>sincronize com I10 ou adicione anos manualmente</div>';
    return;
  }

  // v8 Turno 6: apply range filter before drawing
  const _filtered = filterByRange(years, values, window.chartRange || '5Y');
  wrap.innerHTML = buildBarChart(_filtered.years, _filtered.values, { yoyMode: 'pills', firstYoYIdx: 1 });
}

// Patrimônio (net worth) de fim de ano — fonte canônica dos anos antigos.
// A API do I10 NÃO expõe equity histórico pra carteira nova (2814459):
// /i10/yearly devolve equity:null em todo ano (confirmado). Esses são os
// valores reais do histórico do William, embutidos aqui pra serem
// resilientes: nenhum sync/import consegue apagá-los (o Firestore só é
// usado se tiver um valor > 0, então edições manuais ainda têm prioridade).
// Pra ajustar um ano: editar pelo botão "+ Year" no app (vence este mapa).
// Valores REAIS de fim de ano (dezembro) extraídos do barchart do I10
// (/summary/barchart/2814459/120/all, sum_equity do mês 12 de cada ano).
// Fallback caso o Firestore esteja vazio — mas o ideal é o "I10" import
// gravar esses mesmos números (o worker já puxa o barchart de 120 meses).
const HISTORICAL_EQUITY = {
  2020: 21175,
  2021: 64175,
  2022: 66339,
  2023: 293344,
  2024: 612610,
  2025: 1260018,
};
// Year-end equity DERIVED live from the I10 barchart (state.i10.monthly):
// the latest month seen for a given year (Dec, or the most recent). When
// /i10/all returns the long (120-month) barchart, this covers every year
// straight from I10 — no Firestore write, nothing to wipe.
function derivedYearEndEquity(year) {
  const m = state.i10.monthly || [];
  let best = null;
  for (const row of m) {
    if (+row.year === +year && (!best || +row.month > +best.month)) best = row;
  }
  return best ? (+best.equity || 0) : 0;
}
// Resolve year-end equity with precedence:
//   1. manual Firestore value (user edited via "+ Year") — always wins
//   2. live value derived from the I10 barchart
//   3. hardcoded historical fallback (offline / I10 unreachable)
function yearEquity(y) {
  const fs = +y.equity;
  if (Number.isFinite(fs) && fs > 0) return fs;
  const d = derivedYearEndEquity(+y.year);
  if (d > 0) return d;
  return HISTORICAL_EQUITY[+y.year] || 0;
}

function renderPLChart() {
  const wrap = $('plChartWrap');
  if (!wrap) return;
  const currentYear = new Date().getFullYear();
  const sortedYearly = [...state.yearly]
    .map(y => ({ ...y, _eq: yearEquity(y) }))
    .filter(y => Number.isFinite(+y.year) && y._eq > 0)
    .sort((a, b) => a.year - b.year);

  if (sortedYearly.length === 0 && (!state.i10.equity || state.i10.equity <= 0)) {
    wrap.innerHTML = '<div class="chart-empty"><b>sem historico de PL</b>sincronize com I10 para ver a evolucao</div>';
    return;
  }

  const years = sortedYearly.map(y => y.year);
  const values = sortedYearly.map(y => y._eq);

  // Add or override current year with i10 value (always fresher)
  const hasCurrent = years.includes(currentYear);
  if (!hasCurrent && state.i10.equity > 0) {
    years.push(currentYear);
    values.push(state.i10.equity);
  } else if (hasCurrent && state.i10.equity > 0) {
    const idx = years.indexOf(currentYear);
    values[idx] = state.i10.equity;
  }

  // v8 Turno 6: apply range filter before drawing
  const _filtered = filterByRange(years, values, window.chartRange || '5Y');
  wrap.innerHTML = buildBarChart(_filtered.years, _filtered.values, { yoyMode: 'pills', firstYoYIdx: 1 });
}

function renderYearlyTable() {
  const tbody = $('yearlyBody');
  const sorted = [...state.yearly].sort((a,b) => (a.year||0) - (b.year||0));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-table"><h4>No yearly data</h4><p>Click "+ Year" to add your first year.</p></div></td></tr>`;
    return;
  }
  // v8 Turno 4: compact values (64,2K / 1,34M) + sanitized YoY (>1000% → —)
  const compact = (n) => {
    const abs = Math.abs(n || 0);
    if (abs >= 1_000_000) return (n/1_000_000).toFixed(2).replace('.', ',') + 'M';
    if (abs >= 1_000)     return (n/1_000).toFixed(1).replace('.', ',') + 'K';
    return String(Math.round(n || 0));
  };
  tbody.innerHTML = sorted.map((y, i) => {
    const eq = yearEquity(y); // Firestore value if present, else historical fallback
    const dy = (eq > 0) ? ((+y.divs / eq) * 100).toFixed(1) + '%' : '—';
    let yoy = '—';
    if (i > 0) {
      const prev = +sorted[i-1].divs || 0;
      if (prev > 0) {
        const growth = (((+y.divs || 0) - prev) / prev) * 100;
        if (isFinite(growth) && Math.abs(growth) <= 1000) {
          yoy = (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%';
        }
      }
    }
    const yoyClass = yoy.startsWith('+') ? 'pos' : (yoy.startsWith('-') ? 'neg' : '');
    return `<tr data-id="${y.id}"><td>${y.year}</td><td>${compact(eq)}</td><td>${compact(+y.divs||0)}</td><td>${dy}</td><td class="${yoyClass}">${yoy}</td></tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openYearlyModal(tr.dataset.id)));
}

// ============================================================
//                I10 AUTO-SYNC (via Cloudflare Worker)
// ============================================================
// ============================================================
//  Categoria inference (Brazilian market)
// ============================================================
const FII_WHITELIST = new Set([
  'HGLG11','MXRF11','KNRI11','XPLG11','BCFF11','VISC11','HGRE11','KNCR11','VRTA11','BTLG11',
  'IRDM11','RBRR11','RECT11','HGRU11','RZAK11','HFOF11','BBPO11','PVBI11','HGCR11','DEVA11',
  'KNHY11','MALL11','BTCR11','RBRF11','KFOF11','RBRP11','GGRC11','JSRE11','TRXF11','VINO11',
  'XPML11','RBVA11','VGIR11','XPCI11','HGBS11','VILG11','MGFF11','ALZR11','HSML11','PATC11',
  'CPTS11','MFII11','RVBI11','RBED11','RZTR11','HABT11','RCRB11','MCCI11','BPFF11','XPIN11',
  'OUJP11','BARI11','RBRY11','VGHF11','URPR11','VIUR11','VIFI11','LVBI11','SARE11','PORD11',
]);

const ETF_BR_WHITELIST = new Set([
  'BOVA11','SMAL11','BOVV11','XBOV11','DIVO11','ECOO11','PIBB11','FIND11','GOVE11','ISUS11',
  'MATB11','MOBI11','SMAC11','BBSD11','HASH11','BDIF11','BRAX11','SPXB11','XINA11',
]);

const ETF_INTL_WHITELIST = new Set([
  'IVVB11','SPXI11','NASD11','ACWI11','EURP11','ASIA11','GOLD11','WRLD11','XFIX11','ASHR11',
]);

const CRYPTO_WHITELIST = new Set([
  'BTC','ETH','SOL','ADA','XRP','BNB','DOGE','MATIC','DOT','LINK','LTC','BCH','XLM','TRX',
  'UNI','ATOM','AVAX','NEAR','SHIB','PEPE','BTC11','ETHE11','BITH11',
]);

// Map ticker -> category populated from /i10/diversification (real data from I10)
let _i10TickerCategory = {};

function inferCategory(asset) {
  // 1. trust explicit field if present
  if (asset.category) return asset.category;
  if (asset.type) return asset.type;

  const t = (asset.ticker || '').toUpperCase().trim();
  if (!t) return 'Outros';

  // 2. use real category from /i10/diversification if available
  if (_i10TickerCategory[t]) return _i10TickerCategory[t];

  // 3. fallback regex/whitelist
  if (CRYPTO_WHITELIST.has(t) || /^(BTC|ETH)/.test(t)) return 'Criptomoedas';
  if (/^TESOURO|^LFT|^LTN|^NTN/.test(t)) return 'Tesouro Direto';
  if (ETF_INTL_WHITELIST.has(t)) return 'ETFs Internacionais';
  if (ETF_BR_WHITELIST.has(t)) return 'ETFs Brasil';
  if (FII_WHITELIST.has(t)) return 'FIIs';
  if (/CDB|LCI|LCA|DEBENT/.test(t)) return 'Renda Fixa';
  if (/FIA$|FIM$|FIC$|FUNDO/.test(t)) return 'Fundos de Investimento';

  // Default for stock-like patterns (XXXX3, XXXX4, XXXX11 unknown)
  if (/^[A-Z]{4}[0-9]{1,2}$/.test(t)) return 'Acoes';

  return 'Outros';
}

const CATEGORY_ORDER = ['Acoes','FIIs','Renda Fixa','Tesouro Direto','Fundos de Investimento','ETFs Brasil','ETFs Internacionais','BDRs','Criptomoedas','Outros'];

// Normalize any category label (from I10_TYPE_TO_CAT, inferCategory, legacy
// data, accented or not) to a canonical CATEGORY_ICONS/_DISPLAY/_ORDER key.
function canonicalCategory(label) {
  const s = (label || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents
  if (!s) return 'Outros';
  if (/internacion/.test(s)) return 'ETFs Internacionais';
  if (/etf/.test(s)) return 'ETFs Brasil';
  if (/fii|imobiliar/.test(s)) return 'FIIs';
  if (/tesouro/.test(s)) return 'Tesouro Direto';
  if (/renda\s*fixa|cdb|lci|lca|debent|fixed/.test(s)) return 'Renda Fixa';
  if (/cripto|crypto|bitcoin|btc/.test(s)) return 'Criptomoedas';
  if (/bdr/.test(s)) return 'BDRs';
  if (/fundo|fund/.test(s)) return 'Fundos de Investimento';
  if (/aco|acao|acoes|stock|ticker|^acoes$/.test(s)) return 'Acoes';
  return 'Outros';
}

const CATEGORY_ICONS = {
  'Acoes':                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><polyline points="7 14 11 10 15 14 19 10"/></svg>',
  'FIIs':                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>',
  'Renda Fixa':              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="9" y2="15"/></svg>',
  'Tesouro Direto':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 5v8l-8 5-8-5V8z"/><path d="M12 3v18"/></svg>',
  'Fundos de Investimento':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  'ETFs Brasil':             '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  'ETFs Internacionais':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  'Criptomoedas':            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 8h4.5a2.5 2.5 0 0 1 0 5H9V8zm0 5h5a2.5 2.5 0 0 1 0 5H9v-5z"/></svg>',
  'BDRs':                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10"/><path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/></svg>',
  'Outros':                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

const CATEGORY_DISPLAY = {
  'Acoes': 'Acoes',
  'FIIs': 'FIIs',
  'Renda Fixa': 'Renda Fixa',
  'Tesouro Direto': 'Tesouro Direto',
  'Fundos de Investimento': 'Fundos de Invest.',
  'ETFs Brasil': 'ETFs Brasil',
  'ETFs Internacionais': 'ETFs Intern.',
  'Criptomoedas': 'Criptomoedas',
  'BDRs': 'BDRs',
  'Outros': 'Outros',
};

let _expandedCats = new Set(['Acoes']); // Acoes expanded by default

// Donut de diversificação (igual mockup) — segmentos por categoria.
const INV_DONUT_PALETTE = ['#0a84ff', '#c7f73e', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff6b61', '#4fdd8a', '#ffd60a', '#5e5ce6'];
function renderInvDonut(sortedKeys, groups, assetsTotal) {
  const svg = $('invDonut'), leg = $('invDonutLeg');
  if (!svg || !leg) return;
  if (!assetsTotal || !sortedKeys.length) { svg.innerHTML = ''; leg.innerHTML = ''; return; }
  let cum = 0;
  let segs = '<circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--bg-elevated-2)" stroke-width="5"/>';
  let legHtml = '';
  sortedKeys.forEach((key, i) => {
    const pct = (groups[key].value / assetsTotal) * 100;
    if (pct <= 0) return;
    const color = INV_DONUT_PALETTE[i % INV_DONUT_PALETTE.length];
    segs += '<circle cx="21" cy="21" r="15.9" fill="none" stroke="' + color + '" stroke-width="5" stroke-dasharray="' + pct.toFixed(1) + ' ' + (100 - pct).toFixed(1) + '" stroke-dashoffset="' + (25 - cum).toFixed(1) + '" transform="rotate(-90 21 21)"/>';
    cum += pct;
    const _ic = t('inv.cat.' + key); const label = (_ic !== 'inv.cat.' + key) ? _ic : (CATEGORY_DISPLAY[key] || key);
    legHtml += '<div class="it"><span class="dot" style="background:' + color + '"></span><span class="nm">' + esc(label) + '</span><span class="pc">' + pct.toFixed(0) + '%</span></div>';
  });
  svg.innerHTML = segs;
  leg.innerHTML = legHtml;
}
// Maiores posições (igual mockup) — top 6 ativos por patrimônio.
function renderInvTopAssets(assets) {
  const list = $('invTopList');
  if (!list) return;
  const top = [...(assets || [])].sort((a, b) => (+b.equity || 0) - (+a.equity || 0)).slice(0, 6);
  if (!top.length) { list.innerHTML = '<div style="padding:18px 4px;color:var(--ink-3);font-size:13px">Sincronize a carteira pra ver as posições.</div>'; return; }
  list.innerHTML = top.map(a => {
    const appr = +a.appreciation || 0;
    const cls = appr >= 0 ? 'pos' : 'neg';
    const tk = esc(String(a.ticker || '—').slice(0, 4));
    const qty = +a.quantity || 0, pm = +a.avgPrice || 0;
    const q = qty ? (qty.toLocaleString('pt-BR') + ' · PM ' + pm.toFixed(2).replace('.', ',')) : '';
    return '<div class="inv-asset"><div class="inv-tk">' + tk + '</div><div class="inv-asset-mid"><div class="inv-asset-nm">' + esc(a.ticker || '—') + '</div><div class="inv-asset-q">' + q + '</div></div><div class="inv-asset-rt"><div class="inv-asset-val">' + fmtBRL0(+a.equity || 0) + '</div><div class="inv-asset-chg ' + cls + '">' + (appr >= 0 ? '+' : '') + appr.toFixed(1) + '%</div></div></div>';
  }).join('');
}
function renderI10Assets() {
  const wrap = $('i10AssetsList');
  if (!wrap) return;
  const assets = state.i10.assets || [];

  if (assets.length === 0) {
    wrap.innerHTML = '<div style="padding:30px 10px;color:var(--ink-muted);text-align:center;font-size:13px"><b style="color:var(--ink-2);display:block;margin-bottom:6px">Nenhum ativo sincronizado</b>Clique em "Sincronizar" pra importar sua carteira do Investidor 10.</div>';
    // Still append USD/reserves/pension below.
  }

  // Group every asset by its canonical category (derived from the
  // per-asset `.category` set in syncFromI10). This no longer depends on
  // the absent `diversification` payload — it works straight off the
  // assets list, so all classes (Ações, Tesouro, FIIs, ETFs, etc.) show.
  const groups = {}; // canonKey -> { value, items: [] }
  let assetsTotal = 0;
  assets.forEach(a => {
    const key = canonicalCategory(a.category);
    if (!groups[key]) groups[key] = { value: 0, items: [] };
    const eq = +a.equity || 0;
    groups[key].value += eq;
    groups[key].items.push(a);
    assetsTotal += eq;
  });

  const sortedKeys = Object.keys(groups).sort((ka, kb) => {
    const ia = CATEGORY_ORDER.indexOf(ka);
    const ib = CATEGORY_ORDER.indexOf(kb);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return groups[kb].value - groups[ka].value;
  });

  // Carteira A: categorias minúsculas (<1% cada) agrupadas numa linha só
  // ("Outros + ETFs + Cripto"). O donut continua com as fatias reais — só a lista agrupa.
  const labelFor = (key) => { const _ic = t('inv.cat.' + key); return (_ic !== 'inv.cat.' + key) ? _ic : (CATEGORY_DISPLAY[key] || key); };
  const tailKeys = assetsTotal > 0 ? sortedKeys.filter(k => (groups[k].value / assetsTotal) * 100 < 1) : [];
  const rowGroups = Object.assign({}, groups);
  let rowKeys = sortedKeys;
  if (tailKeys.length >= 2) {
    rowGroups['_tail'] = {
      value: tailKeys.reduce((s, k) => s + groups[k].value, 0),
      items: tailKeys.flatMap(k => groups[k].items),
      label: tailKeys.map(labelFor).join(' + '),
    };
    rowKeys = sortedKeys.filter(k => !tailKeys.includes(k)).concat('_tail');
  }

  const html = rowKeys.map(key => {
    const g = rowGroups[key];
    const label = g.label || labelFor(key);
    const icon = CATEGORY_ICONS[key] || CATEGORY_ICONS['Outros'] || '';
    const pct = assetsTotal > 0 ? (g.value / assetsTotal) * 100 : 0;
    const n = g.items.length;
    const countStr = n + ' ' + (n === 1 ? t('cat.assets.singular') : t('cat.assets.plural'));
    const chevronHtml = '<svg class="cat-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    const sortedTickers = [...g.items].sort((a, b) => (+b.equity || 0) - (+a.equity || 0));
    const tickersHtml = sortedTickers.map(a => {
      const appr = +a.appreciation || 0;
      const cls = appr >= 0 ? 'pos' : 'neg';
      const sign = appr >= 0 ? '+' : '';
      return '<div class="ticker-row"><div class="ticker-name">' + esc(a.ticker || '-') + '</div><div class="ticker-val">' + fmtBRL0(+a.equity || 0) + '</div><div class="ticker-appr ' + cls + '">' + sign + appr.toFixed(1) + '%</div></div>';
    }).join('');

    const expanded = _expandedCats.has(key) ? ' expanded' : '';
    return '<div class="cat-row clickable' + expanded + '" data-type="' + esc(key) + '">' +
      '<div class="cat-icon">' + icon + '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">' + esc(label) + '</div>' +
        '<div class="cat-count">' + countStr + ' &middot; ' + pct.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="cat-value">' + fmtBRL0(g.value) + '</div>' +
      '</div>' +
      '<div class="cat-appr"></div>' +
      chevronHtml +
    '</div>' +
    '<div class="cat-tickers">' + tickersHtml + '</div>';
  }).join('');

  wrap.innerHTML = html;

  // Diversificação (donut) + Maiores posições — porte do mockup
  renderInvDonut(sortedKeys, groups, assetsTotal);
  renderInvTopAssets(assets);

  // v8 Turno 8 — append USD row to portfolio list
  const usd = +state.fx.usd || 0;
  const rate = +state.fx.rateUSD || 0;
  if (usd > 0 && rate > 0) {
    const usdBRL = usd * rate;
    const totalWallet = (+state.i10.equity || 0) + usdBRL;
    const percent = totalWallet > 0 ? (usdBRL / totalWallet) * 100 : 0;
    const rateStr = rate.toFixed(2).replace('.', ',');
    const usdRowHTML = '<div class="cat-row fx-row" id="fxCatRow">' +
      '<div class="cat-icon fx-icon">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' +
      '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">USD</div>' +
        '<div class="cat-count">' + percent.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
        '<div class="fx-extra"><span class="fx-native">US$ ' + usd.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '</span><span class="fx-rate-chip">× ' + rateStr + '</span></div>' +
      '</div>' +
      '<div>' +
        '<div class="cat-value">R$ ' + usdBRL.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div>' +
      '</div>' +
      '<button class="fx-edit-btn" id="fxEditBtn" type="button" aria-label="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>' +
    '</div>';
    wrap.insertAdjacentHTML('beforeend', usdRowHTML);
  } else {
    // No holding yet: small "add" hint at the end
    const addRowHTML = '<button class="fx-add-hint" id="fxEditBtn" type="button">+ Adicionar USD</button>';
    wrap.insertAdjacentHTML('beforeend', addRowHTML);
  }
  const fxBtn = document.getElementById('fxEditBtn');
  if (fxBtn) fxBtn.addEventListener('click', openFXModal);

  // Reserves row (always visible per spec)
  renderReservesRow(wrap);

  // Pension row (always visible — same UX pattern)
  renderCashRow('pension', wrap);

  // Wire expand/collapse only for Ações (reserves row has its own handler)
  wrap.querySelectorAll('.cat-row.clickable').forEach(row => {
    if (row.id === 'reserveRow') return;
    if (row.id === 'pensionRow') return;
    row.addEventListener('click', () => {
      const open = row.classList.toggle('expanded');
      // Persist expand state per category so a re-render (e.g. auto-sync)
      // doesn't collapse what the user opened.
      const key = row.dataset.type;
      if (key) { if (open) _expandedCats.add(key); else _expandedCats.delete(key); }
    });
  });
}

// ============================================================
//  MONTHLY RETURNS (rentabilidade mês a mês)
// ============================================================
const MONTH_NAMES_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NAMES_SHORT_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderMonthlyReturns() {
  const svg = document.getElementById('mrChart');
  const wrap = document.getElementById('mrChartWrap');
  const tbody = document.getElementById('mrTableBody');
  const empty = document.getElementById('mrEmpty');
  const badge = document.getElementById('mrReturnBadge');
  if (!svg || !tbody) return;

  // The barchart may now carry the full 10-year history (120 months);
  // this card only wants the recent run, so slice to the last 13 months
  // (→ 12 monthly returns). The full series still feeds yearEquity().
  const recentMonthly = (state.i10.monthly || []).slice(-13);
  const rows = computeMonthlyReturns(recentMonthly, state.contributions || [], state.yearly || []);
  if (rows.length === 0) {
    wrap.style.display = 'none';
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = `<p>${t('mr.empty')}</p>`;
    }
    tbody.innerHTML = '';
    if (badge) badge.hidden = true;
    return;
  }
  wrap.style.display = '';
  if (empty) empty.hidden = true;

  // --- Chart ---
  const W = 700, H = 200, PAD_X = 28, PAD_BOTTOM = 28, PAD_TOP = 16;
  const slot = (W - PAD_X * 2) / rows.length;
  const barW = Math.max(10, slot - 8);
  // Escala ASSIMÉTRICA: cada lado (positivo/negativo) usa só o espaço de que precisa.
  // Antes era simétrico (±max) — com negativos pequenos, metade do plot virava faixa
  // morta entre as barras vermelhas e os meses. Agora as barras enchem o card.
  const plotH = H - PAD_BOTTOM - PAD_TOP;
  const NEG_LBL = 16;   // respiro pro rótulo abaixo da barra negativa
  const maxPos = Math.max(0.5, ...rows.map(r => Math.max(0, r.returnPct)));
  const maxNeg = Math.max(0.5, ...rows.map(r => Math.max(0, -r.returnPct)));
  const posH = (plotH - NEG_LBL) * (maxPos / (maxPos + maxNeg));
  const negH = (plotH - NEG_LBL) - posH;
  const mid = PAD_TOP + posH;   // linha do 0%
  const yAt = (pct) => pct >= 0 ? mid - (pct / maxPos) * posH : mid + (-pct / maxNeg) * negH;
  const monthNames = getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT;

  const bars = rows.map((r, i) => {
    const x = PAD_X + i * slot + (slot - barW) / 2;
    const pct = r.returnPct;
    const y = pct >= 0 ? yAt(pct) : mid;
    const h = Math.abs(yAt(pct) - mid);
    const color = pct >= 0 ? 'var(--gain)' : 'var(--loss)';
    const labelY = H - PAD_BOTTOM + 14;
    const monthChar = monthNames[r.month - 1];
    const valLabelY = pct >= 0 ? (y - 4) : (y + h + 10);
    const valText = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" opacity="0.85" rx="2"><title>${monthChar}/${String(r.year).slice(-2)}: ${valText}</title></rect>
      <text x="${(x + barW/2).toFixed(1)}" y="${valLabelY.toFixed(1)}" text-anchor="middle" fill="${color}" font-size="13" font-family="Geist Mono, monospace" font-weight="700" opacity="0.92">${valText}</text>
      <text x="${(x + barW/2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" fill="var(--ink-muted)" font-size="12" font-family="Geist Mono, monospace">${monthChar}</text>`;
  }).join('');

  // Zero baseline
  const baseline = `<line x1="${PAD_X.toFixed(1)}" y1="${mid.toFixed(1)}" x2="${(W - PAD_X).toFixed(1)}" y2="${mid.toFixed(1)}" stroke="var(--ink-muted)" stroke-width="0.5" stroke-dasharray="3 4" opacity="0.4"/>`;

  svg.innerHTML = baseline + bars;

  // Badge: average of last N (max 12)
  if (badge) {
    const lastN = rows.slice(-12);
    const avg = lastN.reduce((s, r) => s + r.returnPct, 0) / lastN.length;
    badge.hidden = false;
    badge.className = 'mr-badge ' + (avg >= 0 ? 'pos' : 'neg');
    badge.textContent = t('mr.avg').replace('{pct}', (avg >= 0 ? '+' : '') + avg.toFixed(1) + '%').replace('{n}', lastN.length);
  }

  // --- Table ---
  tbody.innerHTML = [...rows].reverse().map(r => {
    const pctCls = r.returnPct >= 0 ? 'pos' : 'neg';
    const brlCls = r.returnBRL >= 0 ? 'pos' : 'neg';
    const monthChar = monthNames[r.month - 1];
    return `<tr>
      <td class="mono mr-td-month">${monthChar}/${String(r.year).slice(-2)}</td>
      <td class="mono mr-num">${fmtBRL0(r.start)}</td>
      <td class="mono mr-num">${fmtBRL0(r.end)}</td>
      <td class="mono mr-num">${r.contrib > 0 ? fmtBRL0(r.contrib) : '—'}</td>
      <td class="mono mr-num">${r.dividends > 0 ? fmtBRL0(r.dividends) : '—'}</td>
      <td class="mono mr-num ${brlCls}">${(r.returnBRL >= 0 ? '+' : '') + fmtBRL0(r.returnBRL)}</td>
      <td class="mono mr-num ${pctCls}">${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2)}%</td>
    </tr>`;
  }).join('');
}

// ============================================================
//  CONTRIBUTIONS (aportes mensais em dinheiro)
// ============================================================

function renderContributions() {
  const wrap = document.getElementById('contribList');
  const totalEl = document.getElementById('contribTotal');
  const avgEl = document.getElementById('contribAvg');
  if (!wrap) return;

  const items = [...(state.contributions || [])];

  if (items.length === 0) {
    wrap.innerHTML = '<div style="padding:24px 10px;color:var(--ink-muted);text-align:center;font-size:13px">Nenhum aporte cadastrado. Clique em "+ Aporte" para comecar.</div>';
    if (totalEl) totalEl.textContent = 'R$ 0';
    if (avgEl) avgEl.textContent = 'R$ 0';
    return;
  }

  // Group by year-month
  const groups = {};
  for (const c of items) {
    const key = `${c.year}-${String(c.month).padStart(2,'0')}`;
    if (!groups[key]) groups[key] = { year: c.year, month: c.month, items: [], total: 0 };
    groups[key].items.push(c);
    groups[key].total += +c.amount || 0;
  }

  const sortedGroups = Object.values(groups).sort((a, b) => {
    return (b.year * 100 + b.month) - (a.year * 100 + a.month);
  });

  const total = items.reduce((s, c) => s + (+c.amount || 0), 0);
  const monthsCount = sortedGroups.length;
  const avg = monthsCount > 0 ? total / monthsCount : 0;
  if (totalEl) totalEl.textContent = fmtBRL0(total);
  if (avgEl) avgEl.textContent = fmtBRL0(avg);

  wrap.innerHTML = sortedGroups.map(g => {
    const monthLbl = (getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT)[(g.month || 1) - 1] || '?';
    const countBadge = g.items.length > 1
      ? `<span class="pill-count">${g.items.length}</span>`
      : '';
    // Single-contribution months show their note inline; multi-month rows
    // just show the count badge (notes visible in the detail modal).
    const note = (g.items.length === 1 && g.items[0].note) ? g.items[0].note : '';
    const noteHtml = note ? `<div class="contrib-row-note">${esc(note)}</div>` : '';
    return `<div class="ticker-row" data-key="${g.year}-${g.month}" style="cursor:pointer">
      <div class="ticker-name">${monthLbl}/${g.year || '?'}${countBadge}${noteHtml}</div>
      <div class="ticker-val">${fmtBRL0(g.total)}</div>
      <div class="ticker-appr pos">aporte</div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.ticker-row').forEach(row => {
    row.addEventListener('click', () => {
      const [y, m] = row.dataset.key.split('-').map(Number);
      openContribListModal(y, m);
    });
  });
}

let _editingContribId = null;
let _editingMonth = null;

function openContribListModal(year, month) {
  _editingMonth = { year, month };
  const modal = document.getElementById('contribListModal');
  if (!modal) return;

  const monthLbl = (getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT)[(month || 1) - 1] || '?';
  document.getElementById('contribListTitle').textContent = `${monthLbl}/${year}`;

  const items = (state.contributions || []).filter(c => c.year === year && c.month === month)
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

  const total = items.reduce((s, c) => s + (+c.amount || 0), 0);
  document.getElementById('contribListTotal').textContent = fmtBRL0(total) + ' total · ' + items.length + ' ' + (items.length === 1 ? 'aporte' : 'aportes');

  const listEl = document.getElementById('contribListItems');
  listEl.innerHTML = items.map(c => `
    <div class="contrib-item" data-id="${c.id}">
      <div class="contrib-val">${fmtBRL0(+c.amount || 0)}${c.note ? `<span class="contrib-note">${esc(c.note)}</span>` : ''}</div>
      <button class="contrib-edit" data-action="edit" data-id="${c.id}" title="${esc(t('a11y.edit'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
      <button class="contrib-del" data-action="delete" data-id="${c.id}" title="${esc(t('a11y.delete'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') openContribModal(id);
      else if (btn.dataset.action === 'delete') deleteContribById(id);
    });
  });

  modal.classList.add('show');
}

function closeContribListModal() {
  document.getElementById('contribListModal')?.classList.remove('show');
  _editingMonth = null;
}

function openContribModal(id) {
  _editingContribId = id || null;
  const modal = document.getElementById('contribModal');
  if (!modal) return;
  if (id) {
    const c = state.contributions.find(x => x.id === id);
    if (c) {
      document.getElementById('contribYear').value = c.year || new Date().getFullYear();
      document.getElementById('contribMonth').value = c.month || (new Date().getMonth() + 1);
      document.getElementById('contribAmount').value = fmtBRLInput(c.amount);
      document.getElementById('contribNote').value = c.note || '';
      document.getElementById('contribDelete').style.display = 'inline-flex';
    }
  } else if (_editingMonth) {
    // Adding new to specific month from list modal
    document.getElementById('contribYear').value = _editingMonth.year;
    document.getElementById('contribMonth').value = _editingMonth.month;
    document.getElementById('contribAmount').value = '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribDelete').style.display = 'none';
  } else {
    const now = new Date();
    document.getElementById('contribYear').value = now.getFullYear();
    document.getElementById('contribMonth').value = now.getMonth() + 1;
    document.getElementById('contribAmount').value = '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribDelete').style.display = 'none';
  }
  modal.classList.add('show');
  setTimeout(() => document.getElementById('contribAmount').focus(), 50);
}

function closeContribModal() {
  document.getElementById('contribModal')?.classList.remove('show');
  _editingContribId = null;
}

async function saveContrib() {
  const year = parseInt(document.getElementById('contribYear').value, 10);
  const month = parseInt(document.getElementById('contribMonth').value, 10);
  const amount = parseBRLInput(document.getElementById('contribAmount').value);
  const note = (document.getElementById('contribNote')?.value || '').trim();
  if (!(year >= 2020 && year <= 2099)) { showToast(t('contrib.toast.year')); return; }
  if (!(month >= 1 && month <= 12)) { showToast(t('contrib.toast.month')); return; }
  if (!(amount > 0)) { showToast(t('contrib.toast.value')); return; }
  try {
    if (_editingContribId) {
      const ref = doc(db, 'household', 'main', 'contributions', _editingContribId);
      await setDoc(ref, { year, month, amount, note, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      // Auto-generated ID - allows multiple contributions per month
      const colRef = collection(db, 'household', 'main', 'contributions');
      await addDoc(colRef, { year, month, amount, note, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: state.user?.displayName || 'unknown' });
    }
    showToast(t('toast.saved'));
    closeContribModal();
    // Refresh list modal if it was open
    if (_editingMonth) {
      setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
    }
  } catch (e) {
    console.error('saveContrib error', e);
    showToast(t('toast.error.save'));
  }
}

async function deleteContrib() {
  if (!_editingContribId) return;
  const id = _editingContribId;
  openConfirmModal({
    title: t('contrib.delete.title'), sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'), danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'household', 'main', 'contributions', id));
        showToast(t('toast.deleted'));
        closeContribModal();
        if (_editingMonth) {
          setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
        }
      } catch (e) { showToast(t('toast.error.delete')); }
    },
  });
}

async function deleteContribById(id) {
  openConfirmModal({
    title: t('contrib.delete.title'), sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'), danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'household', 'main', 'contributions', id));
        showToast(t('toast.deleted'));
        if (_editingMonth) {
          setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
        }
      } catch (e) { showToast(t('toast.error.delete')); }
    },
  });
}


// v8 Turno 7 — Louise wallet render
function renderLouise() {
  const chip = document.getElementById('louiseChip');
  const eq = $('louiseEquity');
  if (!eq) return;
  const equity = +state.i10Louise.equity || 0;
  // Hide chip entirely if there's no data yet
  if (chip) chip.style.display = equity > 0 ? 'inline-flex' : 'none';
  eq.textContent = 'R$ ' + equity.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const divEl = $('louiseDividends');
  if (divEl) divEl.textContent = 'R$ ' + (state.i10Louise.dividends || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const varEl = $('louiseVariation');
  if (varEl) {
    const v = +state.i10Louise.variation || 0;
    const sign = v >= 0 ? '+' : '';
    varEl.textContent = sign + v.toFixed(1) + '%';
    varEl.className = 'louise-chip-var ' + (v >= 0 ? 'gain' : 'loss');
  }
  const upd = $('louiseUpdated');
  if (upd) {
    upd.textContent = state.i10Louise.updatedAt
      ? t('hero.updated.prefix') + ' \u00b7 ' + formatDateTimeBR(state.i10Louise.updatedAt)
      : t('hero.updated.never');
  }
}

async function syncLouise() {
  const workerUrl = state.i10Cfg.workerUrl || '';
  const walletId = state.i10LouiseCfg.walletId;
  if (!workerUrl || !walletId) { console.warn('Louise sync skipped: workerUrl or walletId missing'); return; }
  try {
    const year = new Date().getFullYear();
    const base = workerUrl.replace(/\/+$/, '');
    const url = `${base}/i10/all/${encodeURIComponent(walletId)}?year=${year}`;
    console.log('Louise sync \u2192', url);
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const m = payload.metrics || {};
    const equity = parseFloat(m.equity) || 0;
    const applied = parseFloat(m.applied) || 0;
    const variation = parseFloat(m.variation) || 0;
    const dividends = parseFloat(payload.earnings?.sum) || 0;
    await setDoc(docI10Louise, {
      equity, dividends, applied, variation, year,
      updatedAt: serverTimestamp(),
      updatedBy: (state.user?.displayName || 'unknown') + ' (auto)',
      source: 'investidor10-sync',
    }, { merge: true });
    console.log('Louise sync \u2713', { equity, dividends });
  } catch (err) {
    console.warn('Louise sync failed:', err);
  }
}

async function syncFromI10() {
  const { workerUrl, walletId } = state.i10Cfg;
  if (!workerUrl || !walletId) {
    showToast(t('i10.toast.cfgfirst'));
    openI10ConfigModal();
    return;
  }
  if (state.i10Syncing) return;
  state.i10Syncing = true;
  const btn = $('btnSyncI10');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = t('hero.syncing'); }
  // DS (aprovado no provador): skeleton shimmer nos números enquanto o I10 responde
  const _skelIds = ['i10Equity', 'heroTwr', 'heroDiv', 'heroVar', 'kpiApplied', 'i10Dividends'];
  _skelIds.forEach(id => $(id)?.classList.add('skel'));

  try {
    const year = new Date().getFullYear();
    const base = workerUrl.replace(/\/+$/, ''); // remove trailing slash
    // Fetch /i10/all (metrics + earnings + actives) in parallel with
    // /i10/barchart (12m equity history). The barchart endpoint has
    // been live on the worker since day 1 but never consumed; polling
    // it alongside /all avoids needing a worker redeploy just to add
    // a new field to /all. If /all ships a `barchart` field in the
    // future (worker.js already does this but needs redeploy), we
    // prefer it and skip the second request.
    let payload;
    const allUrl = `${base}/i10/all/${encodeURIComponent(walletId)}?year=${year}`;
    const barUrl = `${base}/i10/barchart/${encodeURIComponent(walletId)}`;
    const [allRes, barRes] = await Promise.all([
      fetch(allUrl, { method: 'GET', headers: { 'Accept': 'application/json' } }),
      fetch(barUrl, { method: 'GET', headers: { 'Accept': 'application/json' } }).catch(() => null),
    ]);
    if (!allRes.ok) throw new Error(`HTTP ${allRes.status}`);
    payload = await allRes.json();
    // If /all didn't include barchart (worker not yet redeployed), pull
    // it from the dedicated endpoint. Failure is non-fatal — monthly
    // returns card will just show its empty state.
    if (!payload.barchart && barRes && barRes.ok) {
      try { payload.barchart = await barRes.json(); }
      catch (e) { console.warn('[i10] barchart fetch parse failed:', e); }
    }

    // Parse metrics (equity, applied, variation, profit_twr)
    const m = payload.metrics || {};
    const equity = parseFloat(m.equity) || 0;
    const applied = parseFloat(m.applied) || 0;
    const variation = parseFloat(m.variation) || 0;
    const profitTwr = parseFloat(m.profit_twr) || 0;

    // Parse earnings (sum of dividends YTD)
    const dividends = parseFloat(payload.earnings?.sum) || 0;

    // Populate global ticker->category map from /i10/full diversification
    if (payload.diversification?.tickerToCategory) {
      _i10TickerCategory = payload.diversification.tickerToCategory;
    }

    // Parse diversification (categories summary from /patrimony/.../diversification/all,ideal-per-type)
    let categories = [];
    if (payload.diversification?.values && Array.isArray(payload.diversification.values)) {
      categories = payload.diversification.values.map(c => ({
        name: c.name || '',
        type: c.type || '',
        value: +c.value || 0,
        percent: +c.percent || 0,
      }));
    }

    // Parse barchart (12-month equity history). Shape is unknown across
    // I10 API versions; normalize to [{ year, month, equity }] sorted
    // ascending. Any failure here is non-fatal — we fall back to [].
    const monthly = parseI10Barchart(payload.barchart);

    // Parse actives (list of tickers)
    const rawAssets = Array.isArray(payload.actives?.data) ? payload.actives.data : [];
    // The worker now tags each row with `__assetClass` based on which
    // /summary/actives/<TYPE> endpoint it came from. Map that to a
    // human-friendly category label. Fallback to inferCategory() (the
    // ticker-based heuristic) for legacy/unexpected rows.
    const I10_TYPE_TO_CAT = {
      // tokens REAIS do I10 (campo ticker_type, em inglês):
      Ticker: 'Ações',
      Treasure: 'Tesouro Direto',
      FixedIncome: 'Renda Fixa',
      fixed: 'Renda Fixa',
      Fund: 'Fundos',
      Etf: 'ETFs',
      Fii: 'FIIs',
      Bdr: 'BDRs',
      Cryptocurrency: 'Criptomoedas',
      // legados (resiliência contra cache/worker antigo):
      TesouroDireto: 'Tesouro Direto',
      RendaFixa: 'Renda Fixa',
      FundoInvestimento: 'Fundos',
      Criptomoeda: 'Criptomoedas',
    };
    const assets = rawAssets.map(a => {
      const ticker = a.ticker || a.ticker_name || '';
      const tickerUpper = ticker.toUpperCase().trim();
      const fromType = a.__assetClass ? I10_TYPE_TO_CAT[a.__assetClass] : null;
      return {
        ticker,
        quantity: +a.quantity || 0,
        avgPrice: +a.avg_price || 0,
        currentPrice: parseFloat(a.current_price) || 0,
        equity: +a.equity_total || parseFloat(a.equity_brl) || 0,
        appreciation: +a.appreciation || 0,
        percentWallet: +a.percent_wallet || 0,
        earnings: +a.earnings_received || 0,
        image: a.image || '',
        url: a.url || '',
        category: fromType || inferCategory({ ticker }),
      };
    });

    // Persist in Firestore - both users share via onSnapshot
    await setDoc(docI10, {
      equity,
      dividends,
      applied,
      variation,
      profitTwr,
      assets,
      categories,
      monthly,
      year,
      updatedAt: serverTimestamp(),
      updatedBy: (state.user?.displayName || 'unknown') + ' (auto)',
      source: 'investidor10-sync',
    }, { merge: true });

    showToast(`Sincronizado: ${assets.length} ativos`);
    const _hc = document.querySelector('.hero-card');
    if (_hc) { _hc.classList.remove('sweeping'); void _hc.offsetWidth; _hc.classList.add('sweeping'); setTimeout(() => _hc.classList.remove('sweeping'), 1000); }
    // v8 Turno 7: piggyback Louise sync on every successful main sync (both branches)
    syncLouise().catch(e => console.warn('Louise piggyback error:', e));
    fetchFXRate().catch(e => console.warn('FX rate refresh error:', e));
    // Auto-sync dos proventos do I10 → Ganhos (sem clicar). Dedup torna idempotente.
    autoSyncProventos().catch(e => console.warn('proventos auto-sync error:', e));
    // Piggyback yearly history refresh — silent + throttled to 24h to
    // avoid hammering /i10/yearly (which fans out per-year upstream).
    if (Date.now() - _autoYearlyLastRun > AUTO_YEARLY_INTERVAL_HOURS * 3600_000) {
      _autoYearlyLastRun = Date.now();
      importHistoryFromI10({ silent: true }).catch(e => console.warn('yearly piggyback error:', e));
    }
  } catch (err) {
    console.error('I10 sync error:', err);
    showToast(t('i10.toast.syncfail'));
  } finally {
    state.i10Syncing = false;
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
    _skelIds.forEach(id => $(id)?.classList.remove('skel'));
  }
}

// ============================================================
//  AUTO-SYNC — fires syncFromI10 when last sync is older than
//  AUTO_SYNC_INTERVAL_HOURS, triggered by login + visibility change
//  + hourly heartbeat. No external scheduler needed — relies on at
//  least one of the two users opening the app each day. They share
//  the same Firestore doc, so whoever fires first updates everyone.
// ============================================================
const AUTO_SYNC_INTERVAL_HOURS = 1;
// Yearly history (dividendsYearly) é mais pesado de sincronizar
// (chama o worker uma vez por ano). Throttle separado: 24h.
const AUTO_YEARLY_INTERVAL_HOURS = 24;
let _autoYearlyLastRun = 0;
let _autoSyncLastCheck = 0;

function maybeAutoSync(reason = 'unknown') {
  // Debounce: don't re-check more than once per 60s no matter how
  // many events fire. Cheap protection against tab-switch spam.
  if (Date.now() - _autoSyncLastCheck < 60_000) return;
  _autoSyncLastCheck = Date.now();

  // Preconditions: must be logged in, must have wallet config, must
  // not already be syncing, must have at least one prior sync (so we
  // don't fire on a fresh install — the user kicks off the first one
  // manually so they can see it succeed).
  if (!state.user) return;
  if (state.i10Syncing) return;
  if (!state.i10Cfg.workerUrl || !state.i10Cfg.walletId) return;
  if (!state.i10.updatedAt) return;

  const hoursAgo = (Date.now() - state.i10.updatedAt.getTime()) / 3600000;
  if (hoursAgo < AUTO_SYNC_INTERVAL_HOURS) return;

  console.log(`[autosync] reason=${reason} lastSync=${hoursAgo.toFixed(1)}h ago — firing background sync`);
  syncFromI10();
}

// Hook 1: when the tab becomes visible again (user came back to the
// app after switching away). Visibility events also fire on focus.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeAutoSync('visibility');
});

// Hook 2: hourly heartbeat for tabs left open all day long.
setInterval(() => maybeAutoSync('heartbeat'), 60 * 60 * 1000);

// Hook 3 (post-login) is wired inside onAuthStateChanged after the
// Firestore listeners have a chance to populate state.i10.updatedAt.

// ============================================================
//  IMPORT YEARLY HISTORY FROM I10
// ============================================================
// Imports/updates documents in dividendsYearly collection.
// Each year doc uses String(year) as ID to ensure idempotency.
// Skips current year (managed by daily sync) and skips years with zero divs AND zero equity.
async function importYearlyData(yearsArray) {
  const currentYear = new Date().getFullYear();
  let imported = 0;
  for (const row of yearsArray) {
    const year = parseInt(row.year, 10);
    if (!Number.isFinite(year)) continue;
    if (year >= currentYear) continue; // current year managed by daily I10 sync
    const equity = Number.isFinite(+row.equity) ? +row.equity : null;
    const divs = Number.isFinite(+row.divs) ? +row.divs : 0;
    const applied = Number.isFinite(+row.applied) ? +row.applied : null;
    const flow = Number.isFinite(+row.flow) ? +row.flow : null;
    // Skip empty years
    if ((!equity || equity === 0) && divs === 0) continue;
    try {
      const docRef = doc(db, 'household', 'main', 'dividendsYearly', String(year));
      // Only include fields that actually have a value. Sending a key
      // with `null` would still WIPE the previous Firestore value (bug
      // hit 2026-04-20 — the I10 yearly endpoint returns null for the
      // fields it can't recover, and the prior setDoc was clobbering
      // hand-seeded equity history). When the source has no equity to
      // give, the previous value is preserved.
      const data = {
        year,
        divs,
        updatedAt: serverTimestamp(),
        updatedBy: (state.user?.displayName || state.user?.email || 'unknown') + ' (i10-import)',
        source: 'investidor10-yearly-import',
      };
      if (equity != null) data.equity = equity;
      if (applied != null) data.applied = applied;
      if (flow != null) data.flow = flow;
      await setDoc(docRef, data, { merge: true });
      imported++;
    } catch (e) {
      console.error('importYearlyData error for', year, e);
    }
  }
  return imported;
}

async function importHistoryFromI10(opts = {}) {
  const silent = !!opts.silent;
  const { workerUrl, walletId } = state.i10Cfg;
  if (!workerUrl || !walletId) {
    if (!silent) {
      showToast(t('i10.toast.cfgfirst'));
      openI10ConfigModal();
    }
    return;
  }
  const btn = silent ? null : $('btnImportHistory');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = t('hist.importing'); }
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/i10/yearly/${encodeURIComponent(walletId)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);
    const years = Array.isArray(payload.years) ? payload.years : [];
    if (years.length === 0) {
      if (!silent) showToast(t('i10.toast.noyears'));
      return;
    }
    const imported = await importYearlyData(years);
    if (!silent) showToast(`Importado: ${imported} ${imported === 1 ? 'ano' : 'anos'} do I10`);
    else console.log(`[autosync] yearly refreshed: ${imported} anos`);
  } catch (err) {
    console.error('importHistoryFromI10 error:', err);
    if (!silent) showToast(t('i10.toast.importfail'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

// ============================================================
//                I10 CONFIG MODAL (Worker URL + Wallet ID)
// ============================================================
function openI10ConfigModal() {
  $('i10CfgWorker').value = state.i10Cfg.workerUrl || '';
  $('i10CfgWallet').value = state.i10Cfg.walletId || '';
  if ($('i10CfgHash')) $('i10CfgHash').value = state.i10Cfg.publicHash || '';
  $('i10CfgModal').classList.add('show');
  setTimeout(() => $('i10CfgWorker').focus(), 50);
}
function closeI10ConfigModal() { $('i10CfgModal').classList.remove('show'); }

async function saveI10Config() {
  const workerUrl = ($('i10CfgWorker').value || '').trim();
  const walletId = ($('i10CfgWallet').value || '').trim();
  const publicHash = (($('i10CfgHash') && $('i10CfgHash').value) || '').trim();
  if (!workerUrl || !/^https?:\/\//.test(workerUrl)) { showToast(t('cfg.toast.worker')); return; }
  if (!walletId || !/^\d+$/.test(walletId)) { showToast(t('cfg.toast.wallet')); return; }
  const btn = $('i10CfgSave');
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    await setDoc(docI10Cfg, {
      workerUrl,
      walletId,
      publicHash,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    }, { merge: true });
    showToast(t('cfg.toast.saved'));
    closeI10ConfigModal();
    // Auto-sync right after saving, so user sees data immediately
    setTimeout(() => syncFromI10(), 300);
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = t('exp.btn.save'); }
}

// ============================================================
//                I10 EDIT MODAL
// ============================================================
function openI10Modal() {
  const currentYear = new Date().getFullYear();
  $('i10YearInput2').textContent = currentYear;
  $('i10EquityInput').value = state.i10.equity || '';
  $('i10DivsInput').value = state.i10.dividends || '';
  $('i10Modal').classList.add('show');
  setTimeout(() => $('i10EquityInput').focus(), 50);
}
function closeI10Modal() { $('i10Modal').classList.remove('show'); }

async function saveI10() {
  const equity = parseFloat($('i10EquityInput').value);
  const dividends = parseFloat($('i10DivsInput').value);
  if (isNaN(equity) || equity < 0) { showToast(t('i10.toast.equity')); return; }
  if (isNaN(dividends) || dividends < 0) { showToast(t('i10.toast.divs')); return; }

  const btn = $('i10Save');
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    await setDoc(docI10, {
      equity,
      dividends,
      year: new Date().getFullYear(),
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
      source: 'manual',
    }, { merge: true });
    showToast(t('i10.toast.saved'));
    closeI10Modal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = t('exp.btn.save'); }
}

// ============================================================
//                 YEARLY MODAL
// ============================================================
let editingYearlyId = null;
function openYearlyModal(id = null) {
  editingYearlyId = id;
  if (id) {
    const y = state.yearly.find(x => x.id === id); if (!y) return;
    $('yearlyModalTitle').textContent = t('yearly.modal.edit');
    $('yearlyYear').value = y.year || '';
    $('yearlyEquity').value = y.equity || '';
    $('yearlyDivs').value = y.divs || '';
    $('yearlyDelete').style.display = '';
  } else {
    $('yearlyModalTitle').textContent = t('yearly.modal.add');
    $('yearlyYear').value = '';
    $('yearlyEquity').value = '';
    $('yearlyDivs').value = '';
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
  if (!year) { showToast(t('yearly.toast.year')); return; }
  if (isNaN(equity)) { showToast(t('yearly.toast.equity')); return; }
  if (isNaN(divs)) { showToast(t('yearly.toast.divs')); return; }
  const data = { year, equity, divs, updatedAt: serverTimestamp() };
  const btn = $('yearlySave');
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    if (editingYearlyId) {
      await setDoc(docYearly(editingYearlyId), data, { merge: true });
      showToast(t('yearly.toast.updated'));
    } else {
      await addDoc(colYearly(), { ...data, createdAt: serverTimestamp() });
      showToast(t('yearly.toast.added'));
    }
    closeYearlyModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = t('exp.btn.save'); }
}

async function deleteYearly() {
  if (!editingYearlyId) return;
  const id = editingYearlyId;
  openConfirmModal({
    title: t('yearly.delete.title'), sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'), danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(docYearly(id));
        showToast(t('yearly.toast.deleted'));
        closeYearlyModal();
      } catch (err) { console.error(err); showToast(t('toast.error.delete')); }
    },
  });
}

// ============================================================
//                 EVENT LISTENERS
// ============================================================
// Mode switch
document.querySelectorAll('.mode-switch button').forEach(b => {
  b.addEventListener('click', () => switchMode(b.dataset.mode));
});

// Month navigation
$('btnPrevMonth').addEventListener('click', () => {
  const d = state.currentViewMonth;
  state.currentViewMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderExpenses();
});
$('btnNextMonth').addEventListener('click', () => {
  const d = state.currentViewMonth;
  state.currentViewMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderExpenses();
});
// Nav de meses da sub-aba Lançamentos (reusa a lógica do hero)
$('lancPrev')?.addEventListener('click', () => $('btnPrevMonth')?.click());
$('lancNext')?.addEventListener('click', () => $('btnNextMonth')?.click());

// ============================================================
//                 EXPENSES - BUDGET EDITOR
// ============================================================
function openBudgetModal() {
  const list = $('budgetList');
  if (!list) return;
  const budgets = state.budgets || {};
  list.innerHTML = catsAZ().map(([key, cat]) => {
    const current = +budgets[key] || 0;
    const value = current > 0 ? fmtBRLInput(current) : '';
    return `<div class="budget-row" style="--cat-color:${cat.color}">
      <div class="budget-row-icon">${cat.icon}</div>
      <div class="budget-row-name">${cat.label}</div>
      <input type="text" inputmode="decimal" class="budget-row-input" data-cat="${key}" value="${value}" placeholder="—" autocomplete="off" />
    </div>`;
  }).join('');
  // Wire BRL mask to each input (blur to format, Enter to commit)
  list.querySelectorAll('.budget-row-input').forEach(inp => {
    inp.addEventListener('blur', () => {
      const n = parseBRLInput(inp.value);
      inp.value = n > 0 ? fmtBRLInput(n) : '';
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); saveBudgets(); }
    });
  });
  $('budgetModal').classList.add('show');
}
function closeBudgetModal() { $('budgetModal')?.classList.remove('show'); }
async function saveBudgets() {
  const btn = $('budgetSave');
  const originalLabel = t('exp.btn.save');
  const out = {};
  document.querySelectorAll('#budgetList .budget-row-input').forEach(inp => {
    const key = inp.dataset.cat;
    const n = parseBRLInput(inp.value);
    if (n > 0) out[key] = n;
  });
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    await setDoc(docBudgets, {
      categories: out,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    }, { merge: false });
    showToast(t('exp.budget.toast.saved'));
    closeBudgetModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = originalLabel; }
}

// --- Gerenciar categorias (config/categories) -----------------------------
function catRowHtml(key, label, color, iconSvg, iconKey, isDefault) {
  return `<div class="cat-edit-row" data-key="${esc(key)}" data-icon="${esc(iconKey)}" data-default="${isDefault ? '1' : '0'}">
    <button type="button" class="cat-edit-ic" ${isDefault ? 'tabindex="-1"' : 'title="' + esc(t('cat.icon.hint')) + '"'}>${iconSvg}</button>
    <input class="cat-edit-nm" type="text" value="${esc(label)}" maxlength="22" autocomplete="off" spellcheck="false" />
    <input class="cat-edit-co" type="color" value="${color}" title="${esc(t('cat.color.hint'))}" />
    ${isDefault ? '<span class="cat-edit-del-ph" aria-hidden="true"></span>' : '<button type="button" class="cat-edit-del" title="' + esc(t('cat.del.hint')) + '" aria-label="' + esc(t('a11y.delete')) + '"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'}
  </div>`;
}
function wireCatRow(row) {
  const co = row.querySelector('.cat-edit-co'), ic = row.querySelector('.cat-edit-ic'), del = row.querySelector('.cat-edit-del');
  co?.addEventListener('input', () => { if (ic) ic.style.color = co.value; });
  if (row.dataset.default !== '1') {
    ic?.addEventListener('click', () => {
      const idx = CAT_ICON_KEYS.indexOf(row.dataset.icon || 'tag');
      const next = CAT_ICON_KEYS[(idx + 1) % CAT_ICON_KEYS.length];
      row.dataset.icon = next; ic.innerHTML = ICONS[next] || ICONS.tag;
    });
    del?.addEventListener('click', () => { row.style.transition = 'opacity .18s, transform .18s'; row.style.opacity = '0'; row.style.transform = 'translateX(10px)'; setTimeout(() => row.remove(), 170); });
  }
}
function renderCatEditor() {
  const list = $('catEditList');
  if (!list) return;
  const custom = (state.catConfig && state.catConfig.custom) || {};
  let html = DEFAULT_CAT_KEYS.map(k => catRowHtml(k, CATEGORIES[k].label, CATEGORIES[k].color, CATEGORIES[k].icon, 'tag', true)).join('');
  html += Object.keys(custom).filter(k => !DEFAULT_CAT_KEYS.includes(k)).map(k => {
    const c = CATEGORIES[k] || {}; const ik = c.iconKey || custom[k].icon || 'tag';
    return catRowHtml(k, c.label || custom[k].label, c.color || custom[k].color, ICONS[ik] || ICONS.tag, ik, false);
  }).join('');
  list.innerHTML = html;
  list.querySelectorAll('.cat-edit-row').forEach(wireCatRow);
}
// Sub-abas de Despesas: Painel | Lançamentos | Categorias (alterna views por classe no módulo)
function setExpSub(view) {
  state.expSub = view;
  const mod = $('moduleExpenses');
  if (mod) {
    mod.classList.remove('view-lancamentos', 'view-categorias', 'view-ganhos');
    if (view === 'lancamentos') mod.classList.add('view-lancamentos');
    else if (view === 'categorias') mod.classList.add('view-categorias');
    else if (view === 'ganhos') mod.classList.add('view-ganhos');
  }
  document.querySelectorAll('.exp-subnav button').forEach(b => b.classList.toggle('on', b.dataset.subview === view));
  // título da tabela conforme a sub-aba (Lançamentos = despesas · Ganhos = ganhos)
  const _tt = document.querySelector('.exp-g-table .card-head h3');
  if (_tt) _tt.textContent = (view === 'ganhos') ? t('exp.card.income') : t('exp.card.all');
  if (view === 'categorias') renderCatEditor();
  else renderExpenseTable(_lastMonthExp || []);   // painel = limite; lançamentos/ganhos = todas as linhas
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
}
function openCatModal() { setExpSub('categorias'); }
function closeCatModal() { setExpSub('painel'); }
function catAddRow() {
  const list = $('catEditList');
  if (!list) return;
  const key = 'c' + Date.now().toString(36);
  const color = CAT_PALETTE[list.querySelectorAll('.cat-edit-row').length % CAT_PALETTE.length];
  const tmp = document.createElement('div');
  tmp.innerHTML = catRowHtml(key, t('cat.new'), color, ICONS.tag, 'tag', false);
  const row = tmp.firstElementChild;
  list.appendChild(row); wireCatRow(row);
  const nm = row.querySelector('.cat-edit-nm'); nm?.focus(); nm?.select();
  row.scrollIntoView({ block: 'nearest' });
}
async function saveCategories() {
  const btn = $('catSave'), orig = t('exp.btn.save');
  const custom = {}, overrides = {};
  document.querySelectorAll('#catEditList .cat-edit-row').forEach(row => {
    const key = row.dataset.key, isDefault = row.dataset.default === '1';
    const label = (row.querySelector('.cat-edit-nm').value || '').trim() || key;
    const color = row.querySelector('.cat-edit-co').value || '#8e8e93';
    const iconKey = row.dataset.icon || 'tag';
    if (isDefault) {
      const d = DEFAULT_CATEGORIES[key];
      if (label !== d.label || color.toLowerCase() !== String(d.color).toLowerCase()) overrides[key] = { label, color };
    } else {
      custom[key] = { label, color, icon: iconKey };
    }
  });
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    await setDoc(docCategories, { custom, overrides, updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'unknown' }, { merge: false });
    showToast(t('cat.toast.saved'));
    closeCatModal();
  } catch (err) { console.error('[cat] save', err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

// Generic confirm modal — replaces native confirm() across the app
let _confirmState = null;
function openConfirmModal({ title, sub, confirmLabel, cancelLabel, danger, onConfirm } = {}) {
  const modal = $('confirmModal');
  if (!modal) { if (confirm((title || '') + '\n' + (sub || ''))) onConfirm?.(); return; }
  $('confirmTitle').textContent = title || t('exp.delete.title');
  $('confirmSub').textContent = sub || t('exp.delete.sub');
  const okBtn = $('confirmOk');
  const cancelBtn = $('confirmCancel');
  okBtn.textContent = confirmLabel || t('exp.delete.confirm');
  cancelBtn.textContent = cancelLabel || t('exp.btn.cancel');
  okBtn.className = danger === false ? 'btn-primary' : 'btn-danger';
  _confirmState = { onConfirm };
  modal.classList.add('show');
  setTimeout(() => cancelBtn.focus(), 50);
}
function closeConfirmModal() { $('confirmModal')?.classList.remove('show'); _confirmState = null; }
$('confirmCancel')?.addEventListener('click', closeConfirmModal);
$('confirmOk')?.addEventListener('click', async () => {
  const cb = _confirmState?.onConfirm;
  closeConfirmModal();
  if (cb) await cb();
});
$('confirmModal')?.addEventListener('click', e => { if (e.target.id === 'confirmModal') closeConfirmModal(); });

// Net-worth pill → jump to Investments tab
$('expNwPill')?.addEventListener('click', () => switchMode('investments'));

// Table search — live filter, only the current month's rows are touched
$('expSearch')?.addEventListener('input', e => {
  _expSearchQuery = e.target.value || '';
  renderExpenseTable(_lastMonthExp);
});
// Filtros da listagem (categoria / pessoa / tipo)
['expFilterCat', 'expFilterOwner'].forEach(id => {
  $(id)?.addEventListener('change', e => {
    const v = e.target.value;
    if (id === 'expFilterCat') _expFilters.cat = v;
    else _expFilters.owner = v;
    e.target.classList.toggle('on', !!v);
    renderExpenseTable(_lastMonthExp);
  });
});
// Pedido da Flávia: toggle Fixas/Variáveis num clique (substituiu o select "Tipo")
document.querySelectorAll('#expNatFilter button').forEach(b => b.addEventListener('click', () => {
  _expFilters.nature = b.dataset.nat || '';
  document.querySelectorAll('#expNatFilter button').forEach(x => {
    const on = x === b;
    x.classList.toggle('on', on);
    x.setAttribute('aria-checked', String(on));
  });
  renderExpenseTable(_lastMonthExp);
}));

// CSV export
$('btnExportCsv')?.addEventListener('click', exportCurrentMonthCSV);
// Cabeçalho clicável → ordena a tabela de despesas (toggle asc/desc).
document.querySelectorAll('.exp-table thead th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  if (_expSort.key === key) _expSort.dir = _expSort.dir === 'asc' ? 'desc' : 'asc';
  else { _expSort.key = key; _expSort.dir = (key === 'date' || key === 'value') ? 'desc' : 'asc'; }
  renderExpenses();
}));

// Budget modal
$('btnEditBudgets')?.addEventListener('click', openBudgetModal);
$('budgetCancel')?.addEventListener('click', closeBudgetModal);
$('budgetSave')?.addEventListener('click', saveBudgets);
$('budgetModal')?.addEventListener('click', e => { if (e.target.id === 'budgetModal') closeBudgetModal(); });

// Sub-abas de Despesas (Painel | Lançamentos | Categorias) + editor de categorias (sub-aba)
document.querySelectorAll('.exp-subnav button').forEach(b => b.addEventListener('click', () => setExpSub(b.dataset.subview)));
$('btnEditCats')?.addEventListener('click', openCatModal);   // → sub-aba Categorias
$('catSave')?.addEventListener('click', saveCategories);
$('catAddBtn')?.addEventListener('click', catAddRow);

// Expense modal
// ============================================================
//  IMPORTADOR DE FATURA DO CARTÃO (PDF) — v1
//  Lê o PDF (Bradesco) NO NAVEGADOR via PDF.js (CDN, lazy), parseia os
//  lançamentos, dá palpite de "de quem" + categoria, e grava em lote nas
//  despesas com anti-duplicata. O PDF nunca sai do navegador.
// ============================================================
let _pdfjsLib = null;
async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  try { lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs'; } catch (e) {}
  _pdfjsLib = lib;
  return lib;
}
async function extractPdfLines(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s });
    }
    [...rows.keys()].sort((a, b) => b - a).forEach(y => {
      const line = rows.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    });
  }
  return lines;
}
// ---- Normalização do nome do estabelecimento ----
// Tira adquirente (PG*/MP*/PAYPAL*...), nº de loja, UF no fim, acento e pontuação.
// É o que REVIVE a memória (a chave deixa de mudar a cada compra por causa do nº de loja).
// IMP_GATEWAY, IMP_UF, IMP_STOP, impNormalize, impTokens, impRuleKey → ./import-core.js (v8 Turno 11)

// Regras: [categoria, exatos (peso 10), prefixos (peso 7), substrings (peso 4)].
// Token EXATO evita pegar palavra-dentro-de-palavra (Garcia/Koch/Azul não casam mais por acaso).
const IMP_CATS = [
  ['mercado', ['carrefour','assai','atacadao','tenda','makro','sams','extra','mambo','zaffari','condor','muffato','angeloni','bistek','comper','supernosso','verdemar','festval','mateus','sendas','epa','cooper','koch','giassi','hippo','imperatriz','prezunic','guanabara','mundial','sonda','savegnago','roldao','nagumo','hirota','bahamas','carone','semar','bramil','fort','enxuto'], ['mercad','supermerc','superm','hortifrut','acoug','mercear','quitand','sacolao','atacad','minimerc'], ['pao de acucar','fort atacad','mercado garcia','natural da terra','sao vicente','oba horti']],
  ['alimentacao', ['ifood','rappi','aiqfome','mcdonalds','subway','bobs','habibs','outback','spoleto','starbucks','madero','dominos','giraffas','kfc','popeyes','vivenda','gendai','jeronimo','patroni','montana','abbraccio','sodie','sterna','kopenhagen','chiquinho','ragazzo','vezpa','restaurante','padaria','lanchonete','cantina','bar','boteco','cafe','cafeteria','confeitaria','doceria','acai','adega','pizzaria','temaki','sushi','churrascaria','hamburgueria','sorveteria','pastelaria','rotisseria','marmitaria'], ['restaur','padar','panific','lanch','hamburg','cervej','sorvet','pizz','marmit','gastro','bistr','confeit','doceri','churrasc','cafeter','pastel'], ['coco bambu','divino fogao','china in box','cacau show','brasil cacau','ze delivery','burger king','fogo de chao','pizza hut','bob s','mc donalds','baby beef','dunkin donuts']],
  ['transporte', ['uber','99','indrive','cabify','localiza','movida','unidas','ipiranga','shell','petrobras','texaco','veloe','conectcar','metro','cptm','blablacar','taxi','sptrans','supervia','ecovias','arteris','raizen','alesat','gasbar','riocard','autopass'], ['posto','combust','estacion','pedagi','gasolin','rodoviar','uber','locadora','transport'], ['99app','rek park','sem parar','auto re','bilhete unico','br distribuidora']],
  ['viagem', ['latam','decolar','booking','airbnb','trivago','hostel','pousada','resort','hotel','cvc','hurb','expedia','smiles','maxmilhas','jetsmart','clickbus','buser','passaredo'], ['hosped','pousad','turismo'], ['azul linhas','gol linhas','voe gol','tam linhas','hoteis com','booking com','123 milhas','latam air','azul viagens']],
  ['saude', ['farmacia','farmacias','drogasil','drogaria','droga','panvel','pacheco','raia','nissei','araujo','venancio','bifarma','ultrafarma','extrafarma','onofre','agafarma','catarinense','drogamais','unimed','amil','hapvida','notredame','intermedica','sulamerica','vacina','hospital','clinica','laboratorio','dentista','psicologo','fisioterapia','otica','oticas','fleury','sabin','dasa','delboni','lavoisier','einstein','smartfit','bodytech','selfit','bluefit','gympass','totalpass','crossfit','pilates','academia','bioritmo'], ['farmac','drogar','clinic','odonto','laborat','psico','dentist','dermat','oftalmo','fisio','vacin','hospital','academ','consultori'], ['pague menos','sao joao','drogaraia','smart fit','plano de saude','hermes pardini','total pass']],
  ['assinaturas', ['netflix','spotify','disney','hbo','globoplay','paramount','crunchyroll','deezer','tidal','youtube','twitch','chatgpt','openai','anthropic','claude','notion','dropbox','icloud','adobe','canva','linkedin','github','figma','audible','patreon','itunes','apple','microsoft','office','playstation','xbox','nintendo','telecine','looke','skeelo','mubi','midjourney','vercel','cursor','onedrive'], ['kindle'], ['amazon prime','prime video','google one','apple com','apple tv','game pass','google youtu','dl google','yt premium','ps plus','hbo max','disney plus','paramount plus','star plus','youtube premium','apple music']],
  ['educacao', ['escola','colegio','faculdade','universidade','unopar','anhanguera','estacio','uninter','puc','senac','senai','udemy','alura','coursera','hotmart','descomplica','duolingo','babbel','wizard','ccaa','fisk','kumon','milium','livraria','saraiva','rocketseat','fiap','mackenzie','unicesumar','unip','fmu','insper','fgv','alfacon','qconcursos'], ['faculda','curso','ensino','colegi','escola','universi','livrari'], ['gran cursos','cultura inglesa','sistema de ensino','livraria cultura']],
  ['lazer', ['cinemark','kinoplex','cinepolis','uci','ingresso','sympla','eventim','cinema','teatro','boliche','kart','playcenter','ticketmaster','ticket360','sesc','riot','epicgames','ubisoft'], ['ingress','cinem'], ['escape room','beto carrero','hopi hari']],
  ['compras', ['amazon','shopee','mercadolivre','magalu','magazine','americanas','submarino','casasbahia','pontofrio','kabum','fastshop','samsung','nike','adidas','decathlon','centauro','netshoes','dafiti','riachuelo','renner','marisa','pernambucanas','hering','zara','cea','shein','aliexpress','havan','leroy','telhanorte','tokstok','mobly','etna','petz','cobasi','petlove','kalunga','koerich','salfer','colombo','lebes','polishop','ikea','camicado','mmartan','youcom','animale','malwee','lupo','lacoste','levis','amaro','posthaus','kanui','sallve','boticario','natura','avon','sephora','oceane'], ['marketplace','amazon','papelari'], ['mercado livre','casas bahia','ponto frio','fast shop','tok stok','leroy merlin','madeira madeira','ri happy','pb kids','apple store','world tennis','track field','calvin klein','o boticario','quem disse','ricardo eletro']],
  ['moradia', ['aluguel','condominio','iptu','quintoandar','loft','energia','copel','celesc','cemig','cpfl','enel','equatorial','energisa','light','sabesp','sanepar','casan','samae','cedae','caesb','embasa','comgas','naturgy','ultragaz','liquigas','supergasbras','internet','vivo','claro','sky','algar','brisanet','unifique','gvt','tim','copasa','celpe','coelba','cosern','elektro','neoenergia','edp','rge'], ['condomin','imobil','energi','aluguel'], ['conta de gas','conta de telefone','seguro residencial','quinto andar','net servicos','net claro']],
];
function impScoreCat(toks) {
  const joined = ' ' + toks.join(' ') + ' ';
  const sc = {};
  for (const [cat, ex, pre, sub] of IMP_CATS) {
    let s = 0;
    for (const k of ex) if (toks.includes(k)) s += 10;
    for (const k of (pre || [])) if (toks.some(t => t.startsWith(k))) s += 7;
    for (const k of (sub || [])) if (joined.includes(' ' + k + ' ') || joined.includes(k)) s += 4;
    if (s) sc[cat] = s;
  }
  // "Mercado Livre / Pago" é e-commerce/fintech, NÃO supermercado — desfaz o
  // falso positivo do prefixo 'mercad' e joga pra compras.
  if (toks.includes('mercadolivre') || /\bmercado (livre|pago|pag)\b/.test(joined)) {
    delete sc.mercado; sc.compras = (sc.compras || 0) + 10;
  }
  return sc;
}
// Palpite de categoria + confiança (alta/média/baixa) — usado pra revisão dirigida.
function impGuessCat(desc) {
  const r = Object.entries(impScoreCat(impTokens(desc))).sort((a, b) => b[1] - a[1]);
  if (!r.length) { const lbl = impCategoryByLabel(desc); return { cat: lbl || 'outros', conf: lbl ? 'media' : 'baixa' }; }
  const top = r[0], second = r[1];
  let conf = 'media';
  if (top[1] >= 10 && (!second || top[1] - second[1] >= 6)) conf = 'alta';
  else if (top[1] < 7) conf = 'baixa';
  return { cat: top[0], conf };
}
function impCategorize(desc) { return impGuessCat(desc).cat; }
// Cobre categorias novas/custom: se a descrição contém o NOME da categoria.
function impCategoryByLabel(desc) {
  const d = impNormalize(desc);
  for (const [k, c] of Object.entries(CATEGORIES)) {
    if (k === 'outros' || !c || !c.label) continue;
    const lbl = impNormalize(c.label);
    if (lbl.length >= 3 && (' ' + d + ' ').includes(' ' + lbl + ' ')) return k;
  }
  return null;
}
const IMP_KIDS = ['bebe','bebes','baby','kids','infantil','escola','colegio','creche','bercario','pediatr','fralda','pampers','huggies','brinquedo','rihappy','pbkids','lilica','tigor','marisol','milium','luddi','clubkids'];
const IMP_FEM = ['oboticario','boticario','natura','avon','sephora','maquiagem','manicure','cabeleireiro','salao','depilacao','sobrancelha','estetica','maxiderma','dunnia','mazi'];
const IMP_MAL = ['barbearia','barber'];
function impHolderOwner(holder) {
  const h = (holder || '').toUpperCase();
  if (h.includes('WILLIAM')) return 'william';
  if (h.includes('FLAVIA') || h.includes('FERNANDA') || h.includes('VERGARA')) return 'flavia';
  return 'familia';
}
// De-quem: criança → louise; senão o PORTADOR nominal do cartão (sinal mais forte);
// só usa gênero (fem/masc) como desempate quando o portador é genérico.
function impPersonGuess(tx) {
  const toks = impTokens(tx.desc);
  const has = (arr) => arr.some(k => toks.some(t => t.startsWith(k)));
  if (has(IMP_KIDS)) return 'louise';
  const byHolder = impHolderOwner(tx.holder);
  if (byHolder !== 'familia') return byHolder;
  if (has(IMP_FEM)) return 'flavia';
  if (has(IMP_MAL)) return 'william';
  return 'familia';
}
// Fixa × variável: assinatura/moradia e dicas de gasto recorrente são fixas.
const IMP_FIXED_HINT = ['aluguel','condominio','energia','internet','mensalidade','escola','colegio','plano','seguro','financiamento','prestacao','iptu','ipva','consorcio','faculdade','universidade'];
function impNature(category, desc) {
  if (category === 'assinaturas' || category === 'moradia') return 'fixa';
  const toks = impTokens(desc);
  if (IMP_FIXED_HINT.some(h => toks.some(t => t.startsWith(h)))) return 'fixa';
  return 'variavel';
}
// Faturas Bradesco extraídas pelo SITE têm outro layout: titular "Final XXXX | NOME",
// data quebrada em dia/mês ("25"/"DEZ") em linhas separadas, vários cartões, parcela "( 02/04 )",
// e o ano só no vencimento. Detecta o formato e usa o parser certo.
const SITE_MONTHS = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const SITE_HOLDER = /Final\s+\d{3,}\s*\|\s*([A-ZÀ-Ý][A-ZÀ-Ý .'-]+?)\s*(?:Valor da fatura|$)/i;
const SITE_STOP = /resumo das despesas|total da fatura\s*\(.*final/i;
const SITE_SKIP = /(SALDO|PAGAMENTO|PAGTO|\bTOTAL\b|ENCARGOS|\bJUROS\b|ANUIDADE|\bIOF\b|MULTA|LIMITE|SEGURO|TARIFA|MENSALIDAD|CASHBACK|AJUSTE|DOLAR|D[OÓ]LAR|CONVERS|COTACAO|REPASSE|PROTEC|ASSIST|ROTATIV|VALOR DA FATURA|GASTOS REFERENTES|MOEDA DE ORIGEM|DATA LAN|MELHOR DATA|FORMA DE PAG|VALIDADE|DESPESAS|RESUMO)/i;
function parseStatement(lines) {
  const isSite = lines.some(L => /gastos referentes ao cart/i.test(L) || /final\s+\d{3,}\s*\|/i.test(L));
  return isSite ? parseStatementSite(lines) : parseStatementFlat(lines);
}
function parseStatementSite(lines) {
  const out = [];
  let faY = new Date().getFullYear(), faM = new Date().getMonth() + 1;   // competência = vencimento da fatura
  for (const L of lines) { const v = L.match(/vencimento\D*(\d{2})\/(\d{2})\/(\d{4})/i); if (v) { faM = +v[2]; faY = +v[3]; break; } }
  const money = (s) => s.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  let holder = '', curDay = null, curMonth = null, pending = [];
  const flush = (mo) => { for (const tx of pending) tx._mo = mo; pending = []; };
  for (const L0 of lines) {
    const L = L0.replace(/\s+/g, ' ').trim();
    if (!L) continue;
    if (SITE_STOP.test(L)) break;                                  // chegou no resumo → fim dos lançamentos
    const h = L.match(SITE_HOLDER); if (h) { holder = h[1].trim().toUpperCase(); continue; }
    if (/^\d{1,2}$/.test(L)) { const d = +L; if (d >= 1 && d <= 31) { curDay = d; continue; } }   // marcador de dia
    const mm = L.toUpperCase().replace('.', ''); if (SITE_MONTHS[mm]) { curMonth = SITE_MONTHS[mm]; flush(curMonth); continue; }  // marcador de mês
    if (SITE_SKIP.test(L)) continue;
    const ms = money(L); if (!ms.length) continue;
    let value = parseFloat(ms[ms.length - 1].replace(/\./g, '').replace(',', '.')); if (!isFinite(value)) continue;  // último valor = BRL
    const refund = value < 0; value = Math.abs(value); if (value === 0) continue;
    let desc = L; ms.forEach(v => { desc = desc.replace(v, ' '); });
    desc = desc.replace(/\b(USD|US\$|EUR|GBP|D[OÓ]LAR(?:ES)?)\b/gi, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    let inst = null;
    const pm = desc.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
    if (pm) { const k = +pm[1], tot = +pm[2]; if (k >= 1 && tot >= 2 && k <= tot && tot <= 72) { inst = k + '/' + tot; desc = desc.replace(pm[0], ' ').trim(); } }
    desc = desc.replace(/^PARC=\d+\s*/i, '').replace(/\s+/g, ' ').trim(); if (!desc) desc = '—';
    const tx = { _day: curDay, _mo: curMonth, desc, value, holder, inst, refund, _compY: faY, _compM: faM };
    pending.push(tx); out.push(tx);
  }
  for (const tx of out) { const d = tx._day || 1, mo = tx._mo || faM; const y = mo > faM ? faY - 1 : faY; tx.date = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`; delete tx._day; delete tx._mo; }
  return out;
}
function parseStatementFlat(lines) {
  const out = [];
  let holder = '';
  // Titular: "NOME - VISA/MASTERCARD/ELO/AMEX/...". Aceita acento, hífen (Vergara-Schulz), maiúsc/minúsc.
  const HOLDER = /^([A-ZÀ-Ýa-zà-ý][A-ZÀ-Ýa-zà-ý '.\-]{2,40}?)\s*[-–]\s*(?:VISA|MASTER(?:CARD)?|ELO|AMEX|AMERICAN|HIPERCARD|DINERS)\b/i;
  const DATE = /^(\d{2}\/\d{2})\s+(.+)$/;
  // Ruído de fatura (não é compra): pagamento, encargos, anuidade, IOF/juros, seguro/tarifa,
  // conversão de moeda estrangeira (linha própria — duplicaria a compra), cashback/ajuste/rotativo.
  const SKIP = /(SALDO ANTERIOR|SALDO ATUAL|PAGAMENTO|PAGTO|\bTOTAL\b|ENCARGOS|\bJUROS\b|ANUIDADE|\bIOF\b|MULTA|LIMITE|SEGURO|TARIFA|MENSALIDAD|CASHBACK|AJUSTE|DOLAR|D[OÓ]LAR|CONVERS|COTACAO|REPASSE|PROTEC|ASSIST|ROTATIV)/i;
  const moneyAll = (s) => s.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  for (const L of lines) {
    const h = L.match(HOLDER);
    if (h) { holder = h[1].replace(/\s+/g, ' ').trim().toUpperCase(); continue; }
    const m = L.match(DATE);
    if (!m) continue;
    let rest = m[2].replace(/\s+/g, ' ').trim();
    if (!rest || SKIP.test(rest)) continue;
    const monies = moneyAll(rest);
    if (!monies.length) continue;                         // linha sem valor → não é lançamento
    let value = parseFloat(monies[monies.length - 1].replace(/\./g, '').replace(',', '.'));  // último valor = BRL (mesmo em compra USD)
    if (!isFinite(value)) continue;
    const refund = value < 0;                             // crédito/estorno na fatura
    value = Math.abs(value);
    if (value === 0) continue;
    let desc = rest;
    monies.forEach(v => { desc = desc.replace(v, ' '); });                       // tira todos os valores da descrição
    desc = desc.replace(/\b(USD|US\$|EUR|GBP|D[OÓ]LAR(?:ES)?)\b/gi, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    // Parcela: só formato canônico no FIM ("03/10" ou "03 DE 10") ou prefixado por PARC; valida 1<=k<=tot<=72.
    let inst = null;
    const pm = desc.match(/(?:\bPARC(?:ELA)?\.?\s*)?\b(\d{1,2})\s*(?:\/|\s+DE\s+)\s*(\d{1,2})\s*$/i)
            || desc.match(/\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|\s+DE\s+)\s*(\d{1,2})\b/i);
    if (pm) {
      const k = +pm[1], tot = +pm[2];
      if (k >= 1 && tot >= 2 && k <= tot && tot <= 72) {
        inst = k + '/' + tot;
        desc = desc.replace(pm[0], ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    if (!desc) desc = '—';
    out.push({ date: m[1], desc, inst, value, holder, refund });
  }
  return out;
}
// impToISO, impFp → ./import-core.js (v8 Turno 11)
const impMoney = (n) => 'R$ ' + Math.abs(+n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// ---- Conta corrente (CSV do Bradesco) ----
// parseBRMoney → ./import-core.js (v8 Turno 11)
// Linhas que NÃO são despesa de consumo: transferências entre contas próprias,
// investimentos (CDB/fundos), saques, pagamento da fatura do cartão (pra não
// duplicar com o import do cartão), impostos e taxas.
const CC_SKIP = /(TRANSF CC PARA CC|TRANSFERENCIA ENTRE|APLICAC|RESGATE|RESG\/|SAQUE|GASTOS CARTAO|\bIOF\b|IRRF|TX REM|TAXA BTC|PAG JUROS|PAG DIVIDENDOS|COD\. LANC|REEMBOLSO|TARIFA|ANUIDADE|CESTA|PACOTE DE SERV|MANUTENCAO CONTA)/i;
// Crédito na conta que É renda de verdade (resto = transferência/aplicação/resgate → ignora).
const CC_INCOME = [
  [/sal[aá]rio|vencimento|folha\s*p|pro.?-?\s*labore|prolabore/i, 'salario'],
  [/dividend|\bjcp\b|proventos|rendimento|juros\s*s\/?\s*cap/i, 'dividendos'],
  [/distribuic|lucro/i, 'distribuicao'],
  [/restituic|ressarc|reembolso/i, 'outros'],
];
function ccIncomeSource(hist) { for (const [re, src] of CC_INCOME) if (re.test(hist)) return src; return null; }
function parseCheckingCSV(text) {
  const out = [];
  const rows = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const cell = (c) => String(c || '').replace(/^\s*"|"\s*$/g, '').trim();   // tira aspas/espaços
  // Detecta colunas pelo cabeçalho (fallback: layout padrão Bradesco data;hist;doc;crédito;débito;saldo).
  let dateCol = 0, histCol = 1, debCol = 4, credCol = 3;
  for (const line of rows) {
    const low = line.split(';').map(c => cell(c).toLowerCase());
    const di = low.findIndex(c => c === 'débito' || c === 'debito' || c.includes('saída') || c.includes('saida'));
    if (di >= 0) {
      debCol = di;
      const dt = low.findIndex(c => c.includes('data')); if (dt >= 0) dateCol = dt;
      const ht = low.findIndex(c => c.includes('hist') || c.includes('lanç') || c.includes('lanc') || c.includes('descri')); if (ht >= 0) histCol = ht;
      const cr = low.findIndex(c => c === 'crédito' || c === 'credito' || c.includes('entrada')); credCol = cr >= 0 ? cr : Math.max(0, di - 1);
      break;
    }
  }
  for (const line of rows) {
    const cols = line.split(';').map(cell);
    if (cols.length <= debCol) continue;
    const date = cols[dateCol] || '';
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;   // só linhas de lançamento (ignora cabeçalho/rodapé)
    const hist = cols[histCol] || '';
    const debito = parseBRMoney(cols[debCol]);
    const credito = credCol < cols.length ? parseBRMoney(cols[credCol]) : 0;
    if (debito > 0) {                                    // SAÍDA = despesa
      if (CC_SKIP.test(hist)) continue;                  // ruído: transf/invest/imposto/cartão/tarifa
      out.push({ date, desc: hist, value: debito, holder: '', inst: null, _src: 'cc' });
    } else if (credito > 0) {                            // ENTRADA = só se for renda de verdade
      const src = ccIncomeSource(hist);
      if (src) out.push({ date, desc: hist, value: credito, holder: '', inst: null, _src: 'cc', _kind: 'income', incomeCat: src });
      // crédito sem match de renda (transferência/aplicação/resgate) → ignora
    }
  }
  return out;
}

// Apaga todos os lançamentos importados (source: import:*). Arma no 1º clique,
// confirma no 2º (sem modal). Pra reimportar do zero quando o esquema muda.
let _clearArmed = false;
async function clearImportedExpenses() {
  const btn = $('btnClearImports'); if (!btn) return;
  const imported = (state.expenses || []).filter(e => String(e.source || '').startsWith('import:'));
  if (!imported.length) { showToast(t('imp.clear.none')); return; }
  if (!_clearArmed) {
    _clearArmed = true;
    if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
    btn.textContent = t('imp.clear.confirm').replace('{n}', imported.length);
    btn.classList.add('danger-armed');
    setTimeout(() => { if (_clearArmed) { _clearArmed = false; btn.textContent = btn.dataset.orig; btn.classList.remove('danger-armed'); } }, 4000);
    return;
  }
  _clearArmed = false; btn.classList.remove('danger-armed'); btn.textContent = btn.dataset.orig; btn.disabled = true;
  try {
    await Promise.allSettled(imported.map(e => deleteDoc(docExpense(e.id))));
    showToast(t('imp.clear.done').replace('{n}', imported.length));
  } catch (e) { console.error('[clear] failed', e); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; }
}

// Desfazer só o último import (por batchId) — mais cirúrgico que "limpar tudo".
function updateUndoBtn() {
  const btn = $('btnUndoImport'); if (!btn) return;
  const id = state.importMeta && state.importMeta.lastBatchId;
  const n = id ? (state.expenses || []).filter(e => e.batchId === id).length : 0;
  btn.hidden = n === 0;
}
let _undoArmed = false;
async function undoLastImport() {
  const btn = $('btnUndoImport'); if (!btn) return;
  const id = state.importMeta && state.importMeta.lastBatchId;
  const docs = id ? (state.expenses || []).filter(e => e.batchId === id) : [];
  if (!docs.length) { showToast(t('imp.undo.none')); return; }
  if (!_undoArmed) {
    _undoArmed = true;
    if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
    btn.textContent = t('imp.undo.confirm').replace('{n}', docs.length);
    btn.classList.add('danger-armed');
    setTimeout(() => { if (_undoArmed) { _undoArmed = false; btn.textContent = btn.dataset.orig; btn.classList.remove('danger-armed'); } }, 4000);
    return;
  }
  _undoArmed = false; btn.classList.remove('danger-armed'); btn.textContent = btn.dataset.orig; btn.disabled = true;
  try {
    await Promise.allSettled(docs.map(e => deleteDoc(docExpense(e.id))));
    setDoc(docImportMeta, { lastBatchId: null }, { merge: true }).catch(() => {});
    showToast(t('imp.undo.done').replace('{n}', docs.length));
  } catch (e) { console.error('[undo] failed', e); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; }
}

// ============================================================
//  ABA IMPORTAÇÕES — histórico dos imports + desfazer por lote específico
// ============================================================
function updateImportsBtn() {
  const btn = $('btnImports'); if (!btn) return;
  const m = state.importMeta || {};
  btn.hidden = !((m.history && m.history.length) || m.lastBatchId);   // legado: mostra se há lastBatchId
}
function fmtImpDate(at) {
  const ms = typeof at === 'number' ? at : (at && at.toMillis ? at.toMillis() : (at && at.seconds ? at.seconds * 1000 : 0));
  if (!ms) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderImportsList() {
  const list = $('importsList'); if (!list) return;
  const m = state.importMeta || {};
  let hist = [...((m.history) || [])];
  if (!hist.length && m.lastBatchId) hist = [{ batchId: m.lastBatchId, count: m.lastCount || 0, source: m.lastSource || 'cartao', at: m.lastAt, total: 0 }];   // legado
  hist.reverse();   // mais recente primeiro
  if (!hist.length) { list.innerHTML = `<div class="imports-empty">${t('imports.empty')}</div>`; return; }
  list.innerHTML = hist.map(h => {
    const n = (state.expenses || []).filter(e => e.batchId === h.batchId).length;
    const isConta = h.source === 'conta', gone = n === 0;
    const meta = `${n} ${n === 1 ? t('imports.entry') : t('imports.entries')} · ${fmtImpDate(h.at)}` + (h.total ? ` · <b class="mono">${fmtBRL(h.total)}</b>` : '');
    return `<div class="imports-item${gone ? ' is-gone' : ''}">
      <div class="imports-emoji">${isConta ? '🏦' : '💳'}</div>
      <div class="imports-info"><div class="imports-t">${t(isConta ? 'imports.src.conta' : 'imports.src.cartao')}</div><div class="imports-m">${meta}</div></div>
      <button class="imports-undo" data-batch="${esc(h.batchId)}"${gone ? ' disabled' : ''}>${gone ? t('imports.gone') : t('imports.undo')}</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.imports-undo[data-batch]:not([disabled])').forEach(b => b.addEventListener('click', () => confirmUndoImport(b.dataset.batch)));
}
function openImportsModal() { renderImportsList(); $('importsModal')?.classList.add('show'); }
function closeImportsModal() { $('importsModal')?.classList.remove('show'); }
function confirmUndoImport(batchId) {
  const docs = (state.expenses || []).filter(e => e.batchId === batchId);
  if (!docs.length) return;
  openConfirmModal({
    title: t('imports.undo.title'), sub: t('imports.undo.sub').replace('{n}', docs.length),
    confirmLabel: t('imports.undo.confirm'), cancelLabel: t('exp.btn.cancel'), danger: true,
    onConfirm: () => undoImport(batchId),
  });
}
async function undoImport(batchId) {
  const docs = (state.expenses || []).filter(e => e.batchId === batchId);
  if (!docs.length) return;
  try {
    await Promise.allSettled(docs.map(e => deleteDoc(docExpense(e.id))));
    const meta = state.importMeta || {};
    const patch = { history: ((meta.history) || []).filter(h => h.batchId !== batchId) };
    if (meta.lastBatchId === batchId) patch.lastBatchId = null;
    setDoc(docImportMeta, patch, { merge: true }).catch(() => {});
    showToast(t('imports.undo.done').replace('{n}', docs.length));
    setTimeout(renderImportsList, 350);
  } catch (e) { console.error('[undoImport]', e); showToast(t('toast.error.save')); }
}
$('btnImports')?.addEventListener('click', openImportsModal);
$('importsClose')?.addEventListener('click', closeImportsModal);
$('importsModal')?.addEventListener('click', e => { if (e.target.id === 'importsModal') closeImportsModal(); });

// ============================================================
//  PROVENTOS DO I10 → GANHOS (ao vivo, sem arquivo).
//  Puxa /i10/earnings-list/<wallet> (lista detalhada), filtra os JÁ PAGOS
//  (data de pagamento <= hoje), usa o valor LÍQUIDO (net_total_original, que
//  já vem com o IR de 17,5% do JCP descontado pelo I10), e joga na mesma
//  tela de revisão (abas por mês) + doImport (com dedup). Dono: William.
// ============================================================
const I10_PROV_TYPE = { JSCP: 'JCP', Dividendos: 'Dividendo', 'Rend. Trib.': 'Rendimento', 'Amortização': 'Amortização', Amortizacao: 'Amortização' };
async function importI10Proventos() {
  const { workerUrl, walletId } = state.i10Cfg || {};
  if (!workerUrl || !walletId) { showToast(t('i10prov.cfg') !== 'i10prov.cfg' ? t('i10prov.cfg') : 'Configure o worker e a carteira (⚙️) primeiro.'); return; }
  showToast('Puxando proventos do I10…');
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/i10/earnings-list/${encodeURIComponent(walletId)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const rows = (data && data.table && Array.isArray(data.table.data)) ? data.table.data : [];
    const today = new Date().toISOString().slice(0, 10);
    const txns = [];
    for (const r of rows) {
      const pay = String(r.date_payment_original || '').slice(0, 10);   // ISO YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pay) || pay > today) continue;    // só PAGOS (descarta futuros/provisionados)
      const val = Math.round((+r.net_total_original || 0) * 100) / 100; // líquido (IR já descontado pelo I10)
      if (!(val > 0)) continue;
      const [y, m, d] = pay.split('-');
      const tk = r.ticker || r.ticker_name || '?';
      const lbl = I10_PROV_TYPE[r.type] || r.type || 'Provento';
      txns.push({ date: `${d}/${m}/${y}`, desc: `${tk} · ${lbl}`, value: val, _kind: 'income', incomeCat: 'dividendos', _compY: +y, _compM: +m, _src: 'i10prov', _ownerHint: 'william', inst: null });
    }
    if (!txns.length) { showToast('Nenhum provento pago encontrado.'); return; }
    _importKind = 'i10prov';
    _importTxns = txns;
    renderImportReview();
  } catch (e) {
    console.error('[i10prov] falhou', e);
    showErrorPopup('Falha ao puxar proventos do I10', e);
  }
}

// AUTO-SYNC dos proventos do I10 → Ganhos (sem clicar). Roda junto de cada
// syncFromI10. Só lança os proventos JÁ PAGOS que ainda NÃO existem (dedup por
// fingerprint multiset, igual ao doImport → idempotente: re-rodar não duplica).
async function autoSyncProventos() {
  const { workerUrl, walletId } = state.i10Cfg || {};
  if (!workerUrl || !walletId) return;
  // CRÍTICO: NÃO rodar antes do snapshot de despesas chegar. Se `state.expenses`
  // ainda estiver vazio (não carregou), o existCount fica vazio e ele relança
  // TODOS os proventos como duplicata (dobra permanente). Espera o 1º snapshot.
  if (!state._expensesLoaded) return;
  let rows;
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const url = `${base}/i10/earnings-list/${encodeURIComponent(walletId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      let body = ''; try { body = (await res.text()).slice(0, 280); } catch (_) {}
      showErrorPopup('Proventos I10 — HTTP ' + res.status, new Error(res.statusText || ('HTTP ' + res.status)), { once: true, extra: 'GET ' + url + (body ? '\n\nResposta:\n' + body : '\n\n(provável: o worker não tem o endpoint /i10/earnings-list — falta publicar a versão nova)') });
      return;
    }
    const data = await res.json();
    rows = (data && data.table && Array.isArray(data.table.data)) ? data.table.data : [];
  } catch (e) { console.warn('[autoprov] fetch', e); showErrorPopup('Falha ao buscar proventos do I10', e, { once: true, extra: 'walletId ' + walletId }); return; }
  const today = new Date().toISOString().slice(0, 10);
  // multiset dos proventos JÁ existentes (income lançado por aqui)
  const stripOrd = s => String(s || '').replace(/#\d+$/, '');
  const existCount = {};
  for (const e of (state.expenses || [])) {
    if (e.type !== 'income') continue;
    const b = e.fpBase || stripOrd(e.fp || impFp(e.date, e.value, e.description));
    existCount[b] = (existCount[b] || 0) + 1;
  }
  // parseia os pagos e ordena cronologicamente (idx estável p/ o multiset)
  const parsed = [];
  for (const r of rows) {
    const pay = String(r.date_payment_original || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pay) || pay > today) continue;   // só pagos
    const val = Math.round((+r.net_total_original || 0) * 100) / 100; // líquido
    if (!(val > 0)) continue;
    const tk = r.ticker || r.ticker_name || '?';
    const lbl = I10_PROV_TYPE[r.type] || r.type || 'Provento';
    parsed.push({ pay, val, desc: `${tk} · ${lbl}` });
  }
  parsed.sort((a, b) => (a.pay < b.pay ? -1 : a.pay > b.pay ? 1 : 0));
  const used = {}, toAdd = [];
  for (const p of parsed) {
    const baseFp = impFp(p.pay, p.val, p.desc);
    const idx = used[baseFp] || 0; used[baseFp] = idx + 1;
    if (idx < (existCount[baseFp] || 0)) continue;   // já existe → pula
    toAdd.push({
      type: 'income', description: p.desc, value: p.val, category: 'dividendos', owner: 'william', nature: null,
      source: 'auto:i10prov', date: p.pay, competencia: p.pay.slice(0, 7),
      fp: idx === 0 ? baseFp : baseFp + '#' + idx, fpBase: baseFp,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'auto', notes: '',
    });
  }
  if (!toAdd.length) return;
  toAdd.forEach(d => addDoc(colExpenses(), d).catch(err => console.error('[autoprov] doc', err)));
  showToast(toAdd.length === 1 ? '1 provento novo nos Ganhos' : `${toAdd.length} proventos novos nos Ganhos`);
}

let _importTxns = [];
let _importKind = null;   // 'card' (PDF) | 'cc' (CSV) | 'i10prov' (proventos I10 ao vivo)
let _importComp = null;   // competência (YYYY-MM) escolhida na revisão quando a fatura é de 1 mês só
async function handleImportFiles(fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ov = $('importOverlay');
  // Estado "lendo": overlay premium com o anel girando enquanto os arquivos são parseados.
  if (ov && !reduce) {
    ov.classList.remove('done', 'out', 'scanning');
    ov.querySelectorAll('.imp-pnode').forEach(n => n.classList.remove('act', 'fin'));
    ov.querySelectorAll('.imp-pconn').forEach(c => c.classList.remove('fill'));
    { const r = $('impRows'); if (r) r.innerHTML = ''; }
    ov.classList.add('reading'); ov.hidden = false;
    if ($('importOvText')) $('importOvText').textContent = t('imp.reading');
    if ($('importOvSub')) $('importOvSub').textContent = files.length === 1 ? (files[0].name || '') : t('imp.reading.n').replace('{n}', files.length);
  } else { showToast(t('imp.reading')); }
  const startedAt = Date.now();
  const all = [];
  try {
    for (const file of files) {
      const isCsv = _importKind ? (_importKind === 'cc') : (/\.csv$/i.test(file.name || '') || file.type === 'text/csv');
      const lines = isCsv ? null : await extractPdfLines(file);
      const txns = isCsv ? parseCheckingCSV(await file.text()) : parseStatement(lines);
      // Competência por ARQUIVO (cartão) = MÊS DE PAGAMENTO da fatura (vencimento), não o mês
      // da compra. A despesa do cartão pesa no orçamento quando a fatura é paga.
      if (!isCsv && txns.length && !txns[0]._compY) {   // parser do site já marca a competência; só completa se faltar
        let ym = null;
        // 1) data de vencimento explícita na fatura → mês de pagamento real
        for (const L of (lines || [])) { const v = String(L).match(/vencimento\D*(\d{2})\/(\d{2})\/(\d{4})/i); if (v) { ym = `${v[3]}-${v[2]}`; break; } }
        // 2) fatura em aberto (sem vencimento): mês da última compra + 1 (paga no mês seguinte)
        if (!ym) {
          let mx = null;
          for (const tx of txns) { const mo = impToISO(tx.date).slice(0, 7); if (!mx || mo > mx) mx = mo; }
          if (mx) { const yy = +mx.slice(0, 4), mm = +mx.slice(5, 7); const t0 = yy * 12 + (mm - 1) + 1; ym = `${Math.floor(t0 / 12)}-${String((t0 % 12) + 1).padStart(2, '0')}`; }
        }
        if (ym) txns.forEach(tx => { tx._compY = +ym.slice(0, 4); tx._compM = +ym.slice(5, 7); });
      }
      all.push(...txns);
    }
  } catch (e) {
    console.error('[import] read failed', e);
    if (ov) { ov.hidden = true; ov.classList.remove('reading'); }
    showErrorPopup('Falha ao ler o arquivo', e, { extra: 'Arquivo(s): ' + files.map(f => f.name || '?').join(', ') });
    return;
  }
  // Segura o overlay no mínimo ~760ms pra leitura não "piscar".
  if (ov && !reduce) {
    const el = Date.now() - startedAt;
    if (el < 760) await new Promise(r => setTimeout(r, 760 - el));
    ov.hidden = true; ov.classList.remove('reading');
  }
  if (!all.length) { showToast(t('imp.none')); return; }
  _importTxns = all;
  renderImportReview();
}
function impUpdateConfirm() {
  const n = document.querySelectorAll('#importList .imp-row input[type="checkbox"]:checked').length;
  const btn = $('importConfirm');
  if (btn) { btn.textContent = t('imp.confirm').replace('{n}', n); btn.disabled = n === 0; }
  // "Selecionar todos" reflete as linhas VISÍVEIS (respeita a aba de mês ativa)
  const master = $('impSelectAll');
  if (master) {
    const vis = [...document.querySelectorAll('#importList .imp-row:not(.is-hidden) input[type="checkbox"]')];
    const c = vis.filter(x => x.checked).length;
    master.checked = vis.length > 0 && c === vis.length;
    master.indeterminate = c > 0 && c < vis.length;
  }
}
// Marca/desmarca todas as linhas VISÍVEIS (da aba ativa). "Selecionar todos".
function impSetAllVisible(checked) {
  document.querySelectorAll('#importList .imp-row:not(.is-hidden) input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
  impUpdateConfirm();
}
// Recorrência: mesmo estabelecimento (chave normalizada) já visto em ≥2 meses
// com valor ~igual → provável assinatura/conta fixa.
function impRecurrence(tx) {
  const key = impRuleKey(tx.desc);
  if (!key) return false;
  const months = new Set();
  for (const e of (state.expenses || [])) {
    if (impRuleKey(e.description) !== key) continue;
    if (tx.value && Math.abs((+e.value || 0) - tx.value) / tx.value > 0.05) continue;
    months.add(String(e.date || '').slice(0, 7));
  }
  return months.size >= 2;
}
function renderImportReview() {
  const ownerOpts = OWNERS.map(o => `<option value="${o}">${esc(t('exp.owner.' + o))}</option>`).join('');
  const catOpts = catsAZ().map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');
  let lowN = 0;
  const built = _importTxns.map((tx, i) => {
    const rule = (state.importRules || {})[impRuleKey(tx.desc)];
    let cat, conf;
    if (rule && rule.category) { cat = rule.category; conf = 'alta'; }       // memória = confiança alta
    else { const g = impGuessCat(tx.desc); cat = g.cat; conf = g.conf; }
    const owner = (rule && rule.owner) || tx._ownerHint || impPersonGuess(tx);
    const rec = !rule && impRecurrence(tx);
    if (rec && cat !== 'assinaturas') { cat = 'assinaturas'; conf = 'alta'; } // recorrente → assinatura
    const isInc = tx._kind === 'income';
    const low = conf === 'baixa' && !tx.refund && !isInc;
    if (low) lowN++;
    // Todos os portadores são cartões ADICIONAIS do casal → todo lançamento é gasto de vocês.
    // Só o estorno (crédito/devolução) vem desmarcado por padrão.
    const checked = !tx.refund ? 'checked' : '';
    const badges = (tx.inst ? `<span class="imp-badge">${esc(tx.inst)}</span> ` : '')
      + (tx.refund ? `<span class="imp-badge ref">${esc(t('imp.refund'))}</span> ` : '')
      + (isInc ? `<span class="imp-badge inc">${esc(t('imp.income'))}</span> ` : '')
      + (rec ? `<span class="imp-badge rec">${esc(t('imp.recurring'))}</span> ` : '')
      + (low ? `<span class="imp-badge low" title="${esc(t('imp.lowconf'))}">?</span> ` : '');
    const card = tx.holder ? `<span class="imp-card">· ${esc(t('imp.cardword'))} ${esc(tx.holder.split(' ')[0])}</span>` : '';
    const comp = (tx._compY && tx._compM) ? `${tx._compY}-${String(tx._compM).padStart(2, '0')}` : '';
    const html = `<div class="imp-row${low ? ' imp-low' : ''}" data-comp="${comp}">
      <input type="checkbox" data-idx="${i}" ${checked}>
      <span class="imp-date">${esc(tx.date)}</span>
      <span class="imp-desc">${esc(tx.desc)} ${badges}${card}</span>
      <select class="imp-owner" data-idx="${i}">${ownerOpts.replace(`value="${owner}"`, `value="${owner}" selected`)}</select>
      <select class="imp-cat" data-idx="${i}">${catOpts.replace(`value="${cat}"`, `value="${cat}" selected`)}</select>
      <span class="imp-val${(tx.refund || isInc) ? ' ref' : ''}">${(tx.refund || isInc) ? '+ ' : ''}${impMoney(tx.value)}</span>
    </div>`;
    return { low, order: i, comp, html };
  });
  // Agrupa por competência (o mês de cada fatura) e, dentro de cada mês, joga os
  // "a conferir" pro topo. O DOM fica ordenado por mês → as abas só mostram/escondem.
  const comps = [...new Set(built.map(b => b.comp).filter(Boolean))].sort();
  const compRank = c => { const k = comps.indexOf(c); return k < 0 ? comps.length : k; };
  const rows = built.sort((a, b) => (compRank(a.comp) - compRank(b.comp)) || ((a.low ? 0 : 1) - (b.low ? 0 : 1)) || (a.order - b.order)).map(o => o.html).join('');
  $('importList').innerHTML = rows;
  renderImportTabs(built, comps);
  // Seletor de mês de pagamento: aparece quando a fatura é de UM mês só (caso comum),
  // pra confirmar/ajustar a competência (o mês em que a fatura será paga).
  const msel = $('impMonthSel');
  if (msel) {
    if (comps.length === 1) {
      _importComp = comps[0];
      const [yy, mm] = _importComp.split('-');
      const mn = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
      if ($('impMonthLabel')) $('impMonthLabel').textContent = `${mn[+mm - 1]} ${yy}`;
      msel.hidden = false;
    } else { _importComp = null; msel.hidden = true; }
  }
  $('importCount').textContent = _importTxns.length;
  const note = $('importLowNote');
  if (note) { if (lowN > 0) { note.textContent = ' · ' + t('imp.uncertain').replace('{n}', lowN); note.hidden = false; } else note.hidden = true; }
  $('importModal').classList.add('show');
  impUpdateConfirm();
}
// Abas por competência: quando o import junta várias faturas (vários meses),
// separa a revisão em abas (Jan/26, Fev/26, …) pra ficar mais fácil de conferir.
// As linhas continuam todas no DOM (estado preservado) — a aba só mostra/esconde.
function renderImportTabs(built, comps) {
  const wrap = $('importTabs');
  if (!wrap) return;
  if (!comps || comps.length < 2) { wrap.hidden = true; wrap.innerHTML = ''; return; }  // 1 mês só → sem abas
  wrap.hidden = false;
  const mn = getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT;
  const tab = (comp, label, n, low) =>
    `<button class="imp-tab" data-comp="${comp}">${esc(label)}<span class="imp-tab-n">${n}</span>`
    + (low ? `<span class="imp-tab-warn" title="${esc(t('imp.lowconf'))}">${low}</span>` : '')
    + `</button>`;
  let html = tab('all', t('imp.tab.all'), built.length, built.filter(b => b.low).length);
  for (const c of comps) {
    const grp = built.filter(b => b.comp === c);
    const [y, m] = c.split('-');
    html += tab(c, `${mn[+m - 1]}/${y.slice(2)}`, grp.length, grp.filter(b => b.low).length);
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll('.imp-tab').forEach(b => b.addEventListener('click', () => impSetActiveMonth(b.dataset.comp)));
  impSetActiveMonth(comps[0]);   // começa no mês mais antigo → revisão cronológica
}
function impSetActiveMonth(comp) {
  $('importTabs')?.querySelectorAll('.imp-tab').forEach(b => b.classList.toggle('act', b.dataset.comp === comp));
  document.querySelectorAll('#importList .imp-row').forEach(r =>
    r.classList.toggle('is-hidden', comp !== 'all' && r.dataset.comp !== comp));
  const list = $('importList'); if (list) list.scrollTop = 0;
  impUpdateConfirm();   // atualiza o "selecionar todos" pro mês ativo
}
// Seletor de mês de pagamento (revisão de fatura de 1 mês): joga TODOS os lançamentos
// pro mês escolhido — pra corrigir quando o palpite de vencimento não bate.
function shiftImportMonth(delta) {
  if (!_importComp) return;
  const [yy, mm] = _importComp.split('-').map(Number);
  const t0 = yy * 12 + (mm - 1) + delta;
  if (t0 < 0) return;
  const ny = Math.floor(t0 / 12), nm = (t0 % 12) + 1;
  _importTxns.forEach(tx => { tx._compY = ny; tx._compM = nm; });
  renderImportReview();
}
$('impMonthPrev')?.addEventListener('click', () => shiftImportMonth(-1));
$('impMonthNext')?.addEventListener('click', () => shiftImportMonth(1));
async function doImport() {
  // Segurança: sem o snapshot de despesas, o dedup não tem com o que comparar →
  // poderia duplicar. Bloqueia até carregar (na prática já carregou ao abrir o modal).
  if (!state._expensesLoaded) { showToast('Aguarde os dados carregarem e tente de novo.'); return; }
  // Dedup MULTISET por fingerprint-base: conta quantas ocorrências de cada base já
  // existem; a 1ª ocorrência usa o base, repetições ganham sufixo #1,#2... Assim
  // 2 compras iguais legítimas NÃO se anulam, e reimportar o mesmo extrato é idempotente.
  const stripOrd = (s) => String(s || '').replace(/#\d+$/, '');
  const existCount = {};
  for (const e of (state.expenses || [])) {
    const b = e.fpBase || stripOrd(e.fp || impFp(e.date, e.value, e.description));
    existCount[b] = (existCount[b] || 0) + 1;
  }
  const used = {};   // conta as ocorrências DESTE import (0,1,2...)
  const fpFor = (baseFp) => {
    const idx = used[baseFp] || 0; used[baseFp] = idx + 1;
    if (idx < (existCount[baseFp] || 0)) return null;          // as primeiras N já existem no banco → pula (reimport idempotente)
    return { fp: idx === 0 ? baseFp : baseFp + '#' + idx, fpBase: baseFp };
  };
  // Competência POR TRANSAÇÃO: cada fatura (arquivo) tem seu mês, marcado em _compY/_compM
  // no parse → permite importar vários meses de uma vez sem jogar tudo no mês mais recente.
  const txBase = (tx) => {
    if (tx._compY && tx._compM) return [tx._compY, tx._compM];
    const iso = impToISO(tx.date); return [+iso.slice(0, 4), +iso.slice(5, 7)];
  };
  const monthISO = (tx, off) => { const [by, bm] = txBase(tx); const t0 = by * 12 + (bm - 1) + off; return `${Math.floor(t0 / 12)}-${String((t0 % 12) + 1).padStart(2, '0')}-15`; };
  // competência "YYYY-MM" (mês da fatura, +off pras parcelas) — usada pra AGRUPAR o mês,
  // enquanto `date` guarda a data REAL da compra (pra a lista mostrar a data certa).
  const compStr = (tx, off) => { const [by, bm] = txBase(tx); const t0 = by * 12 + (bm - 1) + off; return `${Math.floor(t0 / 12)}-${String((t0 % 12) + 1).padStart(2, '0')}`; };

  const checks = [...document.querySelectorAll('#importList .imp-row input[type="checkbox"]:checked')];
  const batchId = 'b' + Date.now().toString(36);   // marca o lote pra permitir desfazer só este import
  const batch = []; let provCount = 0; const learned = {};
  for (const cb of checks) {
    const tx = _importTxns[+cb.dataset.idx];
    if (!tx) continue;
    const row = cb.closest('.imp-row');
    const owner = row.querySelector('.imp-owner').value;
    const category = row.querySelector('.imp-cat').value;
    // RECEITA detectada na conta (crédito = salário/dividendos/pró-labore) → vira ganho.
    if (tx._kind === 'income') {
      const idate = impToISO(tx.date, txBase(tx)[0]);
      const got = fpFor(impFp(idate, tx.value, tx.desc));
      if (!got) continue;
      batch.push({ type: 'income', description: tx.desc, value: tx.value, category: tx.incomeCat || 'outros', owner, nature: null, source: tx._src === 'i10prov' ? 'import:i10' : 'import:conta', batchId, date: idate, competencia: compStr(tx, 0), fp: got.fp, fpBase: got.fpBase, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'import', notes: '' });
      continue;
    }
    const nat = impNature(category, tx.desc);
    // Memória esperta: só aprende quando o usuário CORRIGIU o palpite ou confirmou
    // algo de alta confiança — não decora palpites incertos deixados como vieram.
    const _g = impGuessCat(tx.desc);
    const rk = impRuleKey(tx.desc);   // chave da regra; pode ser '' (desc só com nº/símbolos)
    // rk vazio NÃO pode virar campo do Firestore (rejeita nome de campo vazio → quebrava o import).
    if (rk && (category !== _g.cat || owner !== impPersonGuess(tx) || _g.conf === 'alta')) {
      learned[rk] = { category, owner, nature: nat };
    }
    const cardNote = tx.holder ? ('cartão: ' + tx.holder.split(' ')[0]) : '';
    const base = { type: 'expense', description: tx.desc, value: tx.value, category, owner, nature: nat, source: 'import:' + (tx._src === 'cc' ? 'conta' : 'cartao'), batchId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'import' };
    const realDate = impToISO(tx.date, txBase(tx)[0]);  // data REAL (estável p/ o fingerprint; ano da competência do arquivo)
    const im = (tx.inst || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    if (im) {
      // PARCELADO: provisiona da parcela atual (X) até a última (Y), uma por mês à frente.
      const X = +im[1], Y = +im[2];
      const valKey = (Math.round(tx.value * 100) / 100).toFixed(2);
      const descKey = impRuleKey(tx.desc);             // chave normalizada (mais entropia que slice cru)
      for (let k = X; k <= Y; k++) {
        const off = k - X, prov = off > 0;
        // base ancorada à compra-mãe (descKey + valor + data real) → não colide com outra compra de mesmo prefixo
        const got = fpFor(`parc|${descKey}|${valKey}|${realDate}|${k}/${Y}`);
        if (!got) continue;
        if (prov) provCount++;
        batch.push({ ...base, date: off === 0 ? realDate : monthISO(tx, off), competencia: compStr(tx, off), fp: got.fp, fpBase: got.fpBase, provisioned: prov, installment: { k, total: Y },
          notes: [cardNote, `parcela ${k}/${Y}` + (prov ? ' · provisão' : '')].filter(Boolean).join(' · ') });
      }
    } else {
      // Data REAL da compra no `date` (a lista mostra a data certa); `competencia` agrupa no mês da fatura.
      const got = fpFor(impFp(realDate, tx.value, tx.desc));
      if (!got) continue;
      batch.push({ ...base, date: realDate, competencia: compStr(tx, 0), fp: got.fp, fpBase: got.fpBase, notes: cardNote });
    }
  }
  if (!batch.length) { showToast(t('imp.alldup')); return; }
  // memória que aprende: guarda as escolhas (estabelecimento → categoria/de-quem) pro próximo import
  // Defesa extra: nunca mandar chave vazia (o setDoc VALIDA síncrono e LANÇA na
  // hora — não rejeita — então sem o try um dado inválido abortaria o import).
  delete learned[''];
  if (Object.keys(learned).length) {
    try { setDoc(docImportRules, { rules: learned, updatedAt: serverTimestamp() }, { merge: true }).catch(e => console.warn('[import] rules save', e)); }
    catch (e) { console.warn('[import] rules save (sync)', e); }
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ov = $('importOverlay');
  $('importConfirm').disabled = true; $('importCancel').disabled = true;
  // A animação cobre o modal e a gravação vai em LOTE por baixo. writeBatch = 1
  // ida ao servidor por ~450 docs (era 1 por doc → lento + re-render a cada um →
  // os "~10s por trás"). Só fecha o modal DEPOIS de gravar; se falhar, o modal
  // fica ABERTO com as escolhas dela intactas (nunca perde o trabalho).
  try {
    const previewRows = batch.slice(0, 5).map(d => {
      const c = CATEGORIES[d.category] || CATEGORIES.outros;
      return { date: formatDateBR(d.date), desc: d.description || '—', cat: c.label, col: c.color, val: fmtBRL0(+d.value || 0) };
    });
    if (ov && !reduce) runImportAnimation(ov, previewRows, batch.length, provCount);
    // Grava em lote(s) de 450 (limite do Firestore é 500/lote). O await detecta falha real.
    for (let i = 0; i < batch.length; i += 450) {
      const wb = writeBatch(db);
      for (const d of batch.slice(i, i + 450)) wb.set(doc(colExpenses()), d);
      await wb.commit();
    }
    // Navega a aba Despesas pro mês (competência) dos lançamentos importados — senão
    // parece que "não subiu nada" quando a fatura é de um mês diferente do que está aberto.
    try {
      const comps = batch.filter(d => !d.provisioned && d.competencia).map(d => d.competencia);
      if (comps.length) {
        const cnt = {}; comps.forEach(c => { cnt[c] = (cnt[c] || 0) + 1; });
        const tgt = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];   // mês mais comum entre os lançamentos reais
        const [yy, mm] = tgt.split('-').map(Number);
        if (yy && mm) state.currentViewMonth = new Date(yy, mm - 1, 1);
      }
    } catch (_) {}
    // Histórico de imports (últimos 15) — alimenta a aba "Importações" com undo por lote.
    const _impSrc = (_importKind === 'cc' ? 'conta' : 'cartao');
    const _impTotal = batch.reduce((s, d) => s + (+d.value || 0), 0);
    const _impEntry = { batchId, count: batch.length, source: _impSrc, at: Date.now(), total: _impTotal };
    const _impHist = [...((state.importMeta && state.importMeta.history) || []), _impEntry].slice(-15);
    setDoc(docImportMeta, { lastBatchId: batchId, lastCount: batch.length, lastSource: _impSrc, lastAt: serverTimestamp(), history: _impHist }, { merge: true }).catch(() => {});
    $('importModal').classList.remove('show');   // sucesso → fecha (sob o overlay da animação)
    if (ov && !reduce) await new Promise(r => setTimeout(r, 4250));   // deixa a animação completar
    else showToast(t('imp.done').replace('{n}', batch.length));
    if (typeof renderExpenses === 'function') try { renderExpenses(); } catch (_) {}   // já mostra o mês importado
  } catch (e) {
    console.error('[import] commit falhou', e);
    if (ov) { ov.hidden = true; ov.classList.remove('done', 'out', 'reading', 'scanning'); }   // tira a animação → revela o modal (aberto, intacto)
    showErrorPopup('Não consegui importar — suas escolhas foram mantidas, tente de novo', e, { extra: 'Lote de ' + batch.length + ' lançamento(s).' });
  } finally {
    if (ov) { ov.hidden = true; ov.classList.remove('done', 'out', 'reading', 'scanning'); }
    $('importConfirm').disabled = false; $('importCancel').disabled = false;
  }
}
// Anima o import: pipeline (Lendo → Categorizando → Pronto) + scan do documento
// + extração ao vivo das linhas reais + check/faíscas no fim. Timeline fixa ~4.2s.
function runImportAnimation(ov, rows, count, prov) {
  const nodes = [...ov.querySelectorAll('.imp-pnode')];
  const conns = [...ov.querySelectorAll('.imp-pconn')];
  const rowsEl = $('impRows'), txt = $('importOvText'), sub = $('importOvSub');
  ov.classList.remove('done', 'out', 'reading'); ov.classList.add('scanning');
  nodes.forEach(n => n.classList.remove('act', 'fin'));
  conns.forEach(c => c.classList.remove('fill'));
  if (rowsEl) rowsEl.innerHTML = rows.map(r =>
    `<div class="imp-rrow"><span class="rd">${esc(r.date)}</span><span class="rm">${esc(r.desc)}</span><span class="rc" style="--rc:${r.col}">${esc(r.cat)}</span><span class="rv">${esc(r.val)}</span></div>`).join('');
  const rrows = rowsEl ? [...rowsEl.querySelectorAll('.imp-rrow')] : [];
  ov.hidden = false;
  // Etapa 1 — Lendo (scan varrendo o documento)
  nodes[0] && nodes[0].classList.add('act');
  if (txt) txt.textContent = t('imp.stage.read') + '…';
  if (sub) sub.textContent = '';
  // Etapa 2 — Categorizando (linhas entram uma a uma + contador subindo)
  setTimeout(() => {
    ov.classList.remove('scanning');
    conns[0] && conns[0].classList.add('fill');
    nodes[0] && nodes[0].classList.remove('act'); nodes[1] && nodes[1].classList.add('act');
    if (txt) txt.textContent = t('imp.stage.cat') + '…';
  }, 850);
  rrows.forEach((r, i) => setTimeout(() => r.classList.add('in'), 1050 + i * 220));
  if (sub) setTimeout(() => { sub._cuVal = 0; countUpEl(sub, count, n => Math.round(n) + ' ' + t('imp.imported')); }, 1100);
  // Etapa 3 — Pronto (check verde + faíscas + resumo)
  setTimeout(() => {
    conns[1] && conns[1].classList.add('fill');
    nodes[1] && nodes[1].classList.remove('act'); nodes[2] && nodes[2].classList.add('act', 'fin');
    ov.classList.add('done');
    if (txt) txt.textContent = t('imp.ready');
    if (sub) { sub._cuVal = count; countUpEl(sub, count, n => '✓ ' + Math.round(n) + ' ' + t('imp.imported') + (prov > 0 ? ' · +' + prov + ' ' + t('imp.prov') : '')); }
  }, 2500);
  setTimeout(() => ov.classList.add('out'), 3830);   // fade-out
}
// Importar: abre o seletor de origem; a escolha define o accept + o parser.
$('btnImportStatement')?.addEventListener('click', () => $('importTypeModal')?.classList.add('show'));
$('importTypeCancel')?.addEventListener('click', () => $('importTypeModal')?.classList.remove('show'));
$('importTypeModal')?.addEventListener('click', e => { if (e.target.id === 'importTypeModal') $('importTypeModal').classList.remove('show'); });
document.querySelectorAll('#importTypeModal .imp-type-opt').forEach(b => b.addEventListener('click', () => {
  _importKind = b.dataset.kind;
  $('importTypeModal').classList.remove('show');
  if (_importKind === 'i10prov') { importI10Proventos(); return; }   // puxa ao vivo, sem arquivo
  const f = $('impFile');
  if (f) { f.setAttribute('accept', _importKind === 'cc' ? 'text/csv,.csv' : 'application/pdf,.pdf'); f.value = ''; f.click(); }
}));
$('impFile')?.addEventListener('change', (e) => { const files = e.target.files; const f = e.target; handleImportFiles(files).finally(() => { f.value = ''; }); });
$('importCancel')?.addEventListener('click', () => $('importModal').classList.remove('show'));
$('importConfirm')?.addEventListener('click', doImport);
// "Limpar importados" removido da UI (risco). Função clearImportedExpenses mantida
// inerte; o botão "Desfazer último" cobre o caso seguro de reverter o último import.
$('btnUndoImport')?.addEventListener('click', undoLastImport);
// Escape de emergência: clicar no overlay (ou Esc) fecha, caso algo trave.
$('importOverlay')?.addEventListener('click', () => {
  const o = $('importOverlay'); if (o) { o.hidden = true; o.classList.remove('done', 'out'); }
  const c = $('importConfirm'), x = $('importCancel'); if (c) c.disabled = false; if (x) x.disabled = false;
});
$('importList')?.addEventListener('change', (e) => { if (e.target.matches('input[type="checkbox"]')) impUpdateConfirm(); });
$('impSelectAll')?.addEventListener('change', (e) => impSetAllVisible(e.target.checked));
// Clicar na linha alterna o checkbox — MENOS quando o clique é num <select>
// (dono/categoria) ou no próprio checkbox. Antes a linha era um <label> e mexer
// no select alternava/desmarcava a linha sem querer (bug no iOS → "não deixa importar").
$('importList')?.addEventListener('click', (e) => {
  if (e.target.closest('select') || e.target.matches('input[type="checkbox"]')) return;
  const row = e.target.closest('.imp-row'); if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]'); if (!cb) return;
  cb.checked = !cb.checked;
  impUpdateConfirm();
});

$('btnAddExpense').addEventListener('click', () => openExpenseModal(null, { type: 'expense' }));

// Atalhos de teclado (desktop): / busca · N nova despesa · 1/2 troca aba · ←/→ mês
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (document.querySelector('.modal-bg.show')) return;     // modal manda no teclado
  if (!state.user) return;
  switch (e.key) {
    case '/': { const s = $('expSearch'); if (s) { e.preventDefault(); s.focus(); } break; }
    case 'n': case 'N': e.preventDefault(); openExpenseModal(null, { type: 'expense' }); break;
    case '1': if (typeof switchMode === 'function') switchMode('investments'); break;
    case '2': if (typeof switchMode === 'function') switchMode('expenses'); break;
    case 'ArrowLeft':  if (state.mode === 'expenses') $('btnPrevMonth')?.click(); break;
    case 'ArrowRight': if (state.mode === 'expenses') $('btnNextMonth')?.click(); break;
  }
});
$('btnAddIncome')?.addEventListener('click', () => openExpenseModal(null, { type: 'income' }));
// Modal type toggle (Saída / Ganho)
document.querySelectorAll('#expenseModal .exp-type-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalType(btn.dataset.type));
});
// Modal owner segmented picker
document.querySelectorAll('#expenseModal .exp-owner-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalOwner(btn.dataset.owner));
});
// Modal fixa/variável picker
document.querySelectorAll('#expenseModal .exp-nat-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalNature(btn.dataset.nature));
});
$('expCancel').addEventListener('click', closeExpenseModal);
$('expSave').addEventListener('click', saveExpense);
$('expDelete').addEventListener('click', deleteExpense);
$('expenseModal').addEventListener('click', e => { if (e.target.id === 'expenseModal') closeExpenseModal(); });

// Live BRL mask on the value input — format on blur + keep cursor-friendly typing
(() => {
  const el = $('expValue');
  if (!el) return;
  el.addEventListener('blur', () => {
    const n = parseBRLInput(el.value);
    el.value = n > 0 ? fmtBRLInput(n) : '';
  });
  // Allow only digits, comma, dot, R, $, space — quietly strip the rest
  el.addEventListener('input', () => {
    const cleaned = el.value.replace(/[^\d.,R$\s]/gi, '');
    if (cleaned !== el.value) el.value = cleaned;
  });
  // Enter commits mask then triggers save
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { el.blur(); saveExpense(); }
  });
})();

// I10 modal
$('btnEditI10')?.addEventListener('click', openI10Modal);
$('i10Cancel').addEventListener('click', closeI10Modal);
$('i10Save').addEventListener('click', saveI10);
$('i10Modal').addEventListener('click', e => { if (e.target.id === 'i10Modal') closeI10Modal(); });

// I10 Sync button + Config modal
$('btnSyncI10')?.addEventListener('click', syncFromI10);
$('btnImportHistory')?.addEventListener('click', importHistoryFromI10);
document.getElementById('btnAddContrib')?.addEventListener('click', () => { _editingMonth = null; openContribModal(); });
document.getElementById('contribCancel')?.addEventListener('click', closeContribModal);
document.getElementById('contribSave')?.addEventListener('click', saveContrib);
document.getElementById('contribDelete')?.addEventListener('click', deleteContrib);
// BRL mask on the contribution amount (same UX as the expense value field)
(() => {
  const el = document.getElementById('contribAmount');
  if (!el) return;
  el.addEventListener('blur', () => {
    const n = parseBRLInput(el.value);
    el.value = n > 0 ? fmtBRLInput(n) : '';
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { el.blur(); saveContrib(); } });
})();
document.getElementById('contribModal')?.addEventListener('click', e => { if (e.target.id === 'contribModal') closeContribModal(); });
document.getElementById('contribListClose')?.addEventListener('click', closeContribListModal);
document.getElementById('contribListAdd')?.addEventListener('click', () => { closeContribListModal(); openContribModal(); });
document.getElementById('contribListModal')?.addEventListener('click', e => { if (e.target.id === 'contribListModal') closeContribListModal(); });
$('btnCfgI10')?.addEventListener('click', openI10ConfigModal);
$('i10CfgCancel')?.addEventListener('click', closeI10ConfigModal);
$('i10CfgSave')?.addEventListener('click', saveI10Config);
$('i10CfgModal')?.addEventListener('click', e => { if (e.target.id === 'i10CfgModal') closeI10ConfigModal(); });

// Yearly modal
$('btnAddYear').addEventListener('click', () => openYearlyModal());
$('yearlyCancel').addEventListener('click', closeYearlyModal);
$('yearlySave').addEventListener('click', saveYearly);
$('yearlyDelete').addEventListener('click', deleteYearly);
$('yearlyModal').addEventListener('click', e => { if (e.target.id === 'yearlyModal') closeYearlyModal(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeExpenseModal();
    closeI10Modal();
    closeYearlyModal();
    closeI10ConfigModal();
  }
});

// ============================================================
//                 FIRESTORE SUBSCRIPTIONS
// ============================================================
let unsub = {};
function subscribeAll() {
  unsub.expenses = onSnapshot(colExpenses(), (snap) => {
    state.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const firstLoad = !state._expensesLoaded;
    state._expensesLoaded = true;   // o dedup do auto-sync DEPENDE disso (ver autoSyncProventos)
    if (state.mode === 'expenses') renderExpenses();
    // Se um sync rodou ANTES do snapshot chegar, o auto-sync foi adiado; re-tenta
    // agora que as despesas existem (idempotente — não duplica).
    if (firstLoad) autoSyncProventos().catch(() => {});
  });
  unsub.yearly = onSnapshot(colYearly(), (snap) => {
    state.yearly = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.__ledgerYearly = state.yearly;
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.recurring = onSnapshot(colRecurring(), (snap) => {
    state.recurring = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.mode === 'expenses') renderExpenses();
  });
  unsub.config = onSnapshot(docConfig, (snap) => {
    const data = snap.data() || {};
    if (typeof data.dividendsYearlyGoal === 'number') state.dividendsYearlyGoal = data.dividendsYearlyGoal;
    if (typeof data.dividendsYearlyGoalYear === 'number') state.dividendsYearlyGoalYear = data.dividendsYearlyGoalYear;
    // Tema POR USUÁRIO (cada um — W e F — tem o seu; não compartilha mais). Cross-device
    // do MESMO usuário via themeByUser[uid]. Sem entrada = mantém a escolha local (não força).
    const _uid = state.user && state.user.uid;
    const _ut = (_uid && data.themeByUser && data.themeByUser[_uid]) || null;
    if (_ut === 'light' || _ut === 'dark') {
      const current = document.documentElement.getAttribute('data-theme');
      if (current !== _ut) {
        document.documentElement.setAttribute('data-theme', _ut);
        try { localStorage.setItem('ledger-theme', _ut); } catch(e) {}
      }
    }
    // Sync lang from Firestore
    if ((data.lang === 'pt' || data.lang === 'en') && data.lang !== getLang()) {
      try { localStorage.setItem('ledger-lang', data.lang); } catch(e) {}
      applyI18n();
    }
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.fx = onSnapshot(docFx, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      let upd = null;
      if (d.rateUpdatedAt) {
        upd = typeof d.rateUpdatedAt.toDate === 'function' ? d.rateUpdatedAt.toDate() : d.rateUpdatedAt;
      }
      state.fx = {
        usd: +d.usd || 0,
        rateUSD: +d.rateUSD || 0,
        rateUpdatedAt: upd,
        rateSource: d.rateSource || '',
        note: d.note || '',
      };
      updateLedgerEquity();
      // The USD row + hero are fully rebuilt by renderInvestments →
      // renderI10Assets. (Old renderFX() was dead+broken — it targeted
      // ids that don't exist and threw, blocking this re-render.)
      if (state.mode === 'investments') renderInvestments();
    }
  });
  unsub.i10Louise = onSnapshot(docI10Louise, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      let updatedAt = null;
      if (d.updatedAt) {
        updatedAt = typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate() : d.updatedAt;
      }
      state.i10Louise = {
        equity: +d.equity || 0,
        dividends: +d.dividends || 0,
        applied: +d.applied || 0,
        variation: +d.variation || 0,
        updatedAt,
      };
      renderLouise();
    }
  });
  unsub.i10 = onSnapshot(docI10, (snap) => {
    const data = snap.data() || {};
    state.i10.equity = +data.equity || 0;
    updateLedgerEquity();
    state.i10.dividends = +data.dividends || 0;
    state.i10.updatedAt = data.updatedAt?.toDate?.() || null;
    state.i10.year = data.year || new Date().getFullYear();
    state.i10.assets = Array.isArray(data.assets) ? data.assets : [];
    state.i10.categories = Array.isArray(data.categories) ? data.categories : [];
    state.i10.monthly = Array.isArray(data.monthly) ? data.monthly : [];
    state.i10.applied = +data.applied || 0;
    state.i10.variation = +data.variation || 0;
    state.i10.profitTwr = +data.profitTwr || 0;
    state.i10.source = data.source || null;
    // Restore ticker->category map persisted by syncFromI10
    if (data.tickerCategories && typeof data.tickerCategories === 'object') {
      _i10TickerCategory = data.tickerCategories;
    }
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.shareGoals = onSnapshot(docShareGoals, (snap) => {
    const d = snap.data();
    if (d && Array.isArray(d.goals)) {
      state.shareGoals = d.goals;
    } else if (!snap.exists()) {
      // Primeira carga: semeia as metas que o W já tinha em mente (20 mil de cada).
      state.shareGoals = DEFAULT_SHARE_GOALS.map(g => ({ ...g }));
      saveShareGoals();
    }
    if (state.mode === 'investments' && typeof renderMetas === 'function') renderMetas();
  });
  unsub.contributions = onSnapshot(colContrib(), (snap) => {
    state.contributions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.mode === 'investments') renderContributions();
  });
  unsub.i10Cfg = onSnapshot(docI10Cfg, (snap) => {
    const data = snap.data() || {};
    state.i10Cfg.workerUrl = data.workerUrl || '';
    state.i10Cfg.walletId = data.walletId || '';
    state.i10Cfg.publicHash = data.publicHash || '';
    updateI10Link();
  });
  unsub.reserves = onSnapshot(docReserves, async (snap) => {
    if (!snap.exists()) {
      // First-run: seed with the 3 default empty accounts
      state.reserves.accounts = RESERVES_DEFAULTS.map(a => ({ ...a }));
      state.reserves.loaded = true;
      try {
        await setDoc(docReserves, {
          accounts: state.reserves.accounts,
          updatedAt: serverTimestamp(),
          updatedBy: state.user?.displayName || 'unknown',
          seeded: true,
        });
      } catch (err) { console.warn('reserves seed failed:', err); }
    } else {
      const data = snap.data() || {};
      state.reserves.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.reserves.loaded = true;
    }
    updateLedgerEquity();
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.pension = onSnapshot(docPension, async (snap) => {
    if (!snap.exists()) {
      // First-run: seed with default(s) — Bradesco
      state.pension.accounts = PENSION_DEFAULTS.map(a => ({ ...a }));
      state.pension.loaded = true;
      try {
        await setDoc(docPension, {
          accounts: state.pension.accounts,
          updatedAt: serverTimestamp(),
          updatedBy: state.user?.displayName || 'unknown',
          seeded: true,
        });
      } catch (err) { console.warn('pension seed failed:', err); }
    } else {
      const data = snap.data() || {};
      state.pension.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.pension.loaded = true;
    }
    updateLedgerEquity();
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.userPrefs = onSnapshot(docUserPrefs, (snap) => {
    state.userPrefs = snap.exists() ? (snap.data() || {}) : {};
  });
  unsub.importRules = onSnapshot(docImportRules, (snap) => {
    state.importRules = (snap.exists() && snap.data() && snap.data().rules) || {};
  });
  unsub.importMeta = onSnapshot(docImportMeta, (snap) => {
    state.importMeta = snap.exists() ? (snap.data() || {}) : {};
    updateImportsBtn();
    if ($('importsModal')?.classList.contains('show')) renderImportsList();
  });
  unsub.categories = onSnapshot(docCategories, (snap) => {
    state.catConfig = snap.exists() ? (snap.data() || {}) : {};
    applyCategoryConfig(state.catConfig);
    populateCategorySelect();
    populateExpFilterCat();
    if (state.mode === 'expenses') renderExpenses();
    else if (state.mode === 'resumo' && typeof renderResumo === 'function') renderResumo();
  });
  unsub.budgets = onSnapshot(docBudgets, (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    // Accept both shapes: { categories: {...} } or a flat map with numeric values
    if (data.categories && typeof data.categories === 'object') {
      state.budgets = { ...data.categories };
    } else {
      const flat = {};
      Object.entries(data).forEach(([k, v]) => { if (typeof v === 'number' && k in CATEGORIES) flat[k] = v; });
      state.budgets = flat;
    }
    if (state.mode === 'expenses') renderExpenses();
  });
}
function unsubscribeAll() { Object.values(unsub).forEach(fn => fn && fn()); unsub = {}; }

// ============================================================
//                 AUTH
// ============================================================
$('btnLogin').addEventListener('click', async () => {
  console.log('[auth] Login button clicked');
  $('loginError').classList.remove('show');
  $('btnLoginText').textContent = getLang() === 'en' ? 'Signing in...' : 'Entrando...';
  try {
    console.log('[auth] Calling signInWithPopup...');
    await signInWithPopup(auth, provider);
    console.log('[auth] signInWithPopup resolved');
  } catch (err) {
    console.error('[auth] signInWithPopup error:', err);
    const code = err.code || 'unknown';
    // Humane copy per known code; raw code stays in console only.
    const MAP = {
      'auth/popup-blocked': 'O popup foi bloqueado. Libere popups pra este site e tente de novo.',
      'auth/popup-closed-by-user': 'Login cancelado. Tente de novo quando quiser.',
      'auth/cancelled-popup-request': 'Login cancelado. Tente de novo.',
      'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
      'auth/unauthorized-domain': 'Este domínio não está autorizado pro login. Avise o William.',
    };
    $('loginError').textContent = MAP[code] || 'Não deu pra entrar agora — tente de novo em instantes.';
    $('loginError').classList.add('show');
    $('btnLoginText').textContent = t('login.button');
  }
});
$('btnLogout').addEventListener('click', async () => { unsubscribeAll(); await signOut(auth); });

// ============================================================
//  THEME TOGGLE (light/dark)
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('ledger-theme', theme); } catch(e) {}
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Persiste POR USUÁRIO (cross-device do mesmo usuário; não afeta o tema do outro).
  if (state.user && state.user.uid) {
    setDoc(docConfig, { themeByUser: { [state.user.uid]: next }, updatedAt: serverTimestamp() }, { merge: true }).catch(e => console.warn('theme save failed', e));
  }
}
document.getElementById('btnThemeToggle')?.addEventListener('click', toggleTheme);

// ============================================================
//  i18n (PT/EN)
// ============================================================

document.getElementById('btnLangToggle')?.addEventListener('click', toggleLang);

onAuthStateChanged(auth, async (user) => {
  _mainAuthRegistered = true;
  window.__bootLog && window.__bootLog('auth state: ' + (user ? 'LOGGED IN as ' + user.email : 'logged out'));
  if (user) {
    state.user = user;
    $('loginScreen').classList.add('hide');
    $('app').classList.add('show');
    $('userName').textContent = user.displayName || user.email;
    if (user.photoURL) $('userPhoto').src = user.photoURL;
    try {
      await setDoc(doc(db, 'household', 'main', 'meta', 'connection'), {
        lastSeenBy: user.displayName || user.email,
        lastSeenAt: serverTimestamp(),
        uid: user.uid,
      }, { merge: true });
      subscribeAll();
      // Initial mode honors the user's last choice (config/userPrefs.{uid}),
      // falls back to 'investments' for the known primary email and
      // 'expenses' for everyone else (spouse/secondary user).
      const initialMode = await pickInitialMode(user);
      switchMode(initialMode, { persist: false });
      // Auto-sync on login: give Firestore listeners ~3s to populate
      // state.i10.updatedAt + state.i10Cfg, then check if a sync is due.
      setTimeout(() => maybeAutoSync('login'), 3000);
      setTimeout(() => maybeShowUpdatePopup(), 1400);   // novidades 1× por versão
    } catch (err) {
      console.error('Firestore error:', err);
    }
  } else {
    state.user = null;
    unsubscribeAll();
    $('loginScreen').classList.remove('hide');
    $('app').classList.remove('show');
    $('btnLoginText').textContent = t('login.button');
  }
});

// Apply i18n on initial load (after onAuthStateChanged is registered)
applyI18n();

// ============================================================
//  MICRO-INTERACTIONS — proximity / "alive" polish (desktop only)
//  Inspired by the dock-proximity pattern: respond to cursor distance,
//  not just binary hover. Two effects, both gated on a fine pointer +
//  no reduced-motion preference:
//    1. Magnetic CTAs — key action buttons drift toward the cursor.
//    2. Hero spotlight — the radial glow tracks the pointer.
//  Nothing scales or shifts content that holds numbers (readability).
// ============================================================
function initMicroFX() {
  // Owner preference (jun/2026): keep the UI STATIC. The magnetic CTAs
  // made "+ Ganho" / "+ Nova despesa" drift into each other on hover, and
  // the cursor-tracking hero glow felt restless ("esse mundo que fica se
  // mexendo não é legal"). Disabled — nothing follows the pointer now.
  return;
  // eslint-disable-next-line no-unreachable
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return;

  // ---- 1. Magnetic buttons ----
  const MAG_IDS = ['btnSyncI10', 'btnAddExpense', 'btnAddIncome', 'btnAddContrib', 'btnAddYear', 'btnImportHistory'];
  const magnets = MAG_IDS.map(id => document.getElementById(id)).filter(Boolean);
  magnets.forEach(el => el.classList.add('magnetic'));
  const R = 95;          // activation radius (px)
  const PULL_X = 0.28;   // horizontal pull factor
  const PULL_Y = 0.40;   // vertical pull factor (a touch stronger)

  let pending = false;
  let lastX = 0, lastY = 0;
  function applyMagnets() {
    pending = false;
    for (const el of magnets) {
      if (!el.offsetParent) { el.style.transform = ''; continue; } // hidden
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = lastX - cx, dy = lastY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < R) {
        el.style.transform = `translate(${(dx * PULL_X).toFixed(1)}px, ${(dy * PULL_Y).toFixed(1)}px)`;
      } else if (el.style.transform) {
        el.style.transform = '';
      }
    }
  }
  window.addEventListener('pointermove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (!pending) { pending = true; requestAnimationFrame(applyMagnets); }
  }, { passive: true });

  // ---- 2. Hero spotlight ----
  document.querySelectorAll('.hero-card, .exp-hero').forEach(hero => {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      hero.style.setProperty('--spot-x', x.toFixed(1) + '%');
      hero.style.setProperty('--spot-y', y.toFixed(1) + '%');
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      hero.style.removeProperty('--spot-x');
      hero.style.removeProperty('--spot-y');
    }, { passive: true });
  });
}
initMicroFX();

// Re-render bar charts on resize (debounced) so mobile/desktop viewBox swap kicks in on rotate.
let _resizeTimer = null;
let _wasMobile = typeof window !== 'undefined' && window.innerWidth < 600;
window.addEventListener('resize', () => {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const isMobileNow = window.innerWidth < 600;
    if (isMobileNow !== _wasMobile) {
      _wasMobile = isMobileNow;
      if (state.user && state.mode === 'investments') {
        if (typeof renderDividendsChart === 'function') renderDividendsChart();
        if (typeof renderPLChart === 'function') renderPLChart();
      }
    }
  }, 200);
});


// ============================================================
//   METAS — barras minimalistas de progresso (dividendos + ações)
//   Substitui o simulador. A quantidade atual das ações vem do I10.
//   (escopo de MÓDULO — precisa ser visível a renderInvestments/subscribeAll)
// ============================================================
const DEFAULT_SHARE_GOALS = [
  { id: 'bbas3', ticker: 'BBAS3', target: 20000, startYear: 2024, year: 2030 },
  { id: 'bbse3', ticker: 'BBSE3', target: 20000, startYear: 2024, year: 2030 },
  { id: 'cxse3', ticker: 'CXSE3', target: 20000, startYear: 2024, year: 2030 },
  { id: 'rani3', ticker: 'RANI3', target: 20000, startYear: 2024, year: 2030 },
];
const META_DIV_START = 2024;   // ano-base do ritmo da meta de dividendos

function i10Qty(ticker) {
  const tk = String(ticker || '').toUpperCase().trim();
  const a = (state.i10.assets || []).find(x => String(x.ticker || '').toUpperCase().trim() === tk);
  return a ? (+a.quantity || 0) : 0;
}
function metaClassify(fill, mark) { const d = fill - mark; return d >= 5 ? 'ahead' : d <= -5 ? 'behind' : 'ontrack'; }
function saveShareGoals() {
  setDoc(docShareGoals, { goals: state.shareGoals, updatedAt: serverTimestamp() }, { merge: true })
    .catch(e => console.warn('[metas] save', e));
}
function _metaFmtN(n) { return Math.round(+n || 0).toLocaleString('pt-BR'); }
function _metaCompact(n) {
  n = +n || 0;
  if (n >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M';
  if (n >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'K';
  return 'R$ ' + _metaFmtN(n);
}
function _metaRow(o) {
  // Metas v2 (escolha do dono): linha única no padrão Carteira (opção A) + barra
  // grossa com o % feito DENTRO do preenchimento (opção C) + pill à direita.
  const f = Math.max(2, Math.min(100, o.fill || 0));
  const pct = Math.round(Math.max(0, Math.min(100, o.fill || 0)));
  const pencil = `<button class="mt-edit-btn" data-edit="${o.id}" aria-label="${esc(t('metas.edit'))}" title="${esc(t('metas.edit'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>`;
  const marker = (o.mark != null) ? `<div class="mt-mark" style="left:${Math.max(0, Math.min(100, o.mark))}%"></div>` : '';
  return `<div class="mt-goal" data-id="${o.id}" data-type="${o.type}">`
    + `<span class="mt-tile">${esc(o.tile || '')}</span>`
    + `<div class="mt-info"><span class="mt-name">${o.name}</span><small class="mt-sub">${o.sub || ''}</small></div>`
    + `<div class="mt-bar"><div class="mt-fill ${o.st}" style="width:${f}%"><span class="mt-pct">${pct}%</span></div>${marker}</div>`
    + `<span class="mt-pill ${o.pillCls || 'mid'}">${o.pillTxt || ''}</span>`
    + pencil
    + `</div>`;
}
function renderMetas() {
  const wrap = $('metasList'); if (!wrap) return;
  const nowY = new Date().getFullYear();
  // 1) Dividendos — alvo editável, prazo travado.
  const divCur = +state.i10.dividends || 0;
  const divTgt = +state.dividendsYearlyGoal || 1000000;
  const divYear = +state.dividendsYearlyGoalYear || 2035;
  const divFill = divTgt > 0 ? divCur / divTgt * 100 : 0;
  const divMark = (nowY - META_DIV_START) / Math.max(1, (divYear - META_DIV_START)) * 100;
  const divSt = metaClassify(divFill, divMark);
  let html = _metaRow({
    id: 'div', type: 'dividends', name: esc(t('metas.dividends')), tile: 'DIV',
    sub: `${_metaCompact(divCur)} / ${_metaCompact(divTgt)} · ${esc(t('metas.perYear'))} · ${divYear}`,
    fill: divFill, mark: divMark, st: divSt,
    pillTxt: esc(t('metas.pace.' + divSt)), pillCls: divSt === 'behind' ? 'warn' : 'near',
  });
  // 2) Ações — SEM prazo: só barra de progresso + quanto falta (%). Quantidade vem do I10.
  for (const g of (state.shareGoals || [])) {
    const cur = i10Qty(g.ticker), tgt = +g.target || 0;
    const fill = tgt > 0 ? cur / tgt * 100 : 0;
    const left = tgt > 0 ? Math.max(0, 100 - Math.round(fill)) : 100;
    const done = tgt > 0 && cur >= tgt;
    html += _metaRow({
      id: g.id, type: 'shares', name: esc(g.ticker), tile: String(g.ticker || '').slice(0, 4).toUpperCase(),
      sub: `${_metaFmtN(cur)} / ${_metaFmtN(tgt)}`,
      fill, mark: null, st: 'progress',
      pillTxt: done ? t('metas.done') : t('metas.left').replace('{p}', left),
      pillCls: (done || fill >= 80) ? 'near' : 'mid',
    });
  }
  wrap.innerHTML = html + `<span class="mt-add" id="mtAdd">+ ${esc(t('metas.add'))}</span>`;
}
// Edição via modal (popup) — botão de lápis em cada meta abre a tela.
let _metaEditingId = null;
function openMetaModal(id) {
  _metaEditingId = id || null;
  const isDiv = id === 'div';
  const isNew = !id;
  const tickerField = $('metaTickerField'), yearField = $('metaYearField'), delBtn = $('metaDeleteBtn');
  $('metaModalTitle').textContent = isNew ? t('metas.modal.new') : (isDiv ? t('metas.modal.editDiv') : t('metas.modal.edit'));
  $('metaModalSub').textContent = isDiv ? t('metas.modal.subDiv') : t('metas.modal.subShare');
  if (isDiv) {
    tickerField.style.display = 'none';
    yearField.style.display = 'none';
    $('metaTargetLabel').textContent = t('metas.field.targetDiv');
    $('metaTargetInput').value = String(state.dividendsYearlyGoal || 1000000);
    delBtn.style.display = 'none';
  } else {
    tickerField.style.display = '';
    yearField.style.display = 'none';   // ações não têm prazo — só progresso
    $('metaTargetLabel').textContent = t('metas.field.targetShares');
    const g = isNew ? null : (state.shareGoals || []).find(x => x.id === id);
    $('metaTickerInput').value = g ? g.ticker : '';
    $('metaTargetInput').value = g ? String(g.target) : '';
    delBtn.style.display = isNew ? 'none' : '';
  }
  $('metaModal').classList.add('show');
  setTimeout(() => { (isDiv ? $('metaTargetInput') : $('metaTickerInput')).focus(); }, 60);
}
function closeMetaModal() { $('metaModal').classList.remove('show'); _metaEditingId = null; }
function saveMetaModal() {
  const id = _metaEditingId;
  const parseN = (s) => { const n = parseInt(String(s || '').replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; };
  if (id === 'div') {
    const n = parseN($('metaTargetInput').value);
    if (n > 0) { state.dividendsYearlyGoal = n; setDoc(docConfig, { dividendsYearlyGoal: n, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {}); }
    renderMetas(); closeMetaModal(); return;
  }
  const ticker = ($('metaTickerInput').value || '').toUpperCase().trim();
  const target = parseN($('metaTargetInput').value);
  if (!ticker || target <= 0) { showToast(t('metas.invalid')); return; }
  if (!id) {
    state.shareGoals = [...(state.shareGoals || []), { id: 'sg' + Date.now().toString(36), ticker, target }];
  } else {
    const g = (state.shareGoals || []).find(x => x.id === id);
    if (g) { g.ticker = ticker; g.target = target; }
  }
  saveShareGoals(); renderMetas(); closeMetaModal();
}
function deleteMetaFromModal() {
  const id = _metaEditingId;
  if (id && id !== 'div') { state.shareGoals = (state.shareGoals || []).filter(g => g.id !== id); saveShareGoals(); renderMetas(); }
  closeMetaModal();
}
document.getElementById('metasList')?.addEventListener('click', (e) => {
  if (e.target.closest('#mtAdd')) { openMetaModal(null); return; }
  const btn = e.target.closest('.mt-edit-btn');
  if (btn) openMetaModal(btn.dataset.edit);
});
$('metaModalCancel')?.addEventListener('click', closeMetaModal);
$('metaModalSave')?.addEventListener('click', saveMetaModal);
$('metaDeleteBtn')?.addEventListener('click', deleteMetaFromModal);
$('metaModal')?.addEventListener('click', (e) => { if (e.target.id === 'metaModal') closeMetaModal(); });
['metaTickerInput', 'metaTargetInput', 'metaYearInput'].forEach(idn => {
  $(idn)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveMetaModal(); } });
});

// ============================================================
//  GOAL SIMULATOR (scoped to avoid $/fmtBRL collision with main module)
// ============================================================
{

const TARGET = 1000000;
const TARGET_YEAR = 2035;
const START_YEAR = 2026;
const DEFAULTS = { aporte: 24000, crescAporte: 10, dy: 8, reinv: 100, crescDiv: 6 };

let saveDebounce = null;
let isLoadingFromFirestore = false;
let userLoaded = false;

const $ = id => document.getElementById(id);
const fmtBRL = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtBRLk = v => v >= 1e6 ? 'R$ ' + (v/1e6).toFixed(2).replace('.',',') + 'M' : 'R$ ' + Math.round(v/1000) + 'k';

function getHistory() {
  // Lê do window.__ledgerState que app.js expoe (yearly history)
  const yearly = window.__ledgerYearly || [];
  return yearly.filter(y => y.equity != null || y.divs != null).sort((a,b) => a.year - b.year)
    .map(y => ({ year: y.year, equity: +y.equity || 0, divs: +y.divs || 0 }));
}

function getCurrentPL() {
  return window.__ledgerEquity || 1795442;
}

function simulate(p) {
  const proj = [];
  let pl = getCurrentPL();
  let metaHitYear = null;
  for (let year = START_YEAR; year <= TARGET_YEAR + 10; year++) {
    const yrIndex = year - START_YEAR;
    const aporteAnual = p.aporte * 12 * Math.pow(1 + p.crescAporte/100, yrIndex);
    const dyAjustado = (p.dy/100) * Math.pow(1 + p.crescDiv/100, yrIndex);
    const divsRecebidos = pl * dyAjustado;
    const reinvestido = divsRecebidos * (p.reinv/100);
    proj.push({ year, pl, divs: divsRecebidos, aporte: aporteAnual });
    if (divsRecebidos >= TARGET && metaHitYear === null) metaHitYear = year;
    pl = pl + aporteAnual + reinvestido;
  }
  return { proj, metaHitYear };
}

function readSliders() {
  // v8 Turno 3: inputs now text-formatted ("R$ 24.000", "10,0%/yr"). Parse via shared helper.
  const parseV = (s) => {
    if (s == null) return 0;
    const c = String(s).replace(/R\$|\s|%|\/yr|\/ano|\./g, '').replace(',', '.');
    const n = parseFloat(c);
    return isFinite(n) ? n : 0;
  };
  return {
    aporte: parseV($('gsAporte').value),
    crescAporte: parseV($('gsCrescAporte').value),
    dy: parseV($('gsDY').value),
    reinv: parseV($('gsReinv').value),
    crescDiv: parseV($('gsCrescDiv').value),
  };
}

function applyParams(p) {
  isLoadingFromFirestore = true;
  // v8 Turno 3: write back as formatted strings to match the text inputs
  const fmtBRLi = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const fmtPctY = (n) => n.toFixed(1).replace('.', ',') + '%/yr';
  const fmtPctP = (n) => n.toFixed(1).replace('.', ',') + '%';
  const fmtPctI = (n) => Math.round(n) + '%';
  $('gsAporte').value = fmtBRLi(p.aporte);
  $('gsCrescAporte').value = fmtPctY(p.crescAporte);
  $('gsDY').value = fmtPctP(p.dy);
  $('gsReinv').value = fmtPctI(p.reinv);
  $('gsCrescDiv').value = fmtPctY(p.crescDiv);
  isLoadingFromFirestore = false;
  render();
}

function saveParams(p) {
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'household', 'main', 'config', 'goalParams'), p, { merge: true });
    } catch (err) { console.warn('saveParams failed:', err); }
  }, 600);
}

function render() {
  const p = readSliders();
  $('gvAporte').textContent = fmtBRL(p.aporte);
  $('gvCrescAporte').textContent = p.crescAporte.toFixed(1).replace('.',',') + (getLang() === 'en' ? '%/yr' : '%/ano');
  $('gvDY').textContent = p.dy.toFixed(1).replace('.',',') + '%';
  $('gvReinv').textContent = p.reinv + '%';
  $('gvCrescDiv').textContent = p.crescDiv.toFixed(1).replace('.',',') + (getLang() === 'en' ? '%/yr' : '%/ano');

  const { proj, metaHitYear } = simulate(p);

  let cls, txt;
  const tt = (typeof window !== 'undefined' && window.t) ? window.t : (k => k);
  if (metaHitYear === null || metaHitYear > TARGET_YEAR) { cls='red'; txt=tt('goal.status.red'); }
  else if (metaHitYear <= TARGET_YEAR-2) { cls='green'; txt=tt('goal.status.green'); }
  else { cls='yellow'; txt=tt('goal.status.yellow'); }
  $('gStatusPill').className = 'status-pill ' + cls;
  $('gStatusText').textContent = txt;

  $('gStatHit').textContent = metaHitYear || '> '+TARGET_YEAR;
  if (metaHitYear) {
    const d = TARGET_YEAR - metaHitYear;
    { const _en = getLang() === 'en'; const _yr = k => _en ? (k === 1 ? 'year' : 'years') : (k === 1 ? 'ano' : 'anos');
      $('gStatHitSub').textContent = d > 0 ? `${d} ${_yr(d)} ${_en ? 'early' : 'antes'}` : (d < 0 ? `${Math.abs(d)} ${_yr(Math.abs(d))} ${_en ? 'late' : 'depois'}` : (_en ? 'on schedule' : 'no prazo')); }
  } else $('gStatHitSub').textContent = t('goal.notreach');

  const pAt = proj.find(x => x.year === TARGET_YEAR);            // divs durante TARGET_YEAR
  const pAtEnd = proj.find(x => x.year === TARGET_YEAR + 1);      // PL no FIM de TARGET_YEAR
  $('gStatPL').textContent = fmtBRLk(pAtEnd?.pl || 0);
  if ($('gStatProj')) $('gStatProj').textContent = pAt?.divs ? fmtBRLk(pAt.divs) : '-';

  let totApor = 0;
  for (const px of proj) { if (px.year > TARGET_YEAR) break; totApor += px.aporte; }
  $('gStatApor').textContent = fmtBRLk(totApor);

  if (metaHitYear && metaHitYear <= TARGET_YEAR) {
    const yrs = TARGET_YEAR - metaHitYear;
    let phrase;
    if (yrs > 0) {
      phrase = tt('goal.phrase.before').replace('{year}', metaHitYear).replace('{n}', yrs).replace('{label}', yrs===1 ? tt('years.singular') : tt('years.plural'));
    } else {
      phrase = tt('goal.phrase.exact').replace('{year}', TARGET_YEAR);
    }
    $('gNarrative').innerHTML = phrase + tt('goal.phrase.suffix').replace('{amt}', fmtBRL(p.aporte)).replace('{g}', p.crescAporte).replace('{year}', TARGET_YEAR).replace('{pl}', fmtBRLk(pAtEnd?.pl || 0));
  } else if (metaHitYear) {
    const yrs = metaHitYear - TARGET_YEAR;
    $('gNarrative').innerHTML = tt('goal.phrase.after').replace('{year}', metaHitYear).replace('{n}', yrs).replace('{label}', yrs===1 ? tt('years.singular') : tt('years.plural'));
  } else {
    $('gNarrative').innerHTML = tt('goal.phrase.fail');
  }

  drawChart(proj, metaHitYear);
  if (!isLoadingFromFirestore && userLoaded) saveParams(p);
}

function drawChart(proj, metaHitYear) {
  const W=700, H=300, padL=50, padR=30, padT=30, padB=36;
  const innerW=W-padL-padR, innerH=H-padT-padB;
  const history = getHistory();
  const realDivs = history.length ? history : [{year:2020,divs:0},{year:2025,divs:67557}];
  const projDivs = proj.filter(p => p.year <= TARGET_YEAR).map(p => ({year:p.year, divs:p.divs}));
  const minYear=2020, maxYear=TARGET_YEAR;
  const maxDivs = Math.max(TARGET*1.1, ...realDivs.map(d=>d.divs), ...projDivs.map(d=>d.divs));
  const xS = y => padL + ((y-minYear)/(maxYear-minYear))*innerW;
  const yS = v => padT + innerH - (v/maxDivs)*innerH;

  // v8 Turno 4: hatched area + classed paths so @keyframes from Turno 2 engage automatically.
  // Classes the stylesheet hooks: .chart-svg .hatch-layer .history-line .projection-line .current-point .target-point .target-line
  let svg = '<g class="chart-svg">';
  svg += '<defs>';
  svg += '<pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">';
  svg += '<line x1="0" y1="0" x2="0" y2="8" stroke="#c7f73e" stroke-width="1.2" stroke-opacity=".38"/>';
  svg += '</pattern>';
  svg += '<linearGradient id="histLine" x1="0" y1="0" x2="1" y2="0">';
  svg += '<stop offset="0" stop-color="#a6d22e"/><stop offset="1" stop-color="#d8fa72"/>';
  svg += '</linearGradient>';
  svg += '</defs>';

  // Grid Y + labels
  for (const t of [0, 250000, 500000, 750000, 1000000]) {
    const y = yS(t);
    svg += '<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>';
    const lbl = t===0 ? '0' : (t>=1000000 ? '1M' : (t/1000)+'K');
    svg += '<text x="'+(padL-8)+'" y="'+(y+3)+'" text-anchor="end" fill="#5d5f56" font-family="Geist Mono, monospace" font-size="9">'+lbl+'</text>';
  }
  // X labels
  for (const t of [2020,2025,2030,2035]) {
    svg += '<text x="'+xS(t)+'" y="'+(H-padB+18)+'" text-anchor="middle" fill="#5d5f56" font-family="Geist Mono, monospace" font-size="10">'+t+'</text>';
  }

  // Target horizontal line (1M) — animated via .target-line
  const yT = yS(TARGET);
  svg += '<line class="target-line" x1="'+padL+'" y1="'+yT+'" x2="'+(W-padR)+'" y2="'+yT+'" stroke="#d8fa72" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
  svg += '<text x="'+(padL+6)+'" y="'+(yT-6)+'" text-anchor="start" fill="#d8fa72" font-weight="600" font-family="Geist Mono, monospace" font-size="9" letter-spacing="1" opacity=".7">TARGET 1M</text>';

  // Hatched area under the history line — anchored at y of last real point, floors at bottom
  const baseY = yS(0);
  const histPts = realDivs.map(d => xS(d.year)+','+yS(d.divs)).join(' L');
  if (realDivs.length >= 2) {
    const firstX = xS(realDivs[0].year);
    const lastX = xS(realDivs[realDivs.length-1].year);
    const areaD = 'M'+firstX+','+baseY+' L'+histPts+' L'+lastX+','+baseY+' Z';
    svg += '<path class="hatch-layer" d="'+areaD+'" fill="url(#hatch)" stroke="none"/>';
  }

  // History solid line — traced on load via tracePath() in app.js
  if (realDivs.length >= 2) {
    const lineD = 'M'+histPts;
    svg += '<path class="history-line" d="'+lineD+'" fill="none" stroke="url(#histLine)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  // Projection dashed line — shimmer animation via .projection-line
  const lastReal = realDivs[realDivs.length-1];
  const projPath = [lastReal, ...projDivs.filter(d => d.year > lastReal.year)];
  if (projPath.length >= 2) {
    const projD = 'M' + projPath.map(d => xS(d.year)+','+yS(d.divs)).join(' L');
    svg += '<path class="projection-line" d="'+projD+'" fill="none" stroke="#d8fa72" stroke-width="2" stroke-linecap="round" opacity=".85"/>';
  }

  // History point markers
  for (const d of realDivs.slice(0, -1)) {
    svg += '<circle cx="'+xS(d.year)+'" cy="'+yS(d.divs)+'" r="3" fill="#d8fa72" stroke="#131410" stroke-width="2"/>';
  }
  // Current point (last real) — pulses via .current-point
  svg += '<circle class="current-point" cx="'+xS(lastReal.year)+'" cy="'+yS(lastReal.divs)+'" r="3.5" fill="#d8fa72" stroke="#131410" stroke-width="2"/>';

  // Meta hit marker (green glow)
  if (metaHitYear && metaHitYear <= TARGET_YEAR) {
    const hit = proj.find(p => p.year === metaHitYear);
    if (hit) {
      const hx=xS(hit.year), hy=yS(hit.divs);
      svg += '<circle cx="'+hx+'" cy="'+hy+'" r="9" fill="#34e17a" opacity="0.2"/>';
      svg += '<circle cx="'+hx+'" cy="'+hy+'" r="5" fill="#34e17a" stroke="#131410" stroke-width="2"/>';
    }
  }
  // Target point at 2035 — pulses via .target-point + .target-ring radar ripple (Option C)
  const f = proj.find(p => p.year === TARGET_YEAR);
  if (f) {
    const tx = xS(f.year), ty = yS(f.divs);
    svg += '<circle class="target-ring" cx="'+tx+'" cy="'+ty+'"/>';
    svg += '<circle class="target-point" cx="'+tx+'" cy="'+ty+'" r="4" fill="#fff" stroke="#d8fa72" stroke-width="2"/>';
  }

  svg += '</g>';
  $('gChart').innerHTML = svg;

  // v8 Turno 4: one-shot stroke-dashoffset trace on first successful draw
  if (!window._chartTraced) {
    window._chartTraced = true;
    requestAnimationFrame(() => {
      const h = document.querySelector('#gChart .history-line');
      const p = document.querySelector('#gChart .projection-line');
      if (h && h.getTotalLength) {
        const L = h.getTotalLength();
        h.style.strokeDasharray = L;
        h.style.strokeDashoffset = L;
        h.getBoundingClientRect();
        h.style.transition = 'stroke-dashoffset 1400ms cubic-bezier(.2,.8,.2,1)';
        h.style.strokeDashoffset = 0;
      }
      if (p) {
        p.style.opacity = '0';
        setTimeout(() => {
          p.style.transition = 'opacity .8s ease';
          p.style.opacity = '.85';
        }, 1600);
      }
    });
  }
}

// Wire sliders — v8 Turno 3: text inputs fire on `change` (blur) not `input` to avoid reformatting mid-typing
['gsAporte','gsCrescAporte','gsDY','gsReinv','gsCrescDiv'].forEach(id => {
  const el = $(id);
  el.addEventListener('change', render);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
});
$('gBtnReset').addEventListener('click', () => { applyParams(DEFAULTS); });

// Auth + Firestore params load
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  userLoaded = true;
  onSnapshot(doc(db, 'household', 'main', 'config', 'goalParams'), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      applyParams({
        aporte: d.aporte ?? DEFAULTS.aporte,
        crescAporte: d.crescAporte ?? DEFAULTS.crescAporte,
        dy: d.dy ?? DEFAULTS.dy,
        reinv: d.reinv ?? DEFAULTS.reinv,
        crescDiv: d.crescDiv ?? DEFAULTS.crescDiv,
      });
    } else {
      render();
    }
  });
});

// Re-render only when app.js actually updates yearly/equity data (change-detection, no blind polling)
let _lastChartHash = '';
function _chartHash() {
  try {
    const ye = (state.yearly || []).map(y => `${y.year}:${y.equity}:${y.divs}`).join('|');
    const eq = state.i10 ? `${state.i10.equity}:${state.i10.dividends}` : '';
    return ye + '#' + eq;
  } catch (e) { return ''; }
}
setInterval(() => {
  if (!userLoaded) return;
  const h = _chartHash();
  if (h === _lastChartHash) return; // nothing changed → skip redraw → no flash
  _lastChartHash = h;
  const sim = simulate(readSliders());
  drawChart(sim.proj, sim.metaHitYear);
}, 1500);

// Initial render with defaults
render();

// v8 Turno 6 — range toggle listener for bar charts (syncs both cards + triggers re-render)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-range-toggle] button[data-range]');
  if (!btn) return;
  const range = btn.dataset.range;
  window.chartRange = range;
  // Sync active state across all range-toggle instances
  document.querySelectorAll('[data-range-toggle] button').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
  // Re-render the bar charts
  if (typeof renderDividendsChart === 'function') renderDividendsChart();
  if (typeof renderPLChart === 'function') renderPLChart();
});





}
