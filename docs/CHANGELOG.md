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

### Worker: fan-out actives por tipo + equity histórico do barchart

Dois bugs num único redeploy do worker:

**Bug A** — só puxava Ações. O endpoint `/summary/actives/<id>/Ticker`
filtra por tipo. Antes, hardcoded em `Ticker`. Agora a função nova
`fetchAllActives()` chama 8 tipos em paralelo (`Ticker`,
`TesouroDireto`, `RendaFixa`, `Fii`, `Etf`, `Bdr`, `FundoInvestimento`,
`Criptomoeda`), tagueia cada item com `__assetClass` e devolve a
união. Falha individual = lista vazia (não derruba os outros).

**Bug B** — equity anual hardcoded/null. O `/i10/yearly` agora puxa um
barchart longo (120 meses, fallback 60) e usa o `sum_equity` do último
mês de cada ano como "patrimônio de fim de ano". Sem aproximação,
direto do I10. Divs continua via `/earnings/total-period`.

App side:
- `syncFromI10` deixa de hardcodar `category: 'Ações'`. Lê o
  `__assetClass` que o worker injeta e mapeia pra label PT-BR via
  `I10_TYPE_TO_CAT`. Fallback: `inferCategory(ticker)` (heurística por
  ticker que já existia).
- Resultado: o card "My Portfolio" deve passar a mostrar tantas
  categorias quantas o I10 reconhece — Ações, Tesouro Direto, Renda
  Fixa, ETFs, etc.

`tools/restore-equity.html` agora é fallback redundante — depois do
redeploy, clicar "I10" no card "Histórico anual" preenche equity real
de cada ano direto do barchart.

### Fix: importYearlyData clobbering equity with null
Quando o user clicou "I10" no card "Histórico anual", todos os
patrimônios anuais zeraram. Causa: o worker (`/i10/yearly`) retorna
`equity: null` (nem o I10 expõe equity por ano), e o app fazia
`setDoc(..., { merge: true })` com `equity: null` no payload — merge
de null sobrescreve.

- `importYearlyData` agora monta o payload condicionalmente: campos
  vazios (equity/applied/flow == null) **não entram no setDoc**, então
  o valor anterior em Firestore é preservado. `divs` continua sendo
  sempre escrito (sempre tem valor, pode ser 0).
- Novo `tools/restore-equity.html` pra repor os 6 anos perdidos
  (2020-2025) com os valores arredondados do snapshot anterior.
  Merge-safe — só toca o campo `equity`.

### Worker: endpoint /i10/yearly (rebackfill anual)
O botão "I10" do card "Histórico anual" chamava `/i10/yearly/:walletId`
mas o worker nunca expôs essa rota — vinha 404. App não conseguia
reimportar proventos ano a ano e o total all-time ficava preso no que
foi seeded manualmente no passado.

- Nova branch `if (kind === 'yearly')` no worker, com loop ano a ano
  chamando `/earnings/total-period` (endpoint que já funcionava).
  Default: 2018 até ano atual. Override via `?start=YYYY`.
- Resposta: `{ years: [{ year, divs, equity, applied, flow, error? }], walletId }`.
  Equity/applied/flow ficam null porque não temos endpoint nativo do
  I10 que devolva esses campos por ano (só o `divs` é recuperável).
- App: `importYearlyData` já estava pronto e tolerante a null nesses
  campos — só preenche `divs` mesmo quando importa do I10.

Requer redeploy do worker via dashboard.

### Worker: endpoint /fx/rate (cotação USD→BRL)
O app chamava `${workerUrl}/fx/rate` há tempos pra atualizar a taxa do
USD mas o worker nunca expôs essa rota — vinha 404 em toda sync. Card
de FX/USD ficava com a última taxa salva manualmente.

- `worker/src/worker.js`: nova função `fetchUSDBRL()` consome
  `https://economia.awesomeapi.com.br/last/USD-BRL` (Brasileira, free,
  sem auth, retorno simples). Pega `USDBRL.bid` como taxa, propaga
  `create_date` como timestamp.
- Roteamento: novo branch `/fx/rate` antes do check de `i10` no `handle`
- Cache: 15min via `cf.cacheTtl` no fetch upstream (FX_CACHE_TTL=900s) +
  `Cache-Control: public, max-age=900` na resposta
- App: `fetchFXRate()` já estava pronto pra parsear `{ rateUSD,
  rateSource, rateUpdatedAt }` e gravar em `config/fx`

**Requer redeploy do worker** via dashboard (mesma cerimônia da última
vez, copy/paste do arquivo no editor do Cloudflare).

### Auto-sync do I10 (sem scheduler externo)
`maybeAutoSync()` em `public/js/app.js` dispara `syncFromI10()` em
background quando a última sync foi há ≥12h. Três triggers:

1. 3s após `onAuthStateChanged` resolver com usuário logado
2. `visibilitychange → visible` (usuário voltou pra aba)
3. `setInterval` de 1h pra sessões deixadas abertas o dia todo

Preconditions: `state.user` presente, `state.i10Syncing` falso,
`workerUrl` + `walletId` configurados, **e ao menos uma sync prévia**
(pra não disparar no primeiro setup — o user precisa ver a primeira
sync funcionar manualmente, dá confiança).

Debounce de 60s no `maybeAutoSync` evita spam quando vários eventos
disparam juntos. Como os 2 usuários (W + F) compartilham
`config/i10`, quem fizer a checagem primeiro dispara a sync e os
dois recebem via `onSnapshot`.

Resultado prático: ~2 syncs/dia se ambos abrem o app de manhã e à
noite, 1/dia se só abrir 1x. Zero infraestrutura nova (worker, cron,
GitHub Actions, etc.) — usa apenas o cliente já autenticado.

### William's I10 walletId migrated: 1986068 → 2814459
William trocou de carteira principal no Investidor 10. Atualizado em
todos os docs, placeholders, exemplos e comentários do código. O dado
em produção (`config/i10sync.walletId` no Firestore) precisa ser
trocado manualmente via o modal ⚙️ na aba Investments — não tenho como
escrever no Firestore daqui.

Toques:
- CLAUDE.md §5: walletId novo + nota da migração
- docs/DEPLOY-WORKER.md: smoke test e exemplo de `wrangler dev`
- README.md, worker/README.md: comandos de exemplo
- public/index.html: placeholder do input do modal de config
- worker/src/worker.js: comentário do parse de path

### Rentabilidade mês a mês
Novo card `#monthlyReturnsCard` na aba Investimentos, entre "patrimônio
por ano" e "aportes mensais". Responde a pergunta "quais meses foram
bons?" sem abrir nova aba.

- `worker/src/worker.js` — `/i10/all` agora agrega também o
  `/summary/barchart/{walletId}/12/all` do I10 (com `.catch(() => null)`
  para que falha do barchart não derrube o resto da resposta). Essa
  mudança é **opcional** — o redeploy economiza uma HTTP round-trip,
  mas o app funciona hoje sem ele (ver próximo item).
- `syncFromI10()` agora faz fetch paralelo de `/i10/all` + `/i10/barchart`
  (o segundo endpoint já existe no worker em produção desde o início,
  só nunca foi consumido). Se o `/all` trouxer `barchart` inline
  (worker redeployado), usa direto; senão, cai no resultado do fetch
  paralelo. Zero exigência de deploy pra feature funcionar.
- `parseI10Barchart(raw)` em `public/js/app.js` normaliza a resposta
  upstream (shape pode variar entre versões do I10) para um array
  `[{ year, month, equity }]` ordenado. Suporta 4 shapes comuns +
  fallback gracioso para `[]`.
- `state.i10.monthly` persiste em Firestore (`config/i10.monthly`),
  propaga pelos dois usuários via `onSnapshot`.
- `computeMonthlyReturns(monthly, contribs, yearly)` calcula retorno
  por mês usando **modified Dietz**: `(end - start - netCashFlow) /
  (start + netCashFlow/2)`, onde `netCashFlow = contrib - dividends`
  (dividendos reduzem o cashflow externo porque fazem parte do retorno,
  não são retirada). Proventos anuais são distribuídos ratably em 1/12
  por mês (melhor aproximação possível sem dado mensal do I10).
- `renderMonthlyReturns()` desenha SVG inline de 12 barras (verde/
  vermelho), labels de valor acima/abaixo de cada barra, baseline
  tracejada no zero, labels de mês em geist mono. Badge no card-head
  mostra "média +X% · últimos N meses" em verde ou vermelho.
  `<details>` expande tabela com 7 colunas: Mês, PL início, PL fim,
  Aporte, Proventos, Retorno R$, Retorno %. Tudo em Geist Mono com
  tabular-nums.
- 14 novas chaves i18n (`card.monthlyreturn`, `sub.monthlyreturn`,
  `mr.see.table`, `mr.th.*`, `mr.empty`, `mr.avg`) em PT + EN.

QA: parser passou em 5/6 shapes (incluindo null/garbage); Dietz bate
matematicamente (+10% simples, +9.09% com aporte, +2.01% com dividendo
no denominador); render produz 11 barras para 12 meses de histórico.

### Iconografia: emoji → SVG (cross-platform consistency)
- `const ICONS` registrado em `public/js/app.js` com 15 SVGs Lucide-style
  (home, utensils, car, heartPulse, gamepad, book, repeat, creditCard,
  shoppingBag, package, briefcase, wrench, pieChart, trendingUp, tag,
  gift + utility: check, alertTri, heart)
- Helper `_svg(paths)` gera `<svg class="icn" viewBox="0 0 24 24"
  stroke="currentColor" ...>` consistente
- `CATEGORIES.icon` e `INCOME_SOURCES.icon` agora referenciam
  `ICONS.<key>` — todos os renderers existentes continuam usando
  `${meta.icon}` sem mudança, agora produzindo SVG em vez de emoji
- `<option>` do modal de categoria e fonte: removido prefixo emoji
  (select HTML não renderiza SVG inline de qualquer forma)
- Chip `♥` da Louise → SVG heart
- `⚠` do hero over-budget → SVG alertTri via `ICONS.alertTri`
- Toasts: removido prefixo `✓` de todas as 10+ mensagens de sucesso
  (a cor verde da pill já sinaliza sucesso)
- CSS: nova classe base `.icn` + `.exp-cat-icon .icn` / `.exp-recent-icon
  .icn` / `.exp-cat-pill-icon .icn` / `.budget-row-icon .icn` /
  `.exp-hero-overbudget .icn` com tamanhos contextualizados; containers
  ganham `color: var(--cat-color)` pra o `currentColor` do SVG herdar
- Regra nova em CLAUDE.md §11: emoji unicode é banido da UI (rendering
  varia entre sistemas); §10 documenta o padrão do registro `ICONS`

### Expenses v4 — Movimentação (Fase D minimalista, sem nova aba)
Absorvido de um sistema de referência que o William usa, filtrando
apenas o que move ponteiro. Nada de aba Endividamento, Cartões ou
Streak — tudo dentro do módulo Expenses existente.

- **type: income | expense** em cada entry. Toggle no topo do
  `#expenseModal` (Saída | Ganho), swap entre `CATEGORIES` e
  `INCOME_SOURCES` (7 fontes: salário, freelance, distribuição,
  dividendos, venda, presente, outros). Novo botão `+ Ganho` no
  header ao lado do `+ Nova despesa`. Legacy entries sem `type`
  continuam sendo tratadas como expense via isExpense/isIncome guards.
- **Hero vira Saldo do mês**: amount absoluto, verde se positivo,
  vermelho se negativo, prefixo `−` no R$ quando negativo. Sub inline
  `↑ R$X entraram · ↓ R$Y saíram`. Radial glow e live-dot no hero
  acompanham a cor do saldo (gain/loss).
- **owner**: cada entry ganha William/Flávia/Conjunto via picker
  segmentado com tints distintos (blue/pink/purple). Default do
  picker em nova entrada é inferido do user autenticado. Chip
  discreto W/F/W+F aparece ao lado da descrição no extrato (recent
  list + tabela completa) com o tom correspondente.
- **Busca** agora reconhece nomes de pessoa (completo ou letra curta).
- **CSV** ganha coluna "Tipo" e "De quem", valores assinados
  (`=SUM(F:F)` = saldo do mês direto).
- 30+ novas chaves i18n em PT + EN (`exp.type.*`, `exp.f.source`,
  `exp.modal.income.*`, `exp.toast.income.*`, `exp.sources.*`,
  `exp.income.*`, `exp.f.owner`, `exp.owner.*`, `exp.owner.short.*`,
  `exp.hero.balance*`).
- O que foi INTENCIONALMENTE deixado de fora: aba Endividamento,
  aba Cartões, streak, toggle Mensal/Anual, dica contextual, vídeo
  tutorial, extrato em card separado. Minimalismo sobre inchaço.

### Household UX
- **Patrimônio da casa em tempo real no Expenses** (`#expNwPill`):
  chip clicável no topo da aba mostrando o mesmo total da hero de
  Investments (i10 + USD·rate + reservas + previdência), com live-dot
  + timestamp + "via I10"/"manual"; atualiza automaticamente via
  `updateLedgerEquity()` sempre que as fontes mudam; clicar leva
  pra aba Investments. Extraímos `calcTotalNetWorth()` pra não
  duplicar a fórmula.
- **Aba padrão por usuário** persistida em `config/userPrefs.{uid}`:
  a última aba usada fica marcada como default da próxima sessão.
  No primeiro login de um UID novo, fallback por email
  (`KNOWN_PRIMARY_EMAIL` → investments, qualquer outro → expenses).
  `switchMode()` ganhou opção `{ persist: false }` pra não sobrescrever
  o valor durante o próprio boot.
- 2 novas chaves (`exp.nw.label`, `exp.nw.goto`) em PT + EN.

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
- **Turno 7** — Chip da carteira da Louise (filha, read-only) + piggyback sync (sync do W
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
