// Testes do núcleo puro de detecção de duplicados. Rodar: `npm test` (ou `node --test`).
// SEM dependências externas — só node:test + node:assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateClusters, removalSummary, instOf, cardOf, srcKind } from '../public/js/dedup-core.js';

// helper p/ montar um lançamento de despesa
const exp = (o) => ({ type: 'expense', ...o });

test('sobra de provisão: provisão + parcela real (mesmo estab+k/Y+competência) → 1 cluster quase-certo, mantém a real', () => {
  const data = [
    exp({ id: 'real', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-09', source: 'import:cartao', installment: { k: 4, total: 10 }, notes: 'cartão: William · parcela 4/10' }),
    exp({ id: 'prov', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-15', provisioned: true, source: 'import:cartao', installment: { k: 4, total: 10 }, notes: 'cartão: William · parcela 4/10 · provisão' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].kind, 'leftover-provision');
  assert.equal(cl[0].confidence, 'quase-certo');
  assert.equal(cl[0].keepId, 'real');
  assert.deepEqual(cl[0].removeIds, ['prov']);
});

test('sobra de provisão casa mesmo com valor estimado diferente (Δ de centavos/reais é só informativo)', () => {
  const data = [
    exp({ id: 'real', description: 'Samsung Store', value: 624.83, competencia: '2026-03', date: '2026-03-11', source: 'import:cartao', installment: { k: 7, total: 12 } }),
    exp({ id: 'prov', description: 'Samsung Store', value: 626.0, competencia: '2026-03', date: '2026-03-15', provisioned: true, source: 'import:cartao', installment: { k: 7, total: 12 } }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].keepId, 'real');
  assert.equal(cl[0].delta.type, 'value');
  assert.equal(cl[0].delta.amount, 1.17);
});

test('provisão FUTURA legítima (sem parcela real correspondente) NÃO é sinalizada', () => {
  const data = [
    exp({ id: 'prov', description: 'Magalu', value: 189.9, competencia: '2026-09', date: '2026-09-15', provisioned: true, installment: { k: 11, total: 10 } }),
    exp({ id: 'other', description: 'Padaria', value: 12.0, competencia: '2026-02', date: '2026-02-03', source: 'manual' }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('cópia exata re-importada (mesmo fp, LOTES diferentes) → quase-certo', () => {
  const data = [
    exp({ id: 'a', description: 'Netflix', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'import:cartao', batchId: 'A', fp: '2026-05-15|44.90|netflix' }),
    exp({ id: 'b', description: 'Netflix', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'import:cartao', batchId: 'B', fp: '2026-05-15|44.90|netflix' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].kind, 'exact-copy');
  assert.equal(cl[0].confidence, 'quase-certo');
  assert.equal(cl[0].removeIds.length, 1);
});

test('mesmo fp no MESMO lote = multiset legítimo (2 compras iguais de verdade) → NÃO funde', () => {
  const data = [
    exp({ id: 'a', description: 'Cafe', value: 9.5, date: '2026-05-15', competencia: '2026-05', source: 'import:cartao', batchId: 'A', fp: '2026-05-15|9.50|cafe' }),
    exp({ id: 'b', description: 'Cafe', value: 9.5, date: '2026-05-15', competencia: '2026-05', source: 'import:cartao', batchId: 'A', fp: '2026-05-15|9.50|cafe' }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('manual × importado (mesma loja/valor/mês, datas diferentes) → talvez, mantém o importado', () => {
  const data = [
    exp({ id: 'man', description: 'iFood', value: 58.4, date: '2026-04-03', competencia: '2026-04', source: 'manual' }),
    exp({ id: 'imp', description: 'iFood', value: 58.4, date: '2026-04-05', competencia: '2026-04', source: 'import:cartao', notes: 'cartão: William' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].kind, 'manual-vs-import');
  assert.equal(cl[0].confidence, 'talvez');
  assert.equal(cl[0].keepId, 'imp');
  assert.deepEqual(cl[0].removeIds, ['man']);
});

test('mesma loja/valor/cartão em dias próximos → near-duplicate talvez', () => {
  const data = [
    exp({ id: 'a', description: 'Drogasil', value: 92.7, date: '2026-05-06', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
    exp({ id: 'b', description: 'Drogasil', value: 92.7, date: '2026-05-08', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].kind, 'near-duplicate');
  assert.equal(cl[0].confidence, 'talvez');
  assert.equal(cl[0].delta.type, 'days');
  assert.equal(cl[0].delta.amount, 2);
});

test('mesma loja/valor porém distantes (> nearDays) → NÃO é near-duplicate', () => {
  const data = [
    exp({ id: 'a', description: 'Drogasil', value: 92.7, date: '2026-05-01', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
    exp({ id: 'b', description: 'Drogasil', value: 92.7, date: '2026-05-20', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('mesma loja, valores diferentes → nunca agrupa (não funde por valor só, nem por loja só)', () => {
  const data = [
    exp({ id: 'a', description: 'Drogasil', value: 92.7, date: '2026-05-06', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
    exp({ id: 'b', description: 'Drogasil', value: 41.0, date: '2026-05-07', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('docs já marcados como removed são ignorados', () => {
  const data = [
    exp({ id: 'real', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-09', installment: { k: 4, total: 10 } }),
    exp({ id: 'prov', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-15', provisioned: true, installment: { k: 4, total: 10 }, removed: true }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('ganhos (income) não entram na varredura', () => {
  const data = [
    { id: 'i1', type: 'income', description: 'Netflix reembolso', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'import:conta', batchId: 'A', fp: 'x' },
    { id: 'i2', type: 'income', description: 'Netflix reembolso', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'import:conta', batchId: 'B', fp: 'x' },
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('removalSummary: por padrão conta só os quase-certo (talvez não vem pré-selecionado)', () => {
  const data = [
    exp({ id: 'real', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-09', installment: { k: 4, total: 10 } }),
    exp({ id: 'prov', description: 'Magalu', value: 189.9, competencia: '2026-02', date: '2026-02-15', provisioned: true, installment: { k: 4, total: 10 } }),
    exp({ id: 'd1', description: 'Drogasil', value: 92.7, date: '2026-05-06', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
    exp({ id: 'd2', description: 'Drogasil', value: 92.7, date: '2026-05-08', competencia: '2026-05', source: 'import:cartao', notes: 'cartão: Flávia' }),
  ];
  const cl = findDuplicateClusters(data);
  const def = removalSummary(cl);                    // só quase-certo (a provisão)
  assert.equal(def.count, 1);
  assert.equal(def.total, 189.9);
  const all = removalSummary(cl, ['prov', 'd2']);    // seleção explícita inclui o talvez
  assert.equal(all.count, 2);
  assert.equal(all.total, 282.6);
});

test('sobra de provisão com valor MUITO diferente (mesma loja/k/Y/mês) → talvez, NÃO pré-marcado', () => {
  const data = [
    exp({ id: 'real', description: 'Magalu', value: 100, competencia: '2026-02', date: '2026-02-09', source: 'import:cartao', installment: { k: 4, total: 10 } }),
    exp({ id: 'prov', description: 'Magalu', value: 250, competencia: '2026-02', date: '2026-02-15', provisioned: true, source: 'import:cartao', installment: { k: 4, total: 10 } }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].kind, 'leftover-provision');
  assert.equal(cl[0].confidence, 'talvez');           // valor diverge além de 2%/R$2 → não funde como certo
  assert.equal(removalSummary(cl).count, 0);          // default (quase-certo) não inclui o talvez
});

test('sobra de provisão escolhe o real de valor MAIS PRÓXIMO (multi-match), não o primeiro', () => {
  const data = [
    exp({ id: 'realFar', description: 'Magalu', value: 900, competencia: '2026-02', date: '2026-02-05', source: 'import:cartao', installment: { k: 4, total: 10 } }),
    exp({ id: 'realNear', description: 'Magalu', value: 189.90, competencia: '2026-02', date: '2026-02-09', source: 'import:cartao', installment: { k: 4, total: 10 } }),
    exp({ id: 'prov', description: 'Magalu', value: 189.90, competencia: '2026-02', date: '2026-02-15', provisioned: true, source: 'import:cartao', installment: { k: 4, total: 10 } }),
  ];
  const cl = findDuplicateClusters(data).filter(c => c.kind === 'leftover-provision');
  assert.equal(cl.length, 1);
  assert.equal(cl[0].keepId, 'realNear');             // casa pelo valor mais próximo, não pela ordem
  assert.equal(cl[0].confidence, 'quase-certo');
});

test('exact-copy: manual + importado (mesmo fp) mantém o IMPORTADO e fica talvez (não pré-marcado)', () => {
  const data = [
    exp({ id: 'man', description: 'Netflix', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'manual' }),
    exp({ id: 'imp', description: 'Netflix', value: 44.9, date: '2026-05-15', competencia: '2026-05', source: 'import:cartao', batchId: 'A' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].keepId, 'imp');                  // mantém o canônico (importado), não o manual
  assert.notEqual(cl[0].confidence, 'quase-certo');
  assert.equal(removalSummary(cl).count, 0);
});

test('exact-copy NÃO pré-seleciona manual + auto (mesmo fp, sem lote de import)', () => {
  const data = [
    exp({ id: 'man', description: 'Academia', value: 120, date: '2026-05-05', competencia: '2026-05', source: 'manual' }),
    exp({ id: 'au', description: 'Academia', value: 120, date: '2026-05-05', competencia: '2026-05', source: 'auto:recurring' }),
  ];
  const cl = findDuplicateClusters(data);
  assert.equal(cl.length, 1);
  assert.notEqual(cl[0].confidence, 'quase-certo');   // sem 2 lotes de import reais → nunca quase-certo
  assert.equal(removalSummary(cl).count, 0);
});

test('duas parcelas REAIS distintas (mesma loja/k/Y/mês, valores diferentes) NÃO fundem', () => {
  const data = [
    exp({ id: 'a', description: 'Magalu', value: 300, competencia: '2026-02', date: '2026-02-05', source: 'import:cartao', installment: { k: 1, total: 3 } }),
    exp({ id: 'b', description: 'Magalu', value: 900, competencia: '2026-02', date: '2026-02-06', source: 'import:cartao', installment: { k: 1, total: 3 } }),
  ];
  assert.equal(findDuplicateClusters(data).length, 0);
});

test('helpers: instOf / cardOf / srcKind', () => {
  assert.deepEqual(instOf({ installment: { k: 4, total: 10 } }), { k: 4, total: 10 });
  assert.deepEqual(instOf({ notes: 'cartão: William · parcela 7/12 · provisão' }), { k: 7, total: 12 });
  assert.equal(instOf({ notes: 'sem parcela' }), null);
  assert.equal(cardOf({ notes: 'cartão: Flávia · parcela 1/3' }), 'flávia');
  assert.equal(srcKind({ source: 'import:cartao' }), 'import');
  assert.equal(srcKind({ source: 'auto:i10prov' }), 'auto');
  assert.equal(srcKind({}), 'manual');
});
