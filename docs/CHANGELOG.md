# Changelog

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/).
Datas em `YYYY-MM-DD`.

## [Unreleased]

### Changed
- Repositório reorganizado: `public/` (app), `worker/` (CF Worker),
  `tools/` (one-shots), `docs/` (documentação)
- `index.html` e `manifest.json` com paths relativos à nova estrutura
- Worker ganha `wrangler.toml` pra `wrangler deploy` virar one-liner

### Added
- `CLAUDE.md` — contexto persistente do projeto
- `LICENSE` — all rights reserved
- `docs/ARCHITECTURE.md`, `docs/FIRESTORE-SCHEMA.md`,
  `docs/DEPLOY.md`, `docs/DEPLOY-WORKER.md`
- `.gitignore`, `.editorconfig`, `.gitattributes`
- `public/.nojekyll`

## [v8] — 2026 (em andamento)

Iteração atual do design "Linear meets Apple". Turnos incrementais:

- **Turno 2** — Keyframes globais (breathing, pulse, drift)
- **Turno 3** — Inputs numéricos formatados ("R$ 24.000", "10,0%/yr"),
  parse via helper compartilhado, fire `on change` (blur) em vez de
  `on input` pra não quebrar digitação
- **Turno 4** — Compact values (64,2K / 1,34M), YoY sanitizado
  (>1000% → —), hatched area + classed paths, one-shot trace do path
- **Turno 6** — Bar chart range toggle (1Y / 5Y / All) com sync entre
  os dois cards
- **Turno 7** — Card da Louise (wallet F) + piggyback sync (sync do W
  dispara sync da F)
- **Turno 8** — FX: holdings em USD + cotação via worker, USD entra no
  hero total de patrimônio
- **Turno 9** — Bar chart com conector pontilhado entre topos e pill
  opaca no meio
- **Liquid glass** — tokens `--glass-*`, `@property --liquid-angle`,
  `.liquid-border::before` animado

## [v7]

Fundação. Paleta `#29262B` / `#3C3541` / `#AC5FDB` / `#E3A2EE`.
Tipografia Inter (UI) + Geist Mono (números). Filosofia: clean, denso,
profissional.
