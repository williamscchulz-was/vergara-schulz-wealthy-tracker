// ============================================================
//  GOAL PROJECTION — Ledger feature (independent module)
//  Isolated from app.js. Reads from same Firestore docs.
// ============================================================
import { initializeApp, getApps, getApp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js”;
import { getFirestore, doc, setDoc, collection, onSnapshot, serverTimestamp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js”;

// Reuse Firebase app initialized by app.js (or initialize fresh if needed)
const firebaseConfig = {
apiKey: “AIzaSyA5zsPOxpOBPN8BVnJRIN0mIJ4gdlUntc8”,
authDomain: “wealthy-tracker-68658.firebaseapp.com”,
projectId: “wealthy-tracker-68658”,
storageBucket: “wealthy-tracker-68658.firebasestorage.app”,
messagingSenderId: “559892333696”,
appId: “1:559892333696:web:3272f0f8e86449f4885265”
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Same Firestore paths used by app.js
const colYearly = () => collection(db, “household”, “main”, “dividendsYearly”);
const docConfig = doc(db, “household”, “main”, “config”, “settings”);
const docI10    = doc(db, “household”, “main”, “config”, “i10”);

// ============================================================
//                       LOCAL STATE
// ============================================================
const state = {
yearly: [],          // [{ year, equity, divs }]
i10Dividends: 0,     // YTD do ano corrente
goalAmount: 1_000_000,
goalYear: 2035,
ready: false,
};

// ============================================================
//                  PROJECTION ALGORITHM
//  Meta = receber R$ X em proventos POR ANO (renda anual)
// ============================================================
function calculateProjection() {
// Pega só anos completos do histórico (exclui o ano corrente, que é parcial via i10)
const currentYear = new Date().getFullYear();
const completeYears = state.yearly
.filter(y => y.year < currentYear && (+y.divs || 0) > 0)
.sort((a, b) => a.year - b.year);

if (completeYears.length < 3) {
return {
ok: false,
reason: ‘insufficient’,
yearsCount: completeYears.length,
};
}

const sorted = completeYears;
const lastYear = sorted[sorted.length - 1].year;
const lastValue = +sorted[sorted.length - 1].divs;

// Step 1: weighted average of last 3 growth rates
const rates = [];
for (let i = 1; i < sorted.length; i++) {
const prev = +sorted[i - 1].divs;
const curr = +sorted[i].divs;
if (prev > 0) rates.push(curr / prev - 1);
}
const recent = rates.slice(-3);
const weights = recent.length === 3 ? [1, 2, 3] : recent.length === 2 ? [1, 2] : [1];
const weightSum = weights.reduce((a, b) => a + b, 0);
let rate = recent.reduce((sum, r, i) => sum + r * weights[i], 0) / weightSum;

// Sanity bounds + cap inicial
if (isNaN(rate) || rate < 0.02) rate = 0.05;
const INITIAL_CAP = 0.60;
if (rate > INITIAL_CAP) rate = INITIAL_CAP;
const initialRate = rate;

// Step 2 & 3: project annual values with decay + floor
const DECAY = 0.75;
const FLOOR = 0.05;
const projection = [];
let value = lastValue;
let etaYear = null;
let valueAtTarget = null;

const maxYear = lastYear + 30;
for (let year = lastYear + 1; year <= maxYear; year++) {
rate = Math.max(rate * DECAY, FLOOR);
value = value * (1 + rate);
projection.push({ year, value, rate });
if (etaYear === null && value >= state.goalAmount) etaYear = year;
if (year === state.goalYear) valueAtTarget = value;
if (year > state.goalYear && etaYear !== null) break;
}

return {
ok: true,
history: sorted,
projection,
etaYear,
valueAtTarget,
lastCompleteValue: lastValue,
lastCompleteYear: lastYear,
ytdValue: state.i10Dividends,
ytdYear: currentYear,
initialRate,
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
};

// ============================================================
//                         RENDER
// ============================================================
function render() {
const container = document.getElementById(‘goalCardV2’);
if (!container) return;

const r = calculateProjection();

if (!r.ok) {
// Empty state
container.innerHTML = `<div class="goal-v2"> <div class="head"> <div class="left"> <div class="lbl"> <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"> <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/> </svg> Meta de longo prazo </div> <h3>R$ ${fmt.money(state.goalAmount)}/ano em proventos até ${state.goalYear}</h3> </div> <button class="edit-btn-v2" id="goalEditBtn" aria-label="Editar meta"> <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/> </svg> </button> </div> <div class="empty-state"> <h4>Histórico insuficiente para projeção</h4> <p>São necessários pelo menos <b>3 anos completos</b> de dividendos no histórico anual.<br/> Atualmente: <b>${r.yearsCount} ${r.yearsCount === 1 ? 'ano cadastrado' : 'anos cadastrados'}</b>.</p> <button onclick="document.getElementById('btnAddYear')?.click()">+ Adicionar ano</button> </div> </div>`;
attachEditButton();
return;
}

// Calcular status
const lastV = r.lastCompleteValue;
const pct = Math.min(100, Math.round(lastV / state.goalAmount * 100));
const yearsLeft = Math.max(0, state.goalYear - new Date().getFullYear());

// Build chart SVG
const chartSvg = buildChartSvg(r);

// Build narrative
const narrative = buildNarrative(r);

// Build stats
const stats = buildStats(r);

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
<div class="right">
<button class="edit-btn-v2" id="goalEditBtn" aria-label="Editar meta">
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>
</button>
<div class="pct">${pct}%</div>
<div class="left-yr">${yearsLeft} ${yearsLeft === 1 ? ‘ano restante’ : ‘anos restantes’}</div>
</div>
</div>

```
  <div class="chart">${chartSvg}</div>

  <div class="narrative">${narrative}</div>

  ${stats}

  <div class="foot">
    <div class="leg">
      <span><span class="sw"></span>Realizado</span>
      <span><span class="sw proj"></span>Projeção</span>
    </div>
    <button class="info-btn" id="goalInfoBtn">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      Como calculo
    </button>
  </div>

  <div class="algo-info-v2" id="algoInfoV2">
    <h4>Como a projeção é calculada</h4>
    <p>1. Pego só os <b>anos completos</b> do histórico. A partir deles, calculo a média ponderada das taxas de crescimento dos últimos <code>3 anos</code>, dando peso maior aos mais recentes <code>(1×, 2×, 3×)</code>.</p>
    <p>2. Aplico um <b>cap de 60% a.a.</b> na taxa inicial pra evitar projeções irreais em carteiras jovens.</p>
    <p>3. A cada ano projetado, multiplico essa taxa por <code>0.75</code> (decay anual de 25%).</p>
    <p>4. Aplico um piso de <code>5% a.a.</code></p>
    <p style="margin-top:10px;font-style:italic">Taxa atual estimada (após cap): <span style="font-family:'Geist Mono',monospace">${(r.initialRate * 100).toFixed(1)}% a.a.</span></p>
  </div>
</div>
```

`;

attachEditButton();
attachInfoButton();
}

function buildChartSvg(r) {
const W = 360, H = 170;
const padL = 4, padR = 4, padT = 22, padB = 20;
const innerW = W - padL - padR;
const innerH = H - padT - padB;

const firstYear = r.history[0].year;
const lastProjYear = r.projection.length
? r.projection[r.projection.length - 1].year
: r.lastCompleteYear;
const xMax = Math.max(state.goalYear, lastProjYear);
const lastProjValue = r.projection.length ? r.projection[r.projection.length - 1].value : 0;
const yMax = Math.max(state.goalAmount * 1.15, lastProjValue * 1.05);

const xScale = year => padL + ((year - firstYear) / (xMax - firstYear)) * innerW;
const yScale = value => padT + (1 - value / yMax) * innerH;
const baselineY = (padT + innerH).toFixed(1);

// Histórico (valores anuais)
const histPts = r.history.map(h => `${xScale(h.year).toFixed(1)} ${yScale(+h.divs).toFixed(1)}`);
const histPath = `M ${histPts.join(' L ')}`;
const histArea = `M ${xScale(firstYear).toFixed(1)} ${baselineY} L ${histPts.join(' L ')} L ${xScale(r.lastCompleteYear).toFixed(1)} ${baselineY} Z`;

// Projeção
let projPath = ‘’, projArea = ‘’;
if (r.projection.length) {
const startX = xScale(r.lastCompleteYear);
const startY = yScale(r.lastCompleteValue);
const projPts = [`${startX.toFixed(1)} ${startY.toFixed(1)}`];
r.projection.forEach(p => {
if (p.year <= xMax) projPts.push(`${xScale(p.year).toFixed(1)} ${yScale(p.value).toFixed(1)}`);
});
projPath = `M ${projPts.join(' L ')}`;
const lastProjX = xScale(Math.min(xMax, r.projection[r.projection.length - 1].year));
projArea = `M ${startX.toFixed(1)} ${baselineY} L ${projPts.join(' L ')} L ${lastProjX.toFixed(1)} ${baselineY} Z`;
}

const goalY = yScale(state.goalAmount);
const nowX = xScale(r.lastCompleteYear);
const nowY = yScale(r.lastCompleteValue);
const ytdX = xScale(r.ytdYear);
const ytdY = yScale(Math.max(r.ytdValue, 1));

let etaX = null;
if (r.etaYear && r.etaYear <= xMax) etaX = xScale(r.etaYear);

const ticks = [
{ year: firstYear },
{ year: r.lastCompleteYear },
{ year: state.goalYear },
];
if (r.etaYear && r.etaYear !== state.goalYear && r.etaYear <= xMax && r.etaYear !== r.lastCompleteYear) {
ticks.push({ year: r.etaYear });
}

const yTickValues = [yMax * 0.7, yMax * 0.35];

return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"> <defs> <linearGradient id="realGradV2" x1="0" y1="0" x2="0" y2="1"> <stop offset="0%"  stop-color="#0071e3" stop-opacity=".4"/> <stop offset="100%" stop-color="#0071e3" stop-opacity="0"/> </linearGradient> <linearGradient id="projGradV2" x1="0" y1="0" x2="0" y2="1"> <stop offset="0%"  stop-color="#0071e3" stop-opacity=".18"/> <stop offset="100%" stop-color="#0071e3" stop-opacity="0"/> </linearGradient> </defs> <line class="goal-line-h" x1="0" y1="${goalY.toFixed(1)}" x2="${W}" y2="${goalY.toFixed(1)}"/> <text class="goal-lbl" x="4" y="${(goalY - 5).toFixed(1)}">R$ ${fmt.money(state.goalAmount)}/ano · meta</text> ${yTickValues.map(v =>`<text class="axis" x="${W - 4}" y="${(yScale(v) + 3).toFixed(1)}" text-anchor="end">${fmt.money(v)}</text>`).join('')} <path class="area-real" d="${histArea}"/> ${projPath ? `<path class="area-proj" d="${projArea}"/>`: ''} <path class="line-real" d="${histPath}"/> ${projPath ?`<path class="line-proj" d="${projPath}"/>`: ''} ${etaX !== null ?`
<line class="eta-line-v" x1="${etaX.toFixed(1)}" y1="${goalY.toFixed(1)}" x2="${etaX.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}"/>
<circle class="eta-dot-v" cx="${etaX.toFixed(1)}" cy="${goalY.toFixed(1)}" r="4"/>
<text class="axis" x="${etaX.toFixed(1)}" y="${(goalY - 8).toFixed(1)}" text-anchor="middle" fill="#1e8e3e" style="font-weight:600">ETA</text>
`: ''} ${r.ytdValue > 0 ?`
<circle cx="${ytdX.toFixed(1)}" cy="${ytdY.toFixed(1)}" r="3" fill="#fff" stroke="#0071e3" stroke-width="1.5" opacity=".7"/>
`: ''} <circle class="now-dot" cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="4.5"/> ${ticks.map(t =>`<text class="axis" x="${xScale(t.year).toFixed(1)}" y="${(padT + innerH + 12).toFixed(1)}" text-anchor="middle">’${(t.year % 100).toString().padStart(2, ‘0’)}</text>`).join('')} </svg> `;
}

function buildNarrative(r) {
const lastV = r.lastCompleteValue;
const lastVFmt = `R$ ${fmt.money(lastV)}`;
const pct = (lastV / state.goalAmount * 100).toFixed(1).replace(’.’, ‘,’);

if (lastV >= state.goalAmount) {
return `<b>Meta atingida!</b> Você já recebe <b>${lastVFmt}/ano</b>. <span class="pos">Renda passiva alvo alcançada.</span>`;
}
if (r.etaYear === null) {
return `Hoje você recebe <b>${lastVFmt}/ano</b> (${pct}% da meta). <span class="neg">No ritmo atual, a meta não será atingida nos próximos 30 anos.</span> Considere aumentar aportes.`;
}
const diff = state.goalYear - r.etaYear;
const valTarget = r.valueAtTarget || 0;
let statusText = ‘’;
if (diff > 0) statusText = `<span class="pos">${diff} ${diff === 1 ? 'ano' : 'anos'} antes do prazo</span>`;
else if (diff < 0) statusText = `<span class="neg">${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'ano' : 'anos'} depois do prazo</span>`;
else statusText = `<span class="neu">exatamente no prazo</span>`;

return `Hoje você recebe <b>${lastVFmt}/ano</b> em proventos (${pct}% da meta). Considerando a desaceleração natural do crescimento, deve atingir <b>R$ ${fmt.money(state.goalAmount)}/ano</b> em <b>${r.etaYear}</b> — ${statusText}. Em <b>${state.goalYear}</b>: <b>R$ ${fmt.money(valTarget)}/ano</b>.`;
}

function buildStats(r) {
let etaText = r.etaYear || ‘—’;
let diffText = ‘—’, diffClass = ‘val’;
if (r.etaYear) {
const diff = state.goalYear - r.etaYear;
if (diff > 0) { diffText = `−${diff} ${diff === 1 ? 'ano' : 'anos'}`; diffClass = ‘val pos’; }
else if (diff < 0) { diffText = `+${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'ano' : 'anos'}`; diffClass = ‘val neg’; }
else { diffText = ‘no prazo’; }
}
let valTargetText = ‘—’;
if (r.valueAtTarget) {
valTargetText = `<span class="cur">R$ </span>${fmt.money(r.valueAtTarget)}<span class="cur">/ano</span>`;
}

return `<div class="stats-row"> <div class="item"> <div class="lbl">ETA</div> <div class="val">${etaText}</div> </div> <div class="item"> <div class="lbl">Diferença</div> <div class="${diffClass}">${diffText}</div> </div> <div class="item"> <div class="lbl">Em ${state.goalYear}</div> <div class="val">${valTargetText}</div> </div> </div>`;
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
console.error(‘Goal save error:’, err);
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

// Bind modal buttons (once on load)
document.addEventListener(‘DOMContentLoaded’, () => {
document.getElementById(‘goalEditCancel’)?.addEventListener(‘click’, closeGoalEditModal);
document.getElementById(‘goalEditSave’)?.addEventListener(‘click’, saveGoalEdit);
document.getElementById(‘goalEditModal’)?.addEventListener(‘click’, e => {
if (e.target.id === ‘goalEditModal’) closeGoalEditModal();
});
});

// ============================================================
//                    FIRESTORE LISTENERS
//  Same docs as app.js — duplicating reads is harmless
// ============================================================
onSnapshot(colYearly(), (snap) => {
state.yearly = snap.docs.map(d => ({ id: d.id, …d.data() }));
state.ready = true;
render();
});

onSnapshot(docConfig, (snap) => {
const data = snap.data() || {};
if (typeof data.dividendsYearlyGoal === ‘number’) state.goalAmount = data.dividendsYearlyGoal;
if (typeof data.dividendsYearlyGoalYear === ‘number’) state.goalYear = data.dividendsYearlyGoalYear;
if (state.ready) render();
});

onSnapshot(docI10, (snap) => {
const data = snap.data() || {};
state.i10Dividends = +data.dividends || 0;
if (state.ready) render();
});

// Initial render with empty state
document.addEventListener(‘DOMContentLoaded’, () => {
setTimeout(() => render(), 100);
});