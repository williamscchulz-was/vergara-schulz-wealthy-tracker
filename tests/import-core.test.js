// Testes do núcleo puro do import. Rodar: `npm test` (ou `node --test`).
// SEM dependências externas — só node:test + node:assert (built-in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  impFp, impNormalize, impTokens, impRuleKey, impToISO, parseBRMoney, matchInstallmentProvision,
} from '../public/js/import-core.js';

test('matchInstallmentProvision — casa parcela real↔provisão por estab+k/Y+mês, tolera centavos', () => {
  const provs = [
    { id: 'a', descKey: 'latamair', k: 3, total: 4, comp: '2026-08', value: 1497.02 },
    { id: 'b', descKey: 'jim', k: 4, total: 6, comp: '2026-08', value: 891.66 },
  ];
  assert.equal(matchInstallmentProvision({ descKey: 'latamair', k: 3, total: 4, comp: '2026-08', value: 1497.03 }, provs).id, 'a'); // centavos casam
  assert.equal(matchInstallmentProvision({ descKey: 'jim', k: 4, total: 6, comp: '2026-08', value: 891.70 }, provs).id, 'b');
  assert.equal(matchInstallmentProvision({ descKey: 'latamair', k: 3, total: 4, comp: '2026-09', value: 1497.02 }, provs), null); // mês diferente
  assert.equal(matchInstallmentProvision({ descKey: 'latamair', k: 2, total: 4, comp: '2026-08', value: 1497.02 }, provs), null); // parcela diferente
  assert.equal(matchInstallmentProvision({ descKey: 'latamair', k: 3, total: 4, comp: '2026-08', value: 1800 }, provs), null); // valor >2% → não funde
  // compras DISTINTAS no mesmo estab/parcela/mês, valor dentro de 2% mas > R$2 → NÃO funde (não some uma)
  const distintas = [{ id: 'x', descKey: 'nikestore', k: 1, total: 3, comp: '2026-01', value: 300 }];
  assert.equal(matchInstallmentProvision({ descKey: 'nikestore', k: 1, total: 3, comp: '2026-01', value: 305 }, distintas), null); // R$5 (1,67%) → compra diferente
  assert.equal(matchInstallmentProvision({ descKey: 'nikestore', k: 1, total: 3, comp: '2026-01', value: 300.5 }, distintas).id, 'x'); // R$0,50 → mesma compra (centavos)
  // provisão sem valor (b<=0) nunca casa
  assert.equal(matchInstallmentProvision({ descKey: 'z', k: 1, total: 2, comp: '2026-01', value: 100 }, [{ id: 'q', descKey: 'z', k: 1, total: 2, comp: '2026-01', value: 0 }]), null);
  // entre dois candidatos, casa o de valor MAIS PRÓXIMO
  const multi = [{ id: 'p1', descKey: 'amzn', k: 2, total: 5, comp: '2026-03', value: 100 }, { id: 'p2', descKey: 'amzn', k: 2, total: 5, comp: '2026-03', value: 101 }];
  assert.equal(matchInstallmentProvision({ descKey: 'amzn', k: 2, total: 5, comp: '2026-03', value: 100.9 }, multi).id, 'p2');
});

test('impFp — determinístico + formato data|valor(2 casas)|desc', () => {
  assert.equal(impFp('2026-06-01', 10, 'X'), impFp('2026-06-01', 10, 'X'));
  assert.match(impFp('2026-06-01', 10, 'Mercado'), /^2026-06-01\|10\.00\|/);
  assert.equal(impFp('2026-06-01', 10.5, 'a'), '2026-06-01|10.50|a');
  assert.equal(impFp('2026-06-01', 10.999, 'a'), '2026-06-01|11.00|a'); // arredonda
});

test('impFp — desc cortada em 16, minúscula, sem espaço', () => {
  assert.equal(impFp('d', 1, 'AB CD EF'), 'd|1.00|abcdef');
  // mesmo prefixo de 16 chars → mesmo fp (o sufixo é ignorado)
  assert.equal(impFp('d', 1, 'ABCDEFGHIJKLMNOP-AAA'), impFp('d', 1, 'ABCDEFGHIJKLMNOP-BBB'));
});

test('impNormalize — acento, gateway, dígitos, símbolos, UF no fim', () => {
  assert.equal(impNormalize('Café'), 'cafe');
  assert.equal(impNormalize('PG *RESTAURANTE'), 'restaurante');
  assert.equal(impNormalize('LOJA 12345'), 'loja');
  assert.equal(impNormalize('ABC#123*'), 'abc');
  assert.equal(impNormalize('Padaria Curitiba PR'), 'padaria curitiba');
});

test('impTokens — remove stopwords e tokens curtos', () => {
  assert.deepEqual(impTokens('Restaurante do Joao LTDA'), ['restaurante', 'joao']);
});

test('impRuleKey — normaliza, sem espaço, no máx 24 chars', () => {
  assert.equal(impRuleKey('Restaurante do Joao'), 'restaurantedojoao');
  assert.ok(impRuleKey('a'.repeat(50)).length <= 24);
  // desc só com número/símbolo → normaliza pra VAZIO. doImport tem que pular
  // (chave de campo vazia quebra o setDoc das regras no Firestore). Bug v8.13.
  assert.equal(impRuleKey('—'), '');
  assert.equal(impRuleKey('1234'), '');
  assert.equal(impRuleKey('*** ###'), '');
});

test('impToISO — ano explícito, 2 dígitos, baseYear, fallback', () => {
  assert.equal(impToISO('01/06/2026'), '2026-06-01');
  assert.equal(impToISO('1/6/26'), '2026-06-01');     // 2 dígitos → +2000 + padding
  assert.equal(impToISO('15/03', 2025), '2025-03-15'); // baseYear (competência)
  assert.match(impToISO(''), /^\d{4}-\d{2}-\d{2}$/);   // sem data → hoje (só checa formato)
});

test('parseBRMoney — formatos BR (R$, milhar, decimal, sufixo, negativo)', () => {
  assert.equal(parseBRMoney('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRMoney('1234,56 C'), 1234.56);
  assert.equal(parseBRMoney('-50,00'), -50);
  assert.equal(parseBRMoney('1.000.000,00'), 1000000);
  assert.equal(parseBRMoney(''), 0);
});

// O coração do import: dedup multiset por fingerprint. Reproduz a MESMA lógica
// de doImport/autoSyncProventos (que usam impFp) e prova idempotência — o que
// impede o auto-sync de duplicar a cada sync. (O bug que mais machucou.)
test('dedup multiset por fp é idempotente (re-importar não duplica)', () => {
  const incoming = [
    { date: '2026-06-01', value: 100, desc: 'TAEE11 Dividendo' },
    { date: '2026-06-01', value: 100, desc: 'TAEE11 Dividendo' }, // dup legítimo (2 pagamentos iguais)
    { date: '2026-06-02', value: 50, desc: 'BBAS3 JCP' },
  ];
  const dedup = (items, existing) => {
    const strip = (s) => String(s || '').replace(/#\d+$/, '');
    const existCount = {};
    for (const e of existing) { const b = e.fpBase || strip(e.fp); existCount[b] = (existCount[b] || 0) + 1; }
    const used = {}, add = [];
    for (const it of items) {
      const base = impFp(it.date, it.value, it.desc);
      const idx = used[base] || 0; used[base] = idx + 1;
      if (idx < (existCount[base] || 0)) continue;
      add.push({ fp: idx === 0 ? base : base + '#' + idx, fpBase: base });
    }
    return add;
  };
  const first = dedup(incoming, []);
  assert.equal(first.length, 3, '1ª vez adiciona tudo (inclui o dup legítimo)');
  const second = dedup(incoming, first);
  assert.equal(second.length, 0, '2ª vez não adiciona nada');
  const third = dedup(incoming, [...first, ...second]);
  assert.equal(third.length, 0, '3ª vez também não');
});
