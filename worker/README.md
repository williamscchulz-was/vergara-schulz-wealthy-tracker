# Ledger I10 Proxy — Cloudflare Worker

Stateless CORS proxy que fica na frente da API interna (não-oficial) do
Investidor 10. Usado pelo app Ledger pra sincronizar carteiras públicas
sem esbarrar no CORS.

## Endpoints

Todos `GET`. `:walletId` precisa casar `^\d{1,12}$`.

| Rota | Uso |
|---|---|
| `/i10/metrics/:walletId` | PL, aplicado, variação, profit_twr |
| `/i10/earnings/:walletId?year=YYYY` | soma de proventos no ano |
| `/i10/actives/:walletId` | lista detalhada de ativos |
| `/i10/barchart/:walletId` | histórico mensal (12m) |
| `/i10/all/:walletId?year=YYYY` | **agregado — o que o app usa** |

## Segurança

- Só aceita `GET` com path em whitelist (`/i10/...`)
- `walletId` validado por regex
- Nenhuma auth / cookie / token — só ID público
- Cache HTTP de 5 min (`CACHE_TTL = 300`) tanto no response header
  quanto no fetch upstream (via `cf: { cacheTtl, cacheEverything }`)
- Free tier do CF Workers (100k req/dia) sobra com folga

## Deploy

```bash
cd worker
npm install -g wrangler   # uma vez
wrangler login            # uma vez
wrangler deploy
```

Ou cole `src/worker.js` no dashboard do Cloudflare Workers e publique
manualmente. Ao final você tem uma URL tipo:

```
https://ledger-i10-proxy.<SEU-SUB>.workers.dev
```

Essa URL vai no app, em **Investimentos → ⚙️ → Worker URL**.

## Dev local

```bash
cd worker
wrangler dev
```

Depois abre `http://localhost:8787/i10/all/1986068?year=2026`.

## Aviso

A API interna do I10 foi mapeada por engenharia reversa e pode mudar sem
aviso. Se quebrar, o app tem fallback manual (botão ✏️) que continua
salvando direto no Firestore.
