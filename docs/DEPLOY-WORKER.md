# Deploy — Cloudflare Worker

Passo a passo pra publicar o proxy que fica na frente do Investidor 10.

## Opção A — Wrangler CLI (recomendado)

```bash
# 1. Entrar na pasta do worker e instalar deps (uma vez)
cd worker
npm install

# 2. Login no Cloudflare (uma vez, abre o browser)
npx wrangler login

# 3. Deploy
npm run deploy
```

Outros scripts úteis: `npm run dev` (server local) e `npm run tail` (logs em produção).

Saída esperada:

```
Published ledger-i10-proxy
  https://ledger-i10-proxy.<SEU-SUB>.workers.dev
```

Copia essa URL.

## Opção B — Dashboard da Cloudflare

1. Entrar em https://dash.cloudflare.com → Workers & Pages → Create
2. Nome: `ledger-i10-proxy`
3. Editar → colar o conteúdo de `worker/src/worker.js`
4. Save and Deploy
5. Copiar a URL

## Configurar no app

1. Abrir o Ledger
2. **Investimentos → ⚙️**
3. Colar a URL do worker
4. Wallet ID: `1986068` (ou outro)
5. Salvar → dispara sync automático

## Smoke test

```bash
curl 'https://ledger-i10-proxy.<SEU-SUB>.workers.dev/i10/all/1986068?year=2026'
```

Esperado: JSON com `metrics`, `earnings`, `actives`, `fetchedAt`.

## Dev local

```bash
cd worker
wrangler dev
# abre http://localhost:8787/i10/all/1986068?year=2026
```

## Free tier

- 100k requests/dia
- Com o cache de 5 min, o uso real fica em dezenas de requests/dia.
  Sobra com folga.

## Quando quebrar

A API interna do I10 é mapeada por engenharia reversa — não é oficial.
Se quebrar:

1. Botão ✏️ nos cards continua funcionando (edição manual → Firestore direto)
2. Ver `worker/src/worker.js` pra ajustar paths upstream
3. Validar com `wrangler dev` antes de redeploy
