// Núcleo PURO do import — sem DOM, sem Firebase, sem `state`. Extraído de app.js
// (v8 Turno 11) pra ser testável em node (`tests/import-core.test.js`). Aqui
// fica a normalização de descrição, a chave de regra, o parse de data/dinheiro
// e o FINGERPRINT (impFp) que sustenta o dedup do import — o ponto mais bugado
// e o que mais vale ter teste. Mudou algo aqui? Roda `npm test` (node --test).

// Gateways de pagamento colados no nome do estabelecimento ("PG *", "IFD*", …).
export const IMP_GATEWAY = /\b(?:pg|mp|mercpago|mercadopago|pag|pagseguro|pags|paypal|pp|ame|picpay|stone|cielo|rede|getnet|sumup|iz|ifd|ec|tef|pos|dl|asaas)\s*\*+/gi;
// UF (sigla de estado) no fim da descrição: "… curitiba pr" → tira "pr".
export const IMP_UF = /\s\b(?:ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\s*$/;
// Palavras-vazias societárias/genéricas que não ajudam a identificar o lugar.
export const IMP_STOP = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'cia', 'com', 'comercio', 'servicos', 'industria', 'do', 'da', 'de', 'dos', 'das', 'e', 'ind']);

// Normaliza a descrição: minúsculas, sem acento, sem gateway, sem nº de loja,
// só [a-z0-9] e espaço, sem UF no fim. Base do matching de recorrência/regra.
export function impNormalize(raw) {
  let s = ' ' + String(raw || '').toLowerCase() + ' ';
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');  // tira acento: café→cafe
  s = s.replace(IMP_GATEWAY, ' ');                          // "PG *", "MP *", "PAYPAL *", "IFD*"
  s = s.replace(/[*#]+/g, ' ');
  s = s.replace(/\b\d{2,}\b/g, ' ');                        // nº de loja/documento
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(IMP_UF, ' ').trim();
  return s;
}

// Tokens "úteis" da descrição (≥2 chars, fora das stop-words).
export function impTokens(raw) {
  return impNormalize(raw).split(' ').filter(w => w.length >= 2 && !IMP_STOP.has(w));
}

// Chave estável de "estabelecimento" pra memória de regras (categoria/dono).
export function impRuleKey(desc) { return impNormalize(desc).replace(/\s+/g, '').slice(0, 24); }

// "DD/MM" ou "DD/MM/AAAA" → ISO "YYYY-MM-DD". baseYear = ano da competência
// (cartão, quando a data não traz o ano). Sem ano e sem base: infere o ano
// assumindo que mês muito à frente é do ano passado (virada de ano na fatura).
export function impToISO(dmy, baseYear) {
  const p = String(dmy || '').split('/');
  const d = +p[0], mo = +p[1];
  if (!d || !mo) return new Date().toISOString().split('T')[0];
  let y;
  if (p[2]) { y = +p[2]; if (y < 100) y += 2000; }     // ano explícito (CSV traz DD/MM/AAAA)
  else if (baseYear) { y = +baseYear; }                // competência da fatura (cartão)
  else { const now = new Date(); y = now.getFullYear(); if (mo > now.getMonth() + 2) y -= 1; }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// FINGERPRINT de um lançamento: data + valor(2 casas) + prefixo da descrição.
// É a base do dedup do import (e do auto-sync de proventos). Mesmo lançamento →
// mesmo fp → não duplica. NÃO mudar o formato sem migrar/conferir (o `fpBase`
// gravado nos docs depende disso).
export function impFp(date, value, desc) {
  return date + '|' + (Math.round((+value) * 100) / 100).toFixed(2) + '|' + (desc || '').slice(0, 16).toLowerCase().replace(/\s+/g, '');
}

// "R$ 1.234,56" / "1234,56 C" → number. Tira tudo que não é dígito/.,- ,
// remove separador de milhar e troca vírgula decimal por ponto.
export function parseBRMoney(raw) {
  const s = String(raw || '').replace(/[^\d.,-]/g, '');   // tira R$, espaços, aspas, sufixo C/D, etc.
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

// Casa um lançamento de PARCELA real com uma PROVISÃO já existente do MESMO parcelamento,
// pra não duplicar quando o valor muda por centavos (estimado ≠ cobrado) ou a data-âncora
// difere entre os imports. Match exige: mesmo estabelecimento (descKey) + mesma parcela k/Y
// + mesmo mês (comp), e valor só dentro de uma tolerância pequena (default 2%) — assim
// centavos casam mas compras de valores realmente diferentes NÃO se fundem. Puro/testável.
// real/p: { descKey, k, total, comp, value } (+ p.id). Retorna a provisão casada ou null.
export function matchInstallmentProvision(real, provs, tol = 0.02) {
  if (!real || !real.descKey || !Array.isArray(provs)) return null;
  for (const p of provs) {
    if (!p || p.descKey !== real.descKey) continue;
    if (+p.k !== +real.k || +p.total !== +real.total) continue;
    if (p.comp !== real.comp) continue;
    const b = +p.value || 0;
    if (b > 0 && Math.abs((+real.value || 0) - b) / b > tol) continue;
    return p;
  }
  return null;
}
