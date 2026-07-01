// Testes do motor de recorrência. Rodar: `npm test` (ou `node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impRuleKey } from '../public/js/import-core.js';
import { toYM, ymOf, ymCmp, ymAdd, activeIn, satisfies, makeVirtual, projectMonth, valueFor } from '../public/js/recurring-core.js';

test('helpers de mês (YYYY-MM)', () => {
  assert.equal(toYM(2026, 6), '2026-06');
  assert.equal(ymOf('2026-06-15'), '2026-06');
  assert.equal(ymCmp('2026-05', '2026-06'), -1);
  assert.equal(ymAdd('2026-11', 2), '2027-01');   // vira o ano
  assert.equal(ymAdd('2026-06', -7), '2025-11');
});

test('activeIn — janela start/end (end null = indefinido)', () => {
  const tpl = { startYM: '2026-03', endYM: '2026-08' };
  assert.equal(activeIn(tpl, '2026-02'), false);   // antes
  assert.equal(activeIn(tpl, '2026-03'), true);    // início
  assert.equal(activeIn(tpl, '2026-06'), true);    // meio
  assert.equal(activeIn(tpl, '2026-08'), true);    // fim
  assert.equal(activeIn(tpl, '2026-09'), false);   // depois
  assert.equal(activeIn({ startYM: '2026-01', endYM: null }, '2030-12'), true);  // indefinido
});

test('satisfies — override por recurringId', () => {
  assert.equal(satisfies({ recurringId: 'r1', value: 1 }, { id: 'r1' }), true);
  assert.equal(satisfies({ recurringId: 'rX', value: 1 }, { id: 'r1' }), false);
});

test('satisfies — cartão casa por estabelecimento + valor aprox', () => {
  const tpl = { id: 'r1', card: true, ruleKey: impRuleKey('NETFLIX.COM SAO PAULO'), value: 40 };
  // fatura do mês seguinte, mesmo estabelecimento (nº de loja varia → normalizado some), valor igual
  assert.equal(satisfies({ description: 'NETFLIX.COM SAO PAULO 552', value: 40 }, tpl), true);
  // reajuste pequeno (40 → 44) dentro da tolerância
  assert.equal(satisfies({ description: 'NETFLIX.COM SAO PAULO', value: 44 }, tpl), true);
  // valor muito diferente → NÃO é a mesma (não casa)
  assert.equal(satisfies({ description: 'NETFLIX.COM SAO PAULO', value: 120 }, tpl), false);
  // outro estabelecimento → não casa
  assert.equal(satisfies({ description: 'SPOTIFY BR', value: 40 }, tpl), false);
});

test('satisfies — fixa NÃO-cartão (Pix/boleto/manual) reconcilia por descrição+valor, igual ao cartão', () => {
  // BUG real (jun/2026): antes disso só casava por recurringId (que só nasce na criação do
  // template) → uma fixa paga normalmente todo mês NUNCA reconciliava, e o "Previsto" continuava
  // contando pra sempre mesmo com o gasto real já lançado. Corrigido: usa impRuleKey(tpl.desc)
  // como fallback quando não é cartão — mesma lógica de tolerância já aceita pro cartão.
  const tpl = { id: 'r2', card: false, value: 2000, desc: 'Aluguel' };
  assert.equal(satisfies({ description: 'Aluguel', value: 2000 }, tpl), true);        // lançamento normal do mês seguinte → reconcilia
  assert.equal(satisfies({ description: 'Aluguel', value: 2100 }, tpl), true);        // reajuste pequeno, dentro da tolerância
  assert.equal(satisfies({ description: 'Aluguel', value: 5000 }, tpl), false);       // valor muito diferente → não é a mesma
  assert.equal(satisfies({ description: 'Energia Solar', value: 2000 }, tpl), false); // outra descrição → não casa
  assert.equal(satisfies({ description: 'Aluguel', value: 2000, recurringId: 'r2' }, tpl), true);   // recurringId continua funcionando
  assert.equal(satisfies({ description: 'Aluguel', value: 2000, type: 'income' }, tpl), false);     // ganho não satisfaz despesa fixa
});

test('makeVirtual — conta no saldo sempre; futuro ganha flag _future', () => {
  const tpl = { id: 'r1', desc: 'Aluguel', value: 2000, category: 'moradia', owner: 'familia', dayOfMonth: 10 };
  const cur = makeVirtual(tpl, '2026-06', '2026-06');
  assert.equal(cur._virtual, true);
  assert.equal(cur.provisioned, false);            // entra no saldo
  assert.equal(cur._future, false);
  assert.equal(cur.date, '2026-06-10');
  assert.equal(cur.nature, 'fixa');
  const fut = makeVirtual(tpl, '2026-08', '2026-06');
  assert.equal(fut.provisioned, false);            // CONTA no saldo do mês futuro também
  assert.equal(fut._future, true);                 // só marcado "prevista"
});

test('projectMonth — projeta o que falta, suprime o que já tem real (não duplica)', () => {
  const templates = [
    { id: 'rent', card: false, desc: 'Aluguel', value: 2000, startYM: '2026-01', endYM: null, dayOfMonth: 5 },
    { id: 'net', card: true, ruleKey: impRuleKey('NETFLIX.COM'), desc: 'Netflix', value: 40, startYM: '2026-01', endYM: null, dayOfMonth: 15 },
    { id: 'old', card: false, desc: 'Curso', value: 300, startYM: '2025-01', endYM: '2025-12', dayOfMonth: 1 },  // já encerrado
  ];
  // Mês 2026-06: a fatura já trouxe a Netflix (real); aluguel ainda não tem real.
  const real = [{ description: 'NETFLIX.COM 99', value: 40, competencia: '2026-06' }];
  const v = projectMonth(templates, real, '2026-06', '2026-06');
  const ids = v.map(x => x.recurringId).sort();
  assert.deepEqual(ids, ['rent']);                 // Netflix suprimida (tem real), curso inativo, sobra aluguel
  // Mês sem nenhum real → projeta aluguel + netflix
  assert.equal(projectMonth(templates, [], '2026-07', '2026-06').length, 2);
  // Override manual do aluguel naquele mês → suprime o aluguel projetado
  const v3 = projectMonth(templates, [{ recurringId: 'rent', value: 2100, competencia: '2026-07' }], '2026-07', '2026-06');
  assert.deepEqual(v3.map(x => x.recurringId).sort(), ['net']);
});

test('valueFor — override por mês tem prioridade; senão o valor base; sem overrides = base', () => {
  const tpl = { value: 120, overrides: { '2026-07': 150, '2026-09': 95 } };
  assert.equal(valueFor(tpl, '2026-06'), 120);   // sem override → base
  assert.equal(valueFor(tpl, '2026-07'), 150);   // override do mês
  assert.equal(valueFor(tpl, '2026-09'), 95);
  assert.equal(valueFor({ value: 120 }, '2026-07'), 120);   // template sem overrides
});

test('makeVirtual — usa o override do mês quando existe (gás varia por mês)', () => {
  const tpl = { id: 'gas', desc: 'Gás', value: 120, category: 'casa', owner: 'familia', dayOfMonth: 10, overrides: { '2026-07': 95 } };
  assert.equal(makeVirtual(tpl, '2026-06', '2026-06').value, 120);   // mês sem override → base
  assert.equal(makeVirtual(tpl, '2026-07', '2026-06').value, 95);    // mês com override → override (não mexe nos outros)
});

test('satisfies — cartão usa o valor do MÊS (override) na tolerância', () => {
  const tpl = { id: 'r', card: true, ruleKey: impRuleKey('CLARO'), value: 100, overrides: { '2026-07': 200 } };
  assert.equal(satisfies({ description: 'CLARO', value: 210, competencia: '2026-07' }, tpl), true);   // mês espera ~200 (override)
  assert.equal(satisfies({ description: 'CLARO', value: 100, competencia: '2026-07' }, tpl), false);  // 100 longe de 200 → não casa
  assert.equal(satisfies({ description: 'CLARO', value: 105, competencia: '2026-06' }, tpl), true);   // mês sem override usa base 100
});
