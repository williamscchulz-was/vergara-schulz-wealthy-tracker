// recurring-core.js — lógica PURA de despesas fixas/recorrentes (v8.19).
// Projeção mensal a partir de "templates" + reconciliação com o lançamento real.
// Sem DOM / Firebase / state → testável em node (tests/recurring-core.test.js).
//
// REGRA DE OURO: a instância projetada NUNCA é persistida no Firestore. O real
// (lançado/importado) é a fonte da verdade; a projeção some quando o real existe.
// Assim o pior bug possível é uma linha a mais na tela — nunca uma despesa
// duplicada nos dados.

import { impRuleKey } from './import-core.js';

// ---- "YYYY-MM" helpers ----
export const toYM = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export const ymOf = (s) => String(s || '').slice(0, 7);          // de ISO date OU competência
export const ymCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function ymAdd(yms, n) {
  const [y, m] = String(yms).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return toYM(Math.floor(t / 12), (t % 12) + 1);
}

// Template ativo no mês YM? (start <= YM <= end; end null/'' = indefinido)
export function activeIn(tpl, yms) {
  if (!tpl || !tpl.startYM || !/^\d{4}-\d{2}$/.test(yms || '')) return false;
  if (ymCmp(yms, tpl.startYM) < 0) return false;
  if (tpl.endYM && ymCmp(yms, tpl.endYM) > 0) return false;
  return true;
}

// Um lançamento REAL satisfaz (é a realização de) o template?
// - override/seed manual: `recurringId` bate.
// - cartão: mesma chave de estabelecimento (impRuleKey) + valor dentro da tolerância
//   (a fatura "NETFLIX.COM*SP" confirma a recorrência "Netflix"). tol = fração (0.30 = 30%).
export function satisfies(exp, tpl, tol = 0.30) {
  if (!exp || !tpl) return false;
  if (exp.recurringId && exp.recurringId === tpl.id) return true;
  if (tpl.card && tpl.ruleKey && impRuleKey(exp.description) === tpl.ruleKey) {
    const a = +exp.value || 0, b = +tpl.value || 0;
    if (b <= 0) return true;
    return Math.abs(a - b) / b <= tol;
  }
  return false;
}

// Instância VIRTUAL (projetada) de um template num mês. _virtual=true → não persiste.
export function makeVirtual(tpl, yms, currentYM) {
  const day = Math.min(28, Math.max(1, +tpl.dayOfMonth || 1));
  const future = ymCmp(yms, currentYM || yms) > 0;
  return {
    _virtual: true,
    recurringId: tpl.id,
    type: tpl.type || 'expense',
    description: tpl.desc,
    value: +tpl.value || 0,
    category: tpl.category || 'outros',
    owner: tpl.owner || 'familia',
    nature: 'fixa',
    date: `${yms}-${String(day).padStart(2, '0')}`,
    competencia: yms,
    provisioned: future,   // meses futuros = compromisso (fica fora do total já realizado)
    recurring: true,
    card: !!tpl.card,
  };
}

// Projeta as recorrências do mês YM que ainda NÃO foram satisfeitas por um real.
// realInMonth = lançamentos reais (não-virtuais) cuja competência/mês == YM.
export function projectMonth(templates, realInMonth, yms, currentYM) {
  const out = [];
  for (const tpl of (templates || [])) {
    if (!activeIn(tpl, yms)) continue;
    if ((realInMonth || []).some(e => satisfies(e, tpl))) continue;   // já tem o real → não projeta
    out.push(makeVirtual(tpl, yms, currentYM || yms));
  }
  return out;
}
