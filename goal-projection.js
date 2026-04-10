// ============================================================
//  GOAL PROJECTION — ok Ledger feature (independent module)
//  v3: CAGR realizado vs necessário, com empty state e ponto YTD
// ============================================================
import { initializeApp, getApps, getApp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js”;
import { getAuth, onAuthStateChanged } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js”;
import { getFirestore, doc, setDoc, collection, onSnapshot, serverTimestamp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js”;

const firebaseConfig = {
apiKey: “AIzaSyA5zsPOxpOBPN8BVnJRIN0mIJ4gdlUntc8”,
authDomain: “wealthy-tracker-68658.firebaseapp.com”,
projectId: “wealthy-tracker-68658”,
storageBucket: “wealthy-tracker-68658.firebasestorage.app”,
messagingSenderId: “559892333696”,
appId: “1:559892333696:web:3272f0f8e86449f4885265”
};

// Reuse Firebase app initialized by app.js (or create if not yet)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Same Firestore paths used by app.js
const colYearly = () => collection(db, “household”, “main”, “dividendsYearly”);
const docConfig = doc(db, “household”, “main”, “config”, “settings”);
const docI10    = doc(db, “household”, “main”, “config”, “i10”);

// ============================================================
//                       LOCAL STATE
// ============================================================
const state = {
yearly: [],
i10Dividends: 0,
goalAmount: 1_000_000,
goalYear: 2035,
ready: false,
authReady: false,
};

let unsubFns = [];

// ============================================================
//                  CAGR LOGIC (Opção B)
//  - CAGR realizado: usa últimos 3 anos COMPLETOS
//  - CAGR necessário: do último ano completo até a meta
//  - YTD do ano corrente: só ponto extra no gráfico, NÃO entra no cálculo
// ============================================================
function calculate() {
const currentYear = new Date().getFullYear();

// Anos completos (exclui ano corrente parcial)
const completeYears = state.yearly
.filter(y => y.year < currentYear && (+y.divs || 0) > 0)
.sort((a, b) => a.year - b.year);

if (completeYears.length < 3) {
return {
ok: false,
reason: ‘insufficient’,
yearsCount: completeYears.length,
needed: 3,
};
}

const sorted = completeYears;
const last = sorted[sorted.length - 1];
const first = sorted[0];
const yearsLeft = state.goalYear - last.year;

// CAGR necessário: do último ano completo até a meta
const requiredCAGR = yearsLeft > 0
? Math.pow(state.goalAmount / last.value, 1 / yearsLeft) - 1
: 0;

// CAGR realizado: últimos 3 anos completos (ou menos se não tiver)
const trailSpan = Math.min(3, sorted.length - 1);
const trailStart = sorted[sorted.length - 1 - trailSpan];
const trailCAGR = trailStart.value > 0
? Math.pow(last.value / trailStart.value, 1 / trailSpan) - 1
: 0;

// Margem e status
const margin = trailCAGR - requiredCAGR;
let successPct, status;
if (margin >= 0.10)      { successPct = 95; status = ‘ok’; }
else if (margin >= 0.03) { successPct = 88; status = ‘ok’; }
else if (margin >= -0.02){ successPct = 75; status = ‘ok’; }
else if (margin >= -0.08){ successPct = 55; status = ‘warn’; }
else                     { successPct = 25; status = ‘bad’; }

const progressPct = Math.min(100, (last.value / state.goalAmount) * 100);

return {
ok: true,
history: sorted,
last,
first,
yearsLeft,
requiredCAGR,
trailCAGR,
trailSpan,
margin,
successPct,
status,
progressPct,
ytdValue: state.i10Dividends,  // ponto extra no gráfico
ytdYear: currentYear,
};
}

// ============================================================
//                       FORMATTING
// ============================================================
const fmt = {
money: v => {
const abs = Math.abs(v);
if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(’.’, ‘,’) + ‘M’;
if (abs >= 1_000) return Math.round(v / 1_000) + ‘k’;
return Math.round(v).toString();
},
pct: (v, dec = 1) => (v * 100).toFixed(dec).replace(’.’, ‘,’) + ‘%’,
pctInt: v => Math.round(v * 100) + ‘%’,
};

// ============================================================
//                         RENDER
// ============================================================
function render() {
const container = document.getElementById(‘goalCardV2’);
if (!container) {
console.warn(’[goal-projection] #goalCardV2 not found in DOM’);
return;
}

// Loading state (auth not ready yet)
if (!state.authReady) {
container.innerHTML = `<div class="goal-v2"> <div class="head"> <div class="left"> <div class="lbl">Meta de longo prazo</div> <h3 style="opacity:.5">Carregando...</h3> </div> </div> </div>`;
return;
}

const r = calculate();

// Empty state — não tem dados suficientes
if (!r.ok) {
renderEmptyState(container, r);
return;
}

// Card cheio com CAGR
renderFullCard(container, r);
}

// ============================================================
//                    EMPTY STATE
// ============================================================
function renderEmptyState(container, r) {
const yearsCount = r.yearsCount || 0;
const needed = r.needed || 3;
const remaining = needed - yearsCount;

container.innerHTML = `
<div class="goal-v2">
<div class="head">
<div class="left">
<div class="lbl">
<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
</svg>
Meta de longo prazo
</div>
<h3>R$ ${fmt.money(state.goalAmount)}/ano em proventos até ${state.goalYear}</h3>
</div>
<button class="edit-btn-v2" id="goalEditBtn" aria-label="Editar meta">
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>
</button>
</div>

```
  <div class="empty-state">
    <div class="empty-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v18h18"/>
        <path d="M7 14l4-4 4 4 5-5"/>
      </svg>
    </div>
    <h4>Cadastre seu histórico</h4>
    <p>Pra calcular a projeção, preciso de pelo menos <b>3 anos completos</b> de dividendos cadastrados.<br/>
    Atualmente: <b>${yearsCount} de ${needed} ${yearsCount === 1 ? 'ano cadastrado' : 'anos cadastrados'}</b>${remaining > 0 ? ` · faltam ${remaining}` : ''}.</p>
    <button class="empty-cta" onclick="document.getElementById('btnAddYear')?.click()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Adicionar ano
    </button>

    ${yearsCount > 0 ? `
      <div class="empty-progress">
        ${Array.from({ length: needed }).map((_, i) => `
          <span class="dot ${i < yearsCount ? 'filled' : ''}"></span>
        `).join('')}
      </div>
    ` : ''}
  </div>
</div>
```

`;

attachEditButton();
}

// ============================================================
//                    FULL CARD (CAGR)
// ============================================================
function renderFullCard(container, r) {
const chartSvg = buildChartSvg(r);
const narrative = buildNarrative(r);

container.innerHTML = `
<div class="goal-v2 status-${r.status}">
<div class="head">
<div class="left">
<div class="lbl">
<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
</svg>
Meta de longo prazo
</div>
<h3>R$ ${fmt.money(state.goalAmount)}/ano em proventos até ${state.goalYear}</h3>
</div>
<div class="right">
<button class="edit-btn-v2" id="goalEditBtn" aria-label="Editar meta">
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>
</button>
<div class="success-badge">
<span class="pct">${r.successPct}%</span>
<span class="lbl2">chance de sucesso</span>
</div>
</div>
</div>

```
  <div class="chart">${chartSvg}</div>

  <div class="legend">
    <span class="leg"><span class="sw real"></span>Recebido</span>
    <span class="leg"><span class="sw req"></span>Mínimo necessário</span>
    <span class="leg"><span class="sw goal"></span>Meta</span>
    ${r.ytdValue > 0 ? `<span class="leg"><span class="sw ytd"></span>YTD ${r.ytdYear}*</span>` : ''}
  </div>

  <div class="narrative">${narrative}</div>

  <div class="stats-row">
    <div class="item">
      <div class="lbl3">Ritmo atual</div>
      <div class="val3 ${r.status === 'bad' ? 'neg' : r.status === 'warn' ? 'warn' : 'pos'}">${fmt.pctInt(r.trailCAGR)}</div>
      <div class="sub3">últimos ${r.trailSpan} anos</div>
    </div>
    <div class="item">
      <div class="lbl3">Necessário</div>
      <div class="val3 warn">${fmt.pct(r.requiredCAGR, 1)}</div>
      <div class="sub3">próximos ${r.yearsLeft} anos</div>
    </div>
    <div class="item">
      <div class="lbl3">Progresso</div>
      <div class="val3">${r.progressPct.toFixed(1)}<span class="u">%</span></div>
      <div class="sub3">R$ ${fmt.money(r.last.value)} / ${fmt.money(state.goalAmount)}</div>
    </div>
  </div>

  <div class="foot">
    <div class="progress-line">${r.last.year} · R$ ${fmt.money(r.last.value)}/ano</div>
    <button class="info-btn-v2" id="goalInfoBtn">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      Como calculo
    </button>
  </div>

  <div class="algo-info-v2" id="algoInfoV2">
    <h4>Como os números são calculados</h4>
    <p><b>Ritmo atual</b> = CAGR (taxa composta anual) dos <code>últimos ${r.trailSpan} anos completos</code>. É quanto você cresceu em média.</p>
    <p><b>Ritmo necessário</b> = CAGR constante que, partindo do ano mais recente, chega exatamente na meta no ano alvo.</p>
    <p><b>Chance de sucesso</b> classificada pela margem entre os dois:</p>
    <p style="margin-left:12px;font-family:'Geist Mono',monospace;font-size:10px">
      ≥ +10 p.p. → 95% &nbsp; · &nbsp; +3 a +10 → 88% &nbsp; · &nbsp; −2 a +3 → 75%<br/>
      −8 a −2 → 55% &nbsp; · &nbsp; &lt; −8 → 25%
    </p>
    ${r.ytdValue > 0 ? `<p style="margin-top:10px"><b>* YTD ${r.ytdYear}</b> (R$ ${fmt.money(r.ytdValue)}) é parcial — não entra no cálculo de CAGR. Vai virar dado completo quando você cadastrar o ano fechado.</p>` : ''}
  </div>
</div>
```

`;

attachEditButton();
attachInfoButton();
}

// ============================================================
//                    CHART SVG
// ============================================================
function buildChartSvg(r) {
const W = 360, H = 190;
const padL = 8, padR = 8, padT = 24, padB = 22;
const innerW = W - padL - padR;
const innerH = H - padT - padB;

const firstYear = r.first.year;
const xMax = state.goalYear;
const yMax = Math.max(state.goalAmount * 1.12, r.last.value * 1.5);

const xScale = y => padL + ((y - firstYear) / (xMax - firstYear)) * innerW;
const yScale = v => padT + (1 - v / yMax) * innerH;
const baseline = (padT + innerH).toFixed(1);

// Real history points
const histPts = r.history.map(h => `${xScale(h.year).toFixed(1)} ${yScale(+h.divs).toFixed(1)}`);
const histPath = `M ${histPts.join(' L ')}`;
const histArea = `M ${xScale(firstYear).toFixed(1)} ${baseline} L ${histPts.join(' L ')} L ${xScale(r.last.year).toFixed(1)} ${baseline} Z`;

// Required trajectory: from last real point to goal at required CAGR
const reqPts = [];
for (let y = r.last.year; y <= state.goalYear; y++) {
const dy = y - r.last.year;
const val = r.last.value * Math.pow(1 + r.requiredCAGR, dy);
reqPts.push(`${xScale(y).toFixed(1)} ${yScale(val).toFixed(1)}`);
}
const reqPath = `M ${reqPts.join(' L ')}`;

const goalY = yScale(state.goalAmount);
const nowX = xScale(r.last.year);
const nowY = yScale(r.last.value);
const goalX = xScale(state.goalYear);

// YTD point (current year, partial — ghost marker)
let ytdMarker = ‘’;
if (r.ytdValue > 0 && r.ytdYear > r.last.year && r.ytdYear <= state.goalYear) {
const ytdX = xScale(r.ytdYear);
const ytdY = yScale(r.ytdValue);
ytdMarker = `<circle cx="${ytdX.toFixed(1)}" cy="${ytdY.toFixed(1)}" r="4" fill="var(--surface)" stroke="#0071e3" stroke-width="1.5" stroke-dasharray="2 2" opacity=".75"/> <text x="${ytdX.toFixed(1)}" y="${(ytdY - 8).toFixed(1)}" text-anchor="middle" fill="#0071e3" style="font-size:8px;font-family:'Geist Mono',monospace;font-weight:600;opacity:.7">YTD</text>`;
}

const ticks = [
{ year: firstYear },
{ year: r.last.year },
{ year: state.goalYear },
];
const mid = Math.round((r.last.year + state.goalYear) / 2);
if (mid !== r.last.year && mid !== state.goalYear) ticks.push({ year: mid });

const yTickValues = [yMax * 0.5, yMax * 0.25];

return `
<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs>
<linearGradient id="realGradV2" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%"  stop-color="#0071e3" stop-opacity=".35"/>
<stop offset="100%" stop-color="#0071e3" stop-opacity="0"/>
</linearGradient>
</defs>

```
  ${yTickValues.map(v => `
    <line class="gridline" x1="${padL}" y1="${yScale(v).toFixed(1)}" x2="${W - padR}" y2="${yScale(v).toFixed(1)}"/>
    <text class="axis" x="${W - padR}" y="${(yScale(v) - 3).toFixed(1)}" text-anchor="end">${fmt.money(v)}</text>
  `).join('')}

  <line class="goal-line-h" x1="${padL}" y1="${goalY.toFixed(1)}" x2="${W - padR}" y2="${goalY.toFixed(1)}"/>
  <text class="goal-lbl-txt" x="${padL + 4}" y="${(goalY - 5).toFixed(1)}">META · R$ ${fmt.money(state.goalAmount)}</text>

  <path class="area-real" d="${histArea}"/>
  <path class="line-req" d="${reqPath}"/>
  <path class="line-real" d="${histPath}"/>

  ${ytdMarker}

  <circle class="now-dot-outer" cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="9"/>
  <circle class="now-dot" cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="5"/>

  <circle class="goal-dot-outer" cx="${goalX.toFixed(1)}" cy="${goalY.toFixed(1)}" r="9"/>
  <circle class="goal-dot" cx="${goalX.toFixed(1)}" cy="${goalY.toFixed(1)}" r="5"/>

  ${ticks.map(t => `
    <text class="axis" x="${xScale(t.year).toFixed(1)}" y="${(padT + innerH + 13).toFixed(1)}" text-anchor="middle">'${(t.year % 100).toString().padStart(2, '0')}</text>
  `).join('')}
</svg>
```

`;
}

// ============================================================
//                    NARRATIVE
// ============================================================
function buildNarrative(r) {
const realTxt = `<span class="num">${fmt.pctInt(r.trailCAGR)}/ano</span>`;
const reqTxt = `<span class="num">${fmt.pct(r.requiredCAGR, 1)}/ano</span>`;
const valTxt = `<b>R$ ${fmt.money(r.last.value)}/ano</b>`;

if (r.status === ‘ok’) {
if (r.margin >= 0.10) {
return `Você recebeu ${valTxt} em ${r.last.year}, crescendo ${realTxt} na média. Pra bater <b>R$ ${fmt.money(state.goalAmount)}/ano</b> em <b>${state.goalYear}</b>, basta manter ${reqTxt} — você está <span class="pos">bem à frente</span>, com folga.`;
} else if (r.margin >= 0.03) {
return `Crescendo ${realTxt} e precisando de ${reqTxt} pra bater a meta em <b>${state.goalYear}</b>, você está <span class="pos">no azul</span>. Margem confortável.`;
} else {
return `Você está <span class="pos">quase exatamente no ritmo</span>: crescendo ${realTxt}, precisando de ${reqTxt}. Sem muita folga, mas dentro da trajetória.`;
}
} else if (r.status === ‘warn’) {
return `Atenção: ritmo atual de ${realTxt} está <span class="warn">abaixo</span> do necessário (${reqTxt}) pra bater a meta em <b>${state.goalYear}</b>. Precisa acelerar um pouco.`;
} else {
return `Ritmo atual de ${realTxt} está <span class="neg">bem abaixo</span> do necessário (${reqTxt}). Nessa toada, a meta de <b>${state.goalYear}</b> não será atingida — considere aumentar aportes ou revisar o prazo.`;
}
}

// ============================================================
//                    EVENT HANDLERS
// ============================================================
function attachEditButton() {
const btn = document.getElementById(‘goalEditBtn’);
if (!btn) return;
btn.addEventListener(‘click’, openGoalEditModal);
}

function attachInfoButton() {
const btn = document.getElementById(‘goalInfoBtn’);
if (!btn) return;
btn.addEventListener(‘click’, () => {
document.getElementById(‘algoInfoV2’)?.classList.toggle(‘show’);
});
}

function openGoalEditModal() {
const modal = document.getElementById(‘goalEditModal’);
if (!modal) return;
document.getElementById(‘goalAmountInput’).value = state.goalAmount;
document.getElementById(‘goalYearInput’).value = state.goalYear;
modal.classList.add(‘show’);
setTimeout(() => document.getElementById(‘goalAmountInput’).focus(), 50);
}

function closeGoalEditModal() {
document.getElementById(‘goalEditModal’)?.classList.remove(‘show’);
}

async function saveGoalEdit() {
const amount = parseFloat(document.getElementById(‘goalAmountInput’).value);
const year = parseInt(document.getElementById(‘goalYearInput’).value);
if (!(amount > 0)) { showToast(‘Valor inválido’); return; }
if (!(year >= 2026 && year <= 2099)) { showToast(‘Ano inválido’); return; }

const btn = document.getElementById(‘goalEditSave’);
try {
btn.disabled = true; btn.textContent = ‘Salvando…’;
await setDoc(docConfig, {
dividendsYearlyGoal: amount,
dividendsYearlyGoalYear: year,
updatedAt: serverTimestamp(),
}, { merge: true });
closeGoalEditModal();
showToast(‘✓ Meta atualizada’);
} catch (err) {
console.error(’[goal-projection] Goal save error:’, err);
showToast(’Erro ao salvar: ’ + (err.message || ‘erro desconhecido’));
} finally {
btn.disabled = false; btn.textContent = ‘Salvar’;
}
}

function showToast(msg) {
const t = document.getElementById(‘toast’);
if (!t) return;
t.textContent = msg;
t.classList.add(‘show’);
setTimeout(() => t.classList.remove(‘show’), 2600);
}

// ============================================================
//                  AUTH-GATED LISTENERS
// ============================================================
function activateListeners() {
console.log(’[goal-projection] activating Firestore listeners’);

const u1 = onSnapshot(colYearly(), (snap) => {
state.yearly = snap.docs.map(d => ({ id: d.id, …d.data() }));
state.ready = true;
render();
}, (err) => console.error(’[goal-projection] yearly listener error:’, err));

const u2 = onSnapshot(docConfig, (snap) => {
const data = snap.data() || {};
if (typeof data.dividendsYearlyGoal === ‘number’) state.goalAmount = data.dividendsYearlyGoal;
if (typeof data.dividendsYearlyGoalYear === ‘number’) state.goalYear = data.dividendsYearlyGoalYear;
if (state.ready) render();
}, (err) => console.error(’[goal-projection] config listener error:’, err));

const u3 = onSnapshot(docI10, (snap) => {
const data = snap.data() || {};
state.i10Dividends = +data.dividends || 0;
if (state.ready) render();
}, (err) => console.error(’[goal-projection] i10 listener error:’, err));

unsubFns = [u1, u2, u3];
}

function deactivateListeners() {
unsubFns.forEach(fn => fn && fn());
unsubFns = [];
state.ready = false;
}

// Wait for auth before activating listeners
onAuthStateChanged(auth, (user) => {
console.log(’[goal-projection] auth state changed:’, user ? user.email : ‘logged out’);
if (user) {
state.authReady = true;
activateListeners();
} else {
state.authReady = false;
deactivateListeners();
render();
}
});

// Bind modal buttons (once on load)
document.addEventListener(‘DOMContentLoaded’, () => {
document.getElementById(‘goalEditCancel’)?.addEventListener(‘click’, closeGoalEditModal);
document.getElementById(‘goalEditSave’)?.addEventListener(‘click’, saveGoalEdit);
document.getElementById(‘goalEditModal’)?.addEventListener(‘click’, e => {
if (e.target.id === ‘goalEditModal’) closeGoalEditModal();
});
render();
});