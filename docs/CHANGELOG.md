# Changelog

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/).
Datas em `YYYY-MM-DD`.

## [Unreleased]

### Changed
- Repositório reorganizado: `public/` (app), `worker/` (CF Worker),
  `tools/` (one-shots), `docs/` (documentação)
- `index.html` e `manifest.json` com paths relativos à nova estrutura
- Worker ganha `wrangler.toml` pra `wrangler deploy` virar one-liner
- GitHub Pages serve via Actions workflow (`/public` não é opção nativa)

### Removed
- `goal-projection.js` (código morto — não era importado em lugar
  nenhum; o card `#goalCardV2` é gerenciado pelo `app.js`)

### Expenses v2 (Fase B)
- **i18n de verdade**: 47+ chaves `exp.*` em PT/EN, `data-i18n` em
  todo HTML estático, `t()` nos renderers, `applyI18n` re-renderiza
  o módulo de despesas quando a lang muda
- **Máscara BRL** no input de valor: `parseBRLInput`/`fmtBRLInput`
  tolerantes a múltiplos formatos, blur formata, Enter salva
- **Confirm modal custom** (`#confirmModal` + `openConfirmModal`)
  substitui `confirm()` nativo; helper reusável pra próximas ações
  destrutivas
- **Orçamento por categoria** — novo doc `config/budgets.categories`,
  integrado no breakdown (barras relativas ao limite, estado
  `over-budget` em vermelho, footer agregado "gasto / orçamento")
  e editor dedicado via `#budgetModal`

### Expenses v3 (Fase C — Analytics)
- **Sparkline diário** (`#expDailyChart`): acumulado do mês vs linha
  de ritmo esperado (dotted), faixas de fim de semana, marcador do
  dia, footer com delta em BRL acima/abaixo do pace
- **Tendência 12 meses** (`#expTrendChart`): barras empilhadas por
  categoria com legenda auto-gerada; mês corrente destacado
- **Top descrições recorrentes** (`#expRecList`): groupBy YTD, ranking
  por gasto total, filtra por count ≥ 2
- **Over-budget hero badge**: pill vermelho animado substitui o sub
  line quando alguma categoria estoura o limite mensal
- 17 novas chaves `exp.daily.*` / `exp.trend.*` / `exp.rec.*` /
  `exp.hero.over` em PT + EN

### Expenses v3.1 (polish)
- Hero over-budget badge agora coexiste com a sub-line "N despesas ·
  média R$ X" em vez de substituí-la (novo wrapper `#expHeroAlert`)
- Pluralização da mensagem over-budget (singular vs plural nas duas
  línguas)
- **Busca live na tabela** (`#expSearch`): filtra descrição +
  categoria + notas em tempo real, case-insensitive; empty state com
  a query ecoada
- **Export CSV** (`#btnExportCsv`): baixa o mês atual como CSV UTF-8
  com BOM (Excel friendly), separador `;` (padrão BR), aspas duplas
  escapadas; nome do arquivo é `despesas-MM-YYYY.csv` / `expenses-MM-YYYY.csv`

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
