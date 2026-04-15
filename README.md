# Ledger — Wealthy Tracker

PWA pessoal de finanças e investimentos do casal, com sincronização
automática da carteira pública do [Investidor 10](https://investidor10.com.br/)
via Cloudflare Worker.

> ⚠️ **Proprietário.** Código pessoal, uso restrito aos titulares.
> Ver [LICENSE](LICENSE).

---

## Estrutura

```
├── public/              → app estático (o que o GitHub Pages serve)
│   ├── index.html
│   ├── manifest.json
│   ├── js/              → app.js, goal-projection.js
│   └── assets/icons/    → favicons + ícones PWA
├── worker/              → Cloudflare Worker (CORS proxy pro I10)
│   ├── src/worker.js
│   ├── wrangler.toml
│   └── README.md
├── tools/               → scripts one-shot (seed, fix, brand preview)
│   └── README.md
├── docs/                → arquitetura, schema, deploy, changelog
├── .github/             → templates de PR/issue
├── CLAUDE.md            → contexto pra sessões de Claude Code
└── LICENSE
```

## Stack

- **Frontend**: Vanilla JS (ES modules), HTML, CSS — sem build step
- **Auth + DB**: Firebase Auth (Google) + Firestore
- **Proxy**: Cloudflare Worker (`worker/`)
- **Hosting**: GitHub Pages (`public/`)

## Docs

| Doc | O que tem |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrama + fluxos de dados |
| [docs/FIRESTORE-SCHEMA.md](docs/FIRESTORE-SCHEMA.md) | Coleções e configs sob `household/main/*` |
| [docs/DEPLOY.md](docs/DEPLOY.md) | GitHub Pages (source: `main /public`) |
| [docs/DEPLOY-WORKER.md](docs/DEPLOY-WORKER.md) | Publicar o CF Worker |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Histórico v7 / v8 Turnos |
| [worker/README.md](worker/README.md) | Endpoints e segurança do proxy |
| [tools/README.md](tools/README.md) | Scripts one-shot e o que cada um faz |

## Dev local

```bash
# App
cd public && python -m http.server 8000
# abre http://localhost:8000

# Worker
cd worker && wrangler dev
# abre http://localhost:8787/i10/all/1986068?year=2026
```

## Deploy

- **App**: push no `main` → GitHub Pages rebuilda (source `main /public`)
- **Worker**: `cd worker && wrangler deploy`

Ver [docs/DEPLOY.md](docs/DEPLOY.md) e [docs/DEPLOY-WORKER.md](docs/DEPLOY-WORKER.md).

## Aviso

A API interna do Investidor 10 é mapeada por engenharia reversa. Pode
mudar ou quebrar sem aviso. O app tem fallback manual (botão ✏️ grava
direto no Firestore) que continua funcionando se o sync cair.
