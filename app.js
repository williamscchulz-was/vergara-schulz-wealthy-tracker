// ============================================================
//  LEDGER — Personal Finance (app.js)
//  Modules: Expenses + Investments (I10 link)
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

// ---- Paths ----
const colExpenses = () => collection(db, "household", "main", "expenses");
const colYearly   = () => collection(db, "household", "main", "dividendsYearly");
const docExpense  = (id) => doc(db, "household", "main", "expenses", id);
const docYearly   = (id) => doc(db, "household", "main", "dividendsYearly", id);
const docConfig   = doc(db, "household", "main", "config", "settings");
const docI10      = doc(db, "household", "main", "config", "i10");
const docI10Cfg   = doc(db, "household", "main", "config", "i10sync");

// ---- Constants ----
const CATEGORIES = {
  moradia:     { label: 'Moradia',           icon: '🏠', color: '#0071e3' },
  alimentacao: { label: 'Alimentação',       icon: '🍽️', color: '#30d158' },
  transporte:  { label: 'Transporte',        icon: '🚗', color: '#ff9500' },
  saude:       { label: 'Saúde',             icon: '💊', color: '#ff375f' },
  lazer:       { label: 'Lazer',             icon: '🎮', color: '#af52de' },
  educacao:    { label: 'Educação',          icon: '📚', color: '#64d2ff' },
  assinaturas: { label: 'Assinaturas',       icon: '📱', color: '#bf5af2' },
  cartao:      { label: 'Cartão de crédito', icon: '💳', color: '#ff453a' },
  compras:     { label: 'Compras',           icon: '🛍️', color: '#ffd60a' },
  outros:      { label: 'Outros',            icon: '📦', color: '#8e8e93' },
};
const MONTH_NAMES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ---- State ----
const state = {
  user: null,
  mode: 'expenses',             // 'expenses' | 'investments'
  expenses: [],
  yearly: [],
  i10: { equity: 0, dividends: 0, updatedAt: null, year: new Date().getFullYear(), assets: [] },
  i10Cfg: { workerUrl: '', walletId: '', autoSync: false },
  i10Syncing: false,
  dividendsYearlyGoal: 1_000_000,
  dividendsYearlyGoalYear: 2035,
  currentViewMonth: new Date(),  // month being viewed in Expenses
};

// ---- Utils ----
const $ = (id) => document.getElementById(id);
const fmtBRL = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL0 = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtInt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
function shortMoney(n) {
  if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n/1_000).toFixed(0) + 'k';
  return n.toFixed(0);
}
// §7 Part 2: compact formatter for yearly history grid (pt-BR separators)
function formatCompact(n) {
  const abs = Math.abs(n || 0);
  if (abs >= 1_000_000) return (n/1_000_000).toFixed(2).replace('.', ',') + 'M';
  if (abs >= 1_000)     return (n/1_000).toFixed(1).replace('.', ',') + 'K';
  return String(Math.round(n || 0));
}
// §7 Part 2: sanitize YoY > 1000% (division-by-near-zero on first year)
function sanitizeYoY(pct) {
  if (pct == null || !isFinite(pct)) return null;
  if (Math.abs(pct) > 1000) return null;
  return pct;
}
// §6 Part 2: parse "R$ 24.000" / "10,0 %/yr" → float
function parseVarInput(str) {
  if (str == null) return 0;
  const cleaned = String(str).replace(/R\$|\s|%|\/yr|\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}
// Entry animations (Part 1 §-1): run once on DOMContentLoaded and after sync success
function countUp(el, target, duration = 1400, formatter = (n) => String(Math.round(n))) {
  if (!el) return;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = formatter(target * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function tracePath(path, duration = 1200, delay = 0) {
  if (!path || !path.getTotalLength) return;
  const len = path.getTotalLength();
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  path.style.transition = 'none';
  path.getBoundingClientRect(); // force reflow
  setTimeout(() => {
    path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(.2,.8,.2,1)`;
    path.style.strokeDashoffset = 0;
  }, delay);
}
function runEntryAnimations() {
  // Count-up the big net worth number on first load. Chart trace is handled by drawChart's
  // own one-shot (_chartTraced flag) in the inline script — we do NOT duplicate it here,
  // otherwise two trace cycles compete and produce the "line collapses and redraws" glitch.
  const nwEl = $('i10Equity');
  if (nwEl && state.i10.equity > 0) {
    countUp(nwEl, state.i10.equity, 1600, (n) => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  }
}
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function formatDateBR(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function formatDateTimeBR(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function monthKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTH_NAMES_PT[dt.getMonth()]} ${dt.getFullYear()}`;
}

// ============================================================
//                 MODE SWITCH (Expenses/Invest)
// ============================================================
function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  if (mode === 'expenses') {
    $('moduleExpenses').classList.add('active');
    renderExpenses();
  } else {
    $('moduleInvestments').classList.add('active');
    renderInvestments();
  }
}

// ============================================================
//                      EXPENSES MODULE
// ============================================================
function filterExpensesByMonth(date) {
  const targetKey = monthKey(date);
  return state.expenses.filter(e => {
    if (!e.date) return false;
    return monthKey(new Date(e.date)) === targetKey;
  });
}

function renderExpenses() {
  const viewDate = state.currentViewMonth;
  const monthExp = filterExpensesByMonth(viewDate);
  const prevDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  const prevMonthExp = filterExpensesByMonth(prevDate);

  const total = monthExp.reduce((s,e) => s + (+e.value||0), 0);
  const prevTotal = prevMonthExp.reduce((s,e) => s + (+e.value||0), 0);

  // Hero
  $('currentMonthLabel').textContent = monthLabel(viewDate);
  $('expHeroAmt').textContent = total.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if (monthExp.length === 0) {
    $('expHeroSub').textContent = 'Nenhuma despesa registrada ainda';
  } else {
    $('expHeroSub').textContent = `${monthExp.length} despesa${monthExp.length>1?'s':''} · média ${fmtBRL0(total/monthExp.length)}`;
  }

  // Stats
  $('expCount').textContent = monthExp.length;

  if (prevTotal > 0) {
    const diff = total - prevTotal;
    const pct = (diff / prevTotal) * 100;
    const cls = diff >= 0 ? 'dn' : 'up';
    const arrow = diff >= 0 ? '↑' : '↓';
    $('expVsPrev').innerHTML = `<span class="${diff>=0?'neg':'pos'}">${arrow} ${fmtPct(Math.abs(pct) * (diff>=0?1:-1))}</span>`;
    $('expVsPrevSub').innerHTML = `${diff>=0?'+':''}${fmtBRL0(diff)} vs ${MONTH_NAMES_PT[prevDate.getMonth()]}`;
  } else {
    $('expVsPrev').textContent = '—';
    $('expVsPrevSub').textContent = 'Sem dados do mês anterior';
  }

  // Biggest
  if (monthExp.length > 0) {
    const biggest = [...monthExp].sort((a,b) => (+b.value||0) - (+a.value||0))[0];
    $('expBiggest').textContent = fmtBRL0(+biggest.value||0);
    $('expBiggestSub').textContent = biggest.description || '—';
  } else {
    $('expBiggest').textContent = '—';
    $('expBiggestSub').textContent = '—';
  }

  renderCategoryBreakdown(monthExp, total);
  renderRecentList(monthExp);
  renderExpenseTable(monthExp);
}

function renderCategoryBreakdown(monthExp, total) {
  const wrap = $('catList');
  if (monthExp.length === 0) {
    wrap.innerHTML = `<div class="empty-table" style="padding:30px 10px"><h4>Sem despesas</h4><p>Adicione a primeira despesa do mês.</p></div>`;
    return;
  }
  // Group by category
  const byCat = {};
  monthExp.forEach(e => {
    const cat = e.category || 'outros';
    byCat[cat] = (byCat[cat] || 0) + (+e.value||0);
  });
  const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1]);
  wrap.innerHTML = sorted.map(([catKey, val]) => {
    const cat = CATEGORIES[catKey] || CATEGORIES.outros;
    const pct = total > 0 ? (val / total) * 100 : 0;
    return `<div class="cat-row">
      <div class="name"><span class="dot" style="background:${cat.color}"></span>${cat.icon} ${cat.label}</div>
      <div class="bar-wrap"><i style="width:${pct}%;background:${cat.color}"></i></div>
      <div class="v"><b>${pct.toFixed(0)}%</b>${fmtBRL0(val)}</div>
    </div>`;
  }).join('');
}

function renderRecentList(monthExp) {
  const wrap = $('recentList');
  if (monthExp.length === 0) {
    wrap.innerHTML = `<div class="empty-table" style="padding:30px 10px"><h4>Sem lançamentos</h4><p>Suas despesas recentes aparecerão aqui.</p></div>`;
    $('recentMeta').textContent = '—';
    return;
  }
  const sorted = [...monthExp]
    .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);
  $('recentMeta').textContent = `Últimas ${sorted.length} despesas`;
  wrap.innerHTML = sorted.map(e => {
    const cat = CATEGORIES[e.category] || CATEGORIES.outros;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--line);gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--ink-2);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cat.icon} ${e.description || '—'}</div>
        <div style="font-size:11px;color:var(--muted)">${formatDateBR(e.date)} · ${cat.label}</div>
      </div>
      <div style="font-family:'Geist Mono',monospace;font-size:13px;font-weight:600;color:var(--ink-2);white-space:nowrap">${fmtBRL(+e.value||0)}</div>
    </div>`;
  }).join('');
  // Remove last border
  const rows = wrap.querySelectorAll('div[style*="border-bottom"]');
  if (rows.length > 0) rows[rows.length-1].style.borderBottom = 'none';
}

function renderExpenseTable(monthExp) {
  const tbody = $('expBody');
  if (monthExp.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-table"><h4>Nenhuma despesa neste mês</h4><p>Clique em "Nova despesa" para começar.</p></div></td></tr>`;
    return;
  }
  const sorted = [...monthExp].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  tbody.innerHTML = sorted.map(e => {
    const cat = CATEGORIES[e.category] || CATEGORIES.outros;
    return `<tr data-id="${e.id}">
      <td class="mono">${formatDateBR(e.date)}</td>
      <td>${e.description || '—'}</td>
      <td><span class="cat-pill" style="background:${cat.color}22;color:${cat.color}"><span class="dot" style="background:${cat.color}"></span>${cat.icon} ${cat.label}</span></td>
      <td class="mono" style="font-weight:600">${fmtBRL(+e.value||0)}</td>
      <td></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openExpenseModal(tr.dataset.id)));
}

// ============================================================
//                 EXPENSES — MODAL
// ============================================================
let editingExpenseId = null;
function openExpenseModal(id = null) {
  editingExpenseId = id;
  if (id) {
    const e = state.expenses.find(x => x.id === id); if (!e) return;
    $('expenseModalTitle').textContent = 'Editar despesa';
    $('expDesc').value = e.description || '';
    $('expValue').value = e.value || '';
    $('expDate').value = e.date || '';
    $('expCategory').value = e.category || 'outros';
    $('expNotes').value = e.notes || '';
    $('expDelete').style.display = '';
  } else {
    $('expenseModalTitle').textContent = 'Nova despesa';
    $('expDesc').value = '';
    $('expValue').value = '';
    // Default date = today
    const today = new Date();
    $('expDate').value = today.toISOString().split('T')[0];
    $('expCategory').value = 'outros';
    $('expNotes').value = '';
    $('expDelete').style.display = 'none';
  }
  $('expenseModal').classList.add('show');
  setTimeout(() => $('expDesc').focus(), 50);
}
function closeExpenseModal() { $('expenseModal').classList.remove('show'); editingExpenseId = null; }

async function saveExpense() {
  const description = $('expDesc').value.trim();
  const value = parseFloat($('expValue').value);
  const date = $('expDate').value;
  const category = $('expCategory').value;
  const notes = $('expNotes').value.trim();

  if (!description) { showToast('Descrição obrigatória'); return; }
  if (!value || value <= 0) { showToast('Valor deve ser maior que zero'); return; }
  if (!date) { showToast('Data obrigatória'); return; }

  const data = {
    description, value, date, category, notes,
    updatedAt: serverTimestamp(),
    updatedBy: state.user?.displayName || 'unknown',
  };
  const btn = $('expSave');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    if (editingExpenseId) {
      await setDoc(docExpense(editingExpenseId), data, { merge: true });
      showToast('✓ Despesa atualizada');
    } else {
      await addDoc(colExpenses(), { ...data, createdAt: serverTimestamp() });
      showToast('✓ Despesa registrada');
    }
    closeExpenseModal();
  } catch (err) { console.error(err); showToast('Erro ao salvar'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function deleteExpense() {
  if (!editingExpenseId) return;
  if (!confirm('Excluir esta despesa? Esta ação não pode ser desfeita.')) return;
  try {
    await deleteDoc(docExpense(editingExpenseId));
    showToast('✓ Despesa excluída');
    closeExpenseModal();
  } catch (err) { console.error(err); showToast('Erro ao excluir'); }
}

// ============================================================
//                   INVESTMENTS MODULE
// ============================================================
function renderInvestments() {
  const currentYear = new Date().getFullYear();
  const goalYear = state.dividendsYearlyGoalYear;
  const yearsLeft = Math.max(0, goalYear - currentYear);

  // One-shot entry animations: fire once when we first have real equity data
  if (!state._entryAnimsPlayed && (state.i10.equity || 0) > 0) {
    state._entryAnimsPlayed = true;
    // Defer one frame so the DOM paint is committed first
    requestAnimationFrame(() => setTimeout(runEntryAnimations, 50));
  }

  // Hero — Patrimônio
  $('i10Equity').textContent = (state.i10.equity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if (state.i10.updatedAt) {
    const sourceTag = state.i10.source === 'investidor10-sync' ? ' · via I10 sync' : ' · manual';
    $('i10Updated').textContent = 'Updated: ' + formatDateTimeBR(state.i10.updatedAt) + sourceTag;
  } else {
    $('i10Updated').textContent = 'Not yet updated';
  }
  // Amt subtitle: show variation if synced
  const subEl = $('i10EquitySub');
  if (subEl) {
    if (state.i10.source === 'investidor10-sync' && state.i10.applied > 0) {
      const variation = +state.i10.variation || 0;
      const sign = variation >= 0 ? '+' : '';
      const cls = variation >= 0 ? 'pos' : 'neg';
      subEl.innerHTML = `Invested ${fmtBRL0(state.i10.applied)} · <span class="${cls}">${sign}${variation.toFixed(2)}%</span>`;
    } else {
      subEl.textContent = 'Manual update · configure sync for automatic';
    }
  }

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
      $('plCagr').textContent = `${cagr.toFixed(1)}% /ano (CAGR)`;
      $('plSinceFirst').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
      $('plCagrPill').textContent = cagr.toFixed(1) + '% /ano';
    }
  } else {
    $('plTotalGrowth').textContent = '—';
    $('plCagr').textContent = '—';
    $('plSinceFirst').textContent = '—';
    $('plCagrPill').textContent = '—';
  }

  // All-time dividends
  const allTime = state.yearly.reduce((s,y) => s + (+y.divs||0), 0);
  $('divAllTime').textContent = fmtBRL0(allTime);

  // Pills
  $('divGoalPill').textContent = 'R$ 1M até ' + goalYear;
  $('divYearsLeft').textContent = yearsLeft + (yearsLeft === 1 ? ' ano' : ' anos');
  $('divProgress').textContent = progress.toFixed(1) + '%';

  renderDividendsChart();
  renderPLChart();
  renderYearlyTable();
  renderI10Assets();
}

function buildBarChart(years, values, opts = {}) {
  const W = 780, H = 280, padL = 50, padR = 20, padT = 30, padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  if (!years.length) {
    return `<div class="empty-chart"><div class="ico">📊</div><h4>Sem dados</h4><p>Adicione anos no histórico para ver o gráfico.</p></div>`;
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
    svg += `<text class="goal-label" x="${W - padR - 4}" y="${goalY - 6}" text-anchor="end">Meta: ${shortMoney(opts.goal)}</text>`;
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

function renderDividendsChart() {
  const wrap = $('divChartWrap');
  const currentYear = new Date().getFullYear();
  const goalYear = state.dividendsYearlyGoalYear;
  const startYear = 2021;
  const years = [];
  for (let y = startYear; y <= goalYear; y++) years.push(y);

  const values = years.map(y => {
    const yh = state.yearly.find(r => r.year === y);
    if (yh) return +yh.divs || 0;
    // For current year, use i10 value
    if (y === currentYear) return +state.i10.dividends || 0;
    return 0;
  });

  wrap.innerHTML = buildBarChart(years, values, {
    goal: state.dividendsYearlyGoal,
    color: '#0071e3',
  });
}

function renderPLChart() {
  const wrap = $('plChartWrap');
  const currentYear = new Date().getFullYear();
  const sortedYearly = [...state.yearly].filter(y => y.equity != null).sort((a,b) => a.year - b.year);

  if (sortedYearly.length === 0 && (!state.i10.equity || state.i10.equity <= 0)) {
    wrap.innerHTML = `<div class="empty-chart"><div class="ico">📈</div><h4>Sem histórico de PL</h4><p>Adicione entradas anuais para ver o gráfico de evolução.</p></div>`;
    return;
  }

  const years = sortedYearly.map(y => y.year);
  const values = sortedYearly.map(y => +y.equity || 0);

  // Append current year from i10 if not already present
  const hasCurrentYear = years.includes(currentYear);
  if (!hasCurrentYear && state.i10.equity > 0) {
    years.push(currentYear);
    values.push(state.i10.equity);
  } else if (hasCurrentYear && state.i10.equity > 0) {
    // Override current year with i10 value (more fresh)
    const idx = years.indexOf(currentYear);
    values[idx] = state.i10.equity;
  }

  wrap.innerHTML = buildBarChart(years, values, { color: '#0071e3' });
}

function renderYearlyTable() {
  const tbody = $('yearlyBody');
  const sorted = [...state.yearly].sort((a,b) => (a.year||0) - (b.year||0));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-table"><h4>No yearly data</h4><p>Click "+ Year" to add your first year.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map((y, i) => {
    const dy = (+y.equity > 0) ? ((+y.divs / +y.equity) * 100).toFixed(1) + '%' : '—';
    let yoy = '—';
    let yoyClass = '';
    if (i > 0) {
      const prev = +sorted[i-1].divs || 0;
      if (prev > 0) {
        const growth = (((+y.divs || 0) - prev) / prev) * 100;
        const clean = sanitizeYoY(growth);
        if (clean != null) {
          yoy = (clean >= 0 ? '+' : '') + clean.toFixed(1) + '%';
          yoyClass = clean >= 0 ? 'pos' : 'neg';
        }
      }
    }
    return `<tr data-id="${y.id}"><td>${y.year}</td><td>${formatCompact(+y.equity||0)}</td><td>${formatCompact(+y.divs||0)}</td><td>${dy}</td><td class="${yoyClass}">${yoy}</td></tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openYearlyModal(tr.dataset.id)));
}

// ============================================================
//                I10 AUTO-SYNC (via Cloudflare Worker)
// ============================================================
function renderI10Assets() {
  const wrap = $('i10AssetsList');
  if (!wrap) return;
  const assets = state.i10.assets || [];
  if (assets.length === 0) {
    wrap.innerHTML = `<div class="empty-table" style="padding:30px 10px"><h4>Nenhum ativo sincronizado</h4><p>Clique em "Sincronizar" pra importar sua carteira do Investidor 10.</p></div>`;
    return;
  }
  const totalEquity = assets.reduce((s, a) => s + (+a.equity || 0), 0) || 1;
  // Ordena do maior pro menor por patrimônio no ativo
  const sorted = [...assets].sort((a, b) => (+b.equity || 0) - (+a.equity || 0));
  wrap.innerHTML = sorted.map(a => {
    const pct = ((+a.equity || 0) / totalEquity) * 100;
    const appr = +a.appreciation || 0;
    const apprCls = appr >= 0 ? 'pos' : 'neg';
    const apprSign = appr >= 0 ? '+' : '';
    return `<div class="asset-row">
      <div class="asset-head">
        <div class="asset-ticker">
          <span class="tk">${a.ticker || '—'}</span>
          <span class="qty">${fmtInt(+a.quantity || 0)} cotas · PM ${fmtBRL(+a.avgPrice || 0)}</span>
        </div>
        <div class="asset-values">
          <div class="asset-equity">${fmtBRL0(+a.equity || 0)}</div>
          <div class="asset-appr ${apprCls}">${apprSign}${appr.toFixed(1)}%</div>
        </div>
      </div>
      <div class="asset-bar"><i style="width:${pct.toFixed(2)}%"></i></div>
      <div class="asset-foot">
        <span>${pct.toFixed(1)}% da carteira</span>
        <span>Atual ${fmtBRL(+a.currentPrice || 0)}</span>
      </div>
    </div>`;
  }).join('');
}

async function syncFromI10() {
  const { workerUrl, walletId } = state.i10Cfg;
  if (!workerUrl || !walletId) {
    showToast('Configure o Worker e Wallet ID primeiro');
    openI10ConfigModal();
    return;
  }
  if (state.i10Syncing) return;
  state.i10Syncing = true;
  const btn = $('btnSyncI10');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Sincronizando...'; }

  try {
    const year = new Date().getFullYear();
    const base = workerUrl.replace(/\/+$/, ''); // remove trailing slash
    const res = await fetch(`${base}/i10/all/${encodeURIComponent(walletId)}?year=${year}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();

    // Parse metrics (equity, applied, variation, profit_twr)
    const m = payload.metrics || {};
    const equity = parseFloat(m.equity) || 0;
    const applied = parseFloat(m.applied) || 0;
    const variation = parseFloat(m.variation) || 0;
    const profitTwr = parseFloat(m.profit_twr) || 0;

    // Parse earnings (sum of dividends YTD)
    const dividends = parseFloat(payload.earnings?.sum) || 0;

    // Parse actives (list of tickers)
    const rawAssets = Array.isArray(payload.actives?.data) ? payload.actives.data : [];
    const assets = rawAssets.map(a => ({
      ticker: a.ticker || a.ticker_name || '',
      quantity: +a.quantity || 0,
      avgPrice: +a.avg_price || 0,
      currentPrice: parseFloat(a.current_price) || 0,
      equity: +a.equity_total || parseFloat(a.equity_brl) || 0,
      appreciation: +a.appreciation || 0,
      percentWallet: +a.percent_wallet || 0,
      earnings: +a.earnings_received || 0,
      image: a.image || '',
      url: a.url || '',
    }));

    // Persist in Firestore — both users share via onSnapshot
    await setDoc(docI10, {
      equity,
      dividends,
      applied,
      variation,
      profitTwr,
      assets,
      year,
      updatedAt: serverTimestamp(),
      updatedBy: (state.user?.displayName || 'unknown') + ' (auto)',
      source: 'investidor10-sync',
    }, { merge: true });

    showToast(`✓ Synced · ${assets.length} assets`);
    // Count-up replays on sync so the new equity number animates in — but chart trace does NOT.
    // Replaying strokeDashoffset = len → 0 looks like a glitch (line vanishes then redraws). Keep the line steady.
    state._entryAnimsPlayed = false;
  } catch (err) {
    console.error('I10 sync error:', err);
    showToast('Sync failed: ' + (err.message || 'unknown error'));
  } finally {
    state.i10Syncing = false;
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

// ============================================================
//                I10 CONFIG MODAL (Worker URL + Wallet ID)
// ============================================================
function openI10ConfigModal() {
  $('i10CfgWorker').value = state.i10Cfg.workerUrl || '';
  $('i10CfgWallet').value = state.i10Cfg.walletId || '';
  $('i10CfgModal').classList.add('show');
  setTimeout(() => $('i10CfgWorker').focus(), 50);
}
function closeI10ConfigModal() { $('i10CfgModal').classList.remove('show'); }

async function saveI10Config() {
  const workerUrl = ($('i10CfgWorker').value || '').trim();
  const walletId = ($('i10CfgWallet').value || '').trim();
  if (!workerUrl || !/^https?:\/\//.test(workerUrl)) { showToast('Worker URL inválida'); return; }
  if (!walletId || !/^\d+$/.test(walletId)) { showToast('Wallet ID deve ser numérico'); return; }
  const btn = $('i10CfgSave');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    await setDoc(docI10Cfg, {
      workerUrl,
      walletId,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    }, { merge: true });
    showToast('✓ Configuração salva');
    closeI10ConfigModal();
    // Auto-sync right after saving, so user sees data immediately
    setTimeout(() => syncFromI10(), 300);
  } catch (err) { console.error(err); showToast('Erro ao salvar'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
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
  if (isNaN(equity) || equity < 0) { showToast('Patrimônio inválido'); return; }
  if (isNaN(dividends) || dividends < 0) { showToast('Dividendos inválidos'); return; }

  const btn = $('i10Save');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    await setDoc(docI10, {
      equity,
      dividends,
      year: new Date().getFullYear(),
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
      source: 'manual',
    }, { merge: true });
    showToast('✓ Valores atualizados');
    closeI10Modal();
  } catch (err) { console.error(err); showToast('Erro ao salvar'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

// ============================================================
//                 YEARLY MODAL
// ============================================================
let editingYearlyId = null;
function openYearlyModal(id = null) {
  editingYearlyId = id;
  if (id) {
    const y = state.yearly.find(x => x.id === id); if (!y) return;
    $('yearlyModalTitle').textContent = 'Editar ano';
    $('yearlyYear').value = y.year || '';
    $('yearlyEquity').value = y.equity || '';
    $('yearlyDivs').value = y.divs || '';
    $('yearlyDelete').style.display = '';
  } else {
    $('yearlyModalTitle').textContent = 'Adicionar ano';
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
  if (!year) { showToast('Ano obrigatório'); return; }
  if (isNaN(equity)) { showToast('Patrimônio obrigatório'); return; }
  if (isNaN(divs)) { showToast('Proventos obrigatórios'); return; }
  const data = { year, equity, divs, updatedAt: serverTimestamp() };
  const btn = $('yearlySave');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    if (editingYearlyId) {
      await setDoc(docYearly(editingYearlyId), data, { merge: true });
      showToast('✓ Ano atualizado');
    } else {
      await addDoc(colYearly(), { ...data, createdAt: serverTimestamp() });
      showToast('✓ Ano adicionado');
    }
    closeYearlyModal();
  } catch (err) { console.error(err); showToast('Erro ao salvar'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function deleteYearly() {
  if (!editingYearlyId) return;
  if (!confirm('Excluir este ano? Esta ação não pode ser desfeita.')) return;
  try {
    await deleteDoc(docYearly(editingYearlyId));
    showToast('✓ Ano excluído');
    closeYearlyModal();
  } catch (err) { console.error(err); showToast('Erro ao excluir'); }
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

// Expense modal
$('btnAddExpense').addEventListener('click', () => openExpenseModal());
$('expCancel').addEventListener('click', closeExpenseModal);
$('expSave').addEventListener('click', saveExpense);
$('expDelete').addEventListener('click', deleteExpense);
$('expenseModal').addEventListener('click', e => { if (e.target.id === 'expenseModal') closeExpenseModal(); });

// I10 modal
$('btnEditI10').addEventListener('click', openI10Modal);
$('i10Cancel').addEventListener('click', closeI10Modal);
$('i10Save').addEventListener('click', saveI10);
$('i10Modal').addEventListener('click', e => { if (e.target.id === 'i10Modal') closeI10Modal(); });

// I10 Sync button + Config modal
$('btnSyncI10')?.addEventListener('click', syncFromI10);
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
    if (state.mode === 'expenses') renderExpenses();
  });
  unsub.yearly = onSnapshot(colYearly(), (snap) => {
    state.yearly = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.config = onSnapshot(docConfig, (snap) => {
    const data = snap.data() || {};
    if (typeof data.dividendsYearlyGoal === 'number') state.dividendsYearlyGoal = data.dividendsYearlyGoal;
    if (typeof data.dividendsYearlyGoalYear === 'number') state.dividendsYearlyGoalYear = data.dividendsYearlyGoalYear;
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.i10 = onSnapshot(docI10, (snap) => {
    const data = snap.data() || {};
    state.i10.equity = +data.equity || 0;
    state.i10.dividends = +data.dividends || 0;
    state.i10.updatedAt = data.updatedAt?.toDate?.() || null;
    state.i10.year = data.year || new Date().getFullYear();
    state.i10.assets = Array.isArray(data.assets) ? data.assets : [];
    state.i10.applied = +data.applied || 0;
    state.i10.variation = +data.variation || 0;
    state.i10.profitTwr = +data.profitTwr || 0;
    state.i10.source = data.source || null;
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.i10Cfg = onSnapshot(docI10Cfg, (snap) => {
    const data = snap.data() || {};
    state.i10Cfg.workerUrl = data.workerUrl || '';
    state.i10Cfg.walletId = data.walletId || '';
  });
}
function unsubscribeAll() { Object.values(unsub).forEach(fn => fn && fn()); unsub = {}; }

// ============================================================
//                 AUTH
// ============================================================
$('btnLogin').addEventListener('click', async () => {
  $('loginError').classList.remove('show');
  $('btnLoginText').textContent = 'Entrando...';
  try { await signInWithPopup(auth, provider); }
  catch (err) {
    console.error(err);
    $('loginError').textContent = 'Erro ao entrar: ' + (err.message || err.code);
    $('loginError').classList.add('show');
    $('btnLoginText').textContent = 'Entrar com Google';
  }
});
$('btnLogout').addEventListener('click', async () => { unsubscribeAll(); await signOut(auth); });

onAuthStateChanged(auth, async (user) => {
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
      // Default mode: expenses
      switchMode('expenses');
    } catch (err) {
      console.error('Firestore error:', err);
    }
  } else {
    state.user = null;
    unsubscribeAll();
    $('loginScreen').classList.remove('hide');
    $('app').classList.remove('show');
    $('btnLoginText').textContent = 'Entrar com Google';
  }
});
