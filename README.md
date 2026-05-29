# Ledger — Wealthy Tracker

PWA pessoal de finanças e investimentos do casal, com sincronização
automática da carteira pública do [Investidor 10](https://investidor10.com.br/)
via Cloudflare Worker.

> ⚠️ **Proprietário.** Código pessoal, uso restrito aos titulares.
> Ver [LICENSE](LICENSE).

---

## Estrutura

```
├── public/                 → app estático (publicado no GitHub Pages)
│   ├── index.html          → shell + todo o CSS (tokens v7/v8)
│   ├── js/app.js           → núcleo da aplicação
│   ├── manifest.json       → PWA
│   ├── assets/icons/       → favicons + ícones PWA
│   └── .nojekyll
├── worker/                 → Cloudflare Worker (CORS proxy pro I10)
│   ├── src/worker.js
│   ├── wrangler.toml
│   ├── package.json
│   └── README.md
├── tools/                  → scripts one-shot, fora de produção
│   ├── seed*.html · fix-historico.html · import-historico.html
│   ├── restore-equity.html · brand.html
│   └── README.md
├── docs/                   → documentação
│   ├── ARCHITECTURE.md · CHANGELOG.md
│   ├── DEPLOY.md · DEPLOY-WORKER.md
│   └── FIRESTORE-SCHEMA.md · FIRESTORE-RULES.md
├── .github/workflows/      → deploy do GitHub Pages (pages.yml)
├── firebase.json · .firebaserc · firestore.rules → config Firestore
├── CLAUDE.md               → contexto persistente pras sessões de IA
├── README.md · LICENSE
└── .editorconfig · .gitattributes · .gitignore
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
| [docs/FIRESTORE-RULES.md](docs/FIRESTORE-RULES.md) | Setup e deploy das security rules |
| [docs/DEPLOY.md](docs/DEPLOY.md) | GitHub Pages via GitHub Actions |
| [docs/DEPLOY-WORKER.md](docs/DEPLOY-WORKER.md) | Publicar o CF Worker |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Histórico de mudanças |
| [worker/README.md](worker/README.md) | Endpoints e segurança do proxy |
| [tools/README.md](tools/README.md) | Scripts one-shot e o que cada um faz |

## Dev local

```bash
# App
cd public && python -m http.server 8000
# abre http://localhost:8000

# Worker
cd worker && npm install && npm run dev
# abre http://localhost:8787/i10/all/2814459?year=2026
```

## Deploy

- **App**: push no `main` → workflow do GitHub Actions publica `public/`
  no GitHub Pages automaticamente (ver `.github/workflows/pages.yml`)
- **Worker**: `cd worker && npm run deploy` (ou colar `src/worker.js` no
  dashboard do Cloudflare — ver `docs/DEPLOY-WORKER.md`)

Ver [docs/DEPLOY.md](docs/DEPLOY.md) e [docs/DEPLOY-WORKER.md](docs/DEPLOY-WORKER.md).

## Aviso

A API interna do Investidor 10 é mapeada por engenharia reversa. Pode
mudar ou quebrar sem aviso. O app tem fallback manual (botão ✏️ grava
direto no Firestore) que continua funcionando se o sync cair.
