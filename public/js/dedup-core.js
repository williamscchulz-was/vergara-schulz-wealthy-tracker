// dedup-core.js — motor PURO de detecção de duplicados (Conferência + Revisar duplicados).
// Sem DOM / Firebase / state → testável em node (tests/dedup-core.test.js).
//
// Acha GRUPOS (clusters) de lançamentos que parecem a MESMA despesa real lançada 2+ vezes.
// NUNCA apaga nada: só PROPÕE — quem decide é o usuário, na UI, com confirmação + desfazer.
// Caso primário: a "sobra de provisão" — a provisão de uma parcela ficou no Firestore E a
// parcela real foi importada da fatura (antes do fix de reconciliação), contando em dobro.
//
// REGRAS DE OURO p/ não fundir o que é legítimo:
//   - nunca agrupa só por valor (sempre estabelecimento + tempo + valor);
//   - o doc a MANTER nunca entra na lista de remover;
//   - provisão FUTURA legítima (sem a parcela real correspondente) NÃO é sinalizada;
//   - "quase-certo" = sinal forte (sobra de provisão; cópia re-importada em lote diferente);
//     "talvez" = precisa de olho humano (manual×importado; mesma loja/valor em dias próximos)
//     e NUNCA vem pré-selecionado na UI.

import { impRuleKey } from './import-core.js';

const round2 = (v) => Math.round((+v || 0) * 100) / 100;
const ym = (e) => e.competencia || String(e.date || '').slice(0, 7);   // mês da fatura (cartão) ou do date

// parcela k/total: docs reais/provisão trazem e.installment; fallback parseia "parcela k/Y" das notes.
export function instOf(e) {
  if (e && e.installment && +e.installment.total) return { k: +e.installment.k || 0, total: +e.installment.total || 0 };
  const m = String((e && e.notes) || '').match(/parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})/i);
  return m ? { k: +m[1], total: +m[2] } : null;
}
const sameInst = (a, b) => !!(a && b && a.k === b.k && a.total === b.total);

// titular do cartão embutido nas notes ("cartão: NAME") → primeira palavra, minúscula. '' se não há.
export function cardOf(e) {
  const m = String((e && e.notes) || '').match(/cart[aã]o:\s*([^\s·]+)/i);
  return m ? m[1].toLowerCase() : '';
}

// origem grosseira do lançamento.
export function srcKind(e) {
  const s = String((e && e.source) || '');
  if (s.startsWith('import')) return 'import';
  if (s.startsWith('auto')) return 'auto';
  return 'manual';
}

const dnum = (e) => { const d = Date.parse(String(e.date || '') + 'T00:00:00Z'); return Number.isNaN(d) ? null : d / 86400000; };
const fpOf = (e) => e.fp || (String(e.date || '') + '|' + round2(e.value).toFixed(2) + '|' + String(e.description || '').slice(0, 16).toLowerCase().replace(/\s+/g, ''));

function deltaInfo(a, b) {                                   // a = manter, b = remover
  const av = round2(a.value), bv = round2(b.value);
  if (Math.abs(av - bv) >= 0.01) {
    const base = bv || av || 1;
    return { type: 'value', amount: round2(Math.abs(av - bv)), pct: Math.round((Math.abs(av - bv) / base) * 1000) / 10 };
  }
  const da = dnum(a), db = dnum(b);
  if (da != null && db != null && da !== db) return { type: 'days', amount: Math.abs(da - db) };
  return null;
}

function member(e, role) {
  return { id: e.id, date: e.date, value: round2(e.value), description: e.description || '', owner: e.owner || '',
    card: cardOf(e), src: srcKind(e), provisioned: !!e.provisioned, installment: instOf(e), role };
}
function cluster(kind, confidence, keep, removeArr, why) {
  const d = removeArr.length ? deltaInfo(keep, removeArr[0]) : null;
  return {
    id: 'dc_' + keep.id + '_' + removeArr.map(r => r.id).join('_'),
    kind, confidence,
    merchant: (keep.description || removeArr[0] && removeArr[0].description || '').trim(),
    value: round2(keep.value),
    ym: ym(keep), why, delta: d,
    keepId: keep.id, removeIds: removeArr.map(r => r.id),
    members: [member(keep, 'manter'), ...removeArr.map(r => member(r, 'remover'))],
  };
}

// Acha os clusters de duplicado. expenses = array de docs (cada um com id). opts.nearDays (default 3).
// Retorna array de clusters ordenado por confiança (quase-certo antes) e valor desc.
export function findDuplicateClusters(expenses, opts = {}) {
  const nearDays = opts.nearDays == null ? 3 : opts.nearDays;
  const exps = (expenses || []).filter(e => e && e.id && (e.type || 'expense') === 'expense' && !e.removed);
  const used = new Set();
  const out = [];

  // 1) SOBRA DE PROVISÃO (quase-certo) — provisão de parcela que ficou + a parcela real existe.
  //    Identidade da parcela = estabelecimento + k/total + competência. Não se pode ter a MESMA
  //    parcela k/Y do mesmo lugar na mesma fatura duas vezes → é a mesma cobrança. Mantém a real.
  const provs = exps.filter(e => e.provisioned && instOf(e));
  const reals = exps.filter(e => !e.provisioned);
  for (const p of provs) {
    if (used.has(p.id)) continue;
    const pk = impRuleKey(p.description || ''); if (!pk) continue;
    const pi = instOf(p);
    const real = reals.find(r => !used.has(r.id) && impRuleKey(r.description || '') === pk && sameInst(instOf(r), pi) && ym(r) === ym(p));
    if (real) {
      used.add(p.id); used.add(real.id);
      out.push(cluster('leftover-provision', 'quase-certo', real, [p],
        'A provisão da parcela ' + pi.k + '/' + pi.total + ' ficou sobrando — a parcela real já foi importada da fatura.'));
    }
  }

  // 2) CÓPIA EXATA RE-IMPORTADA (quase-certo) — mesmo fingerprint, mas de LOTES diferentes
  //    (ou manual+importado) → entrou 2× sem querer. Mesmo fp + MESMO batchId = multiset legítimo, ignora.
  const byFp = new Map();
  for (const e of exps) { if (used.has(e.id) || e.provisioned) continue; const k = fpOf(e); (byFp.get(k) || byFp.set(k, []).get(k)).push(e); }
  for (const grp of byFp.values()) {
    if (grp.length < 2) continue;
    const batches = new Set(grp.map(e => e.batchId || ('m:' + srcKind(e))));
    if (batches.size < 2) continue;                          // tudo do mesmo lote = multiset legítimo
    const sorted = grp.slice().sort((a, b) => String(a.batchId || '').localeCompare(String(b.batchId || '')));
    const keep = sorted[0], rem = sorted.slice(1);
    keep && used.add(keep.id); rem.forEach(r => used.add(r.id));
    out.push(cluster('exact-copy', 'quase-certo', keep, rem, 'Lançamento idêntico importado mais de uma vez.'));
  }

  // 3) MANUAL × IMPORTADO (talvez) — digitado à mão + a mesma compra veio na fatura.
  const manuals = exps.filter(e => !e.provisioned && !used.has(e.id) && srcKind(e) === 'manual');
  for (const man of manuals) {
    if (used.has(man.id)) continue;
    const mk = impRuleKey(man.description || ''); if (!mk) continue;
    const imp = exps.find(e => !used.has(e.id) && e.id !== man.id && !e.provisioned && srcKind(e) === 'import'
      && impRuleKey(e.description || '') === mk && round2(e.value) === round2(man.value) && ym(e) === ym(man));
    if (imp) {
      used.add(man.id); used.add(imp.id);
      out.push(cluster('manual-vs-import', 'talvez', imp, [man],
        'Lançamento manual igual a uma compra importada da fatura — pode estar contado em dobro.'));
    }
  }

  // 4) MESMA LOJA/VALOR EM DIAS PRÓXIMOS (talvez) — mesmo estabelecimento + valor + cartão, datas
  //    a até nearDays de distância. Pode ser a mesma compra repetida OU duas idas de verdade → talvez.
  const rest = exps.filter(e => !e.provisioned && !used.has(e.id));
  const byKey = new Map();
  for (const e of rest) {
    const rk = impRuleKey(e.description || ''); if (!rk) continue;
    const k = rk + '|' + round2(e.value).toFixed(2) + '|' + cardOf(e);
    (byKey.get(k) || byKey.set(k, []).get(k)).push(e);
  }
  for (const grp of byKey.values()) {
    if (grp.length < 2) continue;
    const s = grp.slice().sort((a, b) => (dnum(a) || 0) - (dnum(b) || 0));
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (used.has(a.id) || used.has(b.id)) continue;
      const da = dnum(a), db = dnum(b);
      if (da == null || db == null || Math.abs(db - da) > nearDays) continue;
      // multiset legítimo: idênticos (mesmo fp) vindos da MESMA fatura/lote → a fatura lista os dois,
      // são duas cobranças reais; não sinaliza (o import já decidiu manter ambos).
      if (fpOf(a) === fpOf(b) && a.batchId && a.batchId === b.batchId) continue;
      used.add(a.id); used.add(b.id);
      out.push(cluster('near-duplicate', 'talvez', a, [b],
        'Mesma loja e mesmo valor com poucos dias de diferença — confira se não é a mesma compra.'));
    }
  }

  const rank = { 'quase-certo': 0, 'talvez': 1 };
  out.sort((x, y) => (rank[x.confidence] - rank[y.confidence]) || (y.value - x.value));
  return out;
}

// Soma o que seria recuperado removendo os sugeridos de uma lista de clusters (só os pré-selecionáveis,
// i.e. quase-certo) ou de uma seleção dada. Puro — a UI usa pra mostrar "Remover N · R$ X".
export function removalSummary(clusters, selectedIds) {
  const sel = selectedIds ? new Set(selectedIds) : null;
  let count = 0, total = 0;
  for (const c of clusters) {
    for (const m of c.members) {
      if (m.role !== 'remover') continue;
      if (sel ? sel.has(m.id) : c.confidence === 'quase-certo') { count++; total += round2(m.value); }
    }
  }
  return { count, total: round2(total) };
}
