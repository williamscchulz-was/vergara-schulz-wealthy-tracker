# Ledger — Wealthy Tracker (Vergara / Schulz)

Contexto persistente do projeto. Mantenha este arquivo atualizado. Quando algo aqui conflitar com o código, **o código é a verdade** — atualize o documento.

---

## 1. O que é o projeto e pra que serve

**Ledger** é um PWA pessoal de finanças do casal **William Schulz (W)** e **Flávia (F)**. Roda no celular (adicionar à tela inicial) e no desktop. Serve dois casos de uso que convivem no mesmo app:

> ℹ️ **Composição familiar referenciada no app**:
> - **W** — William (titular principal)
> - **F** — Flávia (esposa, também usuária autenticada)
> - **Louise** — a filha. Tem uma carteira pública no Investidor 10 (walletId `2699282`) que o app acompanha read-only: aparece como chip compacto na hero de Investments e **não é somada** no patrimônio da casa. Louise não é usuária do app.
>
> ⚠️ O nome "Fernanda" foi uma alucinação minha no primeiro draft deste doc e ficou propagado por várias seções até Abr/2026 — foi removido. Se aparecer "Fernanda" em qualquer lugar do repo, é erro meu, corrigir.

- **Expenses**: lançamento e categorização de despesas mensais da casa, com snapshot do mês atual e histórico anual de dividendos recebidos.
- **Investments** (modo default): dashboard patrimonial unificado puxando automaticamente do **Investidor 10** via carteira pública — patrimônio, aplicado, variação, Profit TWR, dividendos YTD, lista de ativos, categorização por tipo, barchart 12 meses, aportes mensais, reservas em conta corrente, previdência privada e holdings em USD.

Os dois usuários (W e F) compartilham o mesmo Firestore (`household/main/*`) e enxergam o mesmo estado em tempo real via `onSnapshot`. Cada alteração de um aparece instantaneamente pro outro.

O app é **single-page**, **client-side puro**, servido estaticamente (GitHub Pages ou qualquer host estático). Não há build step — os arquivos são publicados como estão.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript ES modules (sem bundler, sem framework) |
| Auth | Firebase Auth (Google provider) |
| Database | Cloud Firestore (projeto `wealthy-tracker-68658`) |
| Fontes | Inter (UI) + Geist Mono (números) via Google Fonts |
| PWA | `manifest.json` + ícones padrão (iOS + Android + maskable) |
| Proxy/integração | **Cloudflare Worker** (`worker/src/worker.js`) publicado em `workers.cloudflare.com` — resolve CORS do Investidor 10 e faz cache de 5 min |
| Charts | SVG inline desenhado à mão no próprio `public/js/app.js` (sem libs) |

**Stack não negociável:** nada de build step, nada de framework, nada de TypeScript, nada de npm install. Edita arquivo, dá push, tá no ar. Isso é escolha do dono do projeto, não limitação.

### Cloudflare Worker (`worker/src/worker.js`)

- Proxy GET-only com whitelist de paths (`/i10/...`)
- `walletId` validado por regex `^\d{1,12}$`
- Cache de 5 min (`CACHE_TTL = 300`) tanto no header HTTP quanto no fetch interno (`cf: { cacheTtl, cacheEverything }`)
- Endpoints expostos:
  - `/i10/metrics/:walletId` — PL, aplicado, variação, profit_twr
  - `/i10/earnings/:walletId?year=YYYY` — soma de proventos no período
  - `/i10/actives/:walletId` — lista detalhada de ativos (ticker, qtd, preço médio, preço atual, %, appreciation)
  - `/i10/barchart/:walletId` — histórico mensal 12 meses
  - `/i10/all/:walletId?year=YYYY` — **endpoint consolidado usado pelo app** (dispara metrics + earnings + actives em paralelo com `Promise.all`)
- Nenhuma autenticação / cookie / token — só o ID público da carteira
- Free tier (100k req/dia) sobra muito

---

## 3. Arquivos principais

Layout do repo (pós-reorganização):

```
├── public/              → app estático (raiz do GitHub Pages)
│   ├── index.html       → shell + todo o CSS (~2000 linhas, v7/v8)
│   ├── manifest.json    → PWA
│   ├── js/
│   │   └── app.js       → núcleo (~2800 linhas)
│   └── assets/icons/    → favicons + ícones PWA
├── worker/
│   ├── src/worker.js    → CF Worker (CORS proxy)
│   ├── wrangler.toml
│   └── README.md
├── tools/               → one-shots (fora de produção)
│   ├── seed.html, seed-history.html
│   ├── fix-historico.html, import-historico.html
│   ├── brand.html
│   └── README.md
├── docs/
│   ├── ARCHITECTURE.md, FIRESTORE-SCHEMA.md
│   ├── DEPLOY.md, DEPLOY-WORKER.md
│   └── CHANGELOG.md
├── .github/             → PR + issue templates
├── CLAUDE.md, README.md, LICENSE
└── .gitignore, .editorconfig, .gitattributes
```

### App (os que NÃO se deve tratar como descartáveis)

| Arquivo | Papel |
|---|---|
| `public/index.html` | Shell do app. Contém **todo o CSS** (~2000 linhas, tokens `v7`/`v8` — "Linear meets Apple", paleta roxo `#AC5FDB`). Define toda a estrutura de DOM. |
| `public/js/app.js` | Núcleo da aplicação (~2800 linhas). Firebase init, state global, i18n PT/EN, renderers, listeners, sync com I10, lógica de despesas, investimentos, reservas, previdência, FX (USD→BRL), Louise wallet, contribuições, editores, modais. |
| `worker/src/worker.js` | Cloudflare Worker (ver §2). **Publicado separadamente** em `https://ledger-i10-proxy.<sub>.workers.dev`. |
| `public/manifest.json` | Manifesto PWA. |
| `public/assets/icons/*` | Assets da marca. |

### Auxiliares / one-shot — `tools/`

**Não fazem parte do app em runtime** e **não são servidos em produção** (o GH Pages serve só `public/`). Ficam no repo por conveniência, mas rodam localmente (`file://` ou server local em `tools/`):

| Arquivo | Para quê serve | Quando rodar |
|---|---|---|
| `tools/seed.html` | Popular Firestore com as 11 ações + BTC do W (pré-I10-sync). | Uma vez, setup inicial. |
| `tools/seed-history.html` | Seed inicial de `dividendsYearly` + objeto mensal em `config/dividends`. | Uma vez, setup inicial. |
| `tools/fix-historico.html` | **Destrutivo**: apaga TODOS os docs em `dividendsYearly` e recria. | Raramente. Sempre confirmar antes. |
| `tools/import-historico.html` | Upsert (sem deletar) dos 6 anos de `dividendsYearly`. | Quando precisar realinhar sem perder dados. |
| `tools/brand.html` | Preview do brand kit. | Durante trabalho de UI. |

**Regra**: se o trabalho é feature do app, não encostar em `tools/`. Se for mexer em `tools/`, avisar antes — quase todos são destrutivos.

---

## 4. Estrutura de dados Firebase

Projeto: **`wealthy-tracker-68658`**. Config do cliente está hardcoded em `public/js/app.js:10-17` (e tudo bem — é client-side, o que protege é Firestore Rules + Auth). Schema completo em [docs/FIRESTORE-SCHEMA.md](docs/FIRESTORE-SCHEMA.md).

Todas as coleções e documentos ficam sob `household/main/...` (a casa é uma só: W + F compartilham).

### Coleções

```
/household/main/expenses/{id}
  - date:        ISO string (YYYY-MM-DD)
  - value:       number (BRL)                // ⚠ field name is `value`, not `amount`
  - type:        'income' | 'expense'        // ausência = legacy, tratado como 'expense'
  - category:    string                       // expense: key de CATEGORIES; income: key de INCOME_SOURCES
  - owner:       'william' | 'flavia' | 'joint' (opcional)
  - description: string
  - notes:       string (opcional)
  - createdBy:   string (displayName)
  - updatedBy:   string (displayName)
  - createdAt:   serverTimestamp
  - updatedAt:   serverTimestamp (on edit)

/household/main/dividendsYearly/{year}    // id = "2020", "2021", ...
  - year:      number
  - amount:    number (total anual recebido)
  - createdAt / updatedAt

/household/main/contributions/{id}         // aportes mensais
  - year:      number
  - month:     number (1-12)
  - amount:    number
  - createdBy, createdAt, updatedAt
```

### Documentos de configuração

```
/household/main/config/settings         // lang, theme, etc
/household/main/config/i10              // snapshot sincronizado da carteira do W
    equity, applied, variation, profitTwr, dividends, year,
    assets[], categories[], tickerCategories{}, updatedAt, updatedBy, source

/household/main/config/i10-louise       // idem para carteira da F (walletId 2699282)
    equity, applied, variation, dividends, year, updatedAt, updatedBy, source

/household/main/config/i10sync          // config compartilhada
    workerUrl, walletId, publicHash

/household/main/config/fx               // cotação USD→BRL + holdings em USD
    usd, rateUSD, rateUpdatedAt, rateSource, note

/household/main/config/reserves         // contas de reserva (CC / poupança)
    accounts: [{ id, name, bank, amount, ... }]
/household/main/config/pension          // previdência privada (Bradesco default)
    accounts: [{ id, name, amount, ... }]

/household/main/config/budgets          // orçamento mensal por categoria
    categories: { [catKey]: number }, updatedAt, updatedBy

/household/main/config/userPrefs        // preferências por UID (map)
    { [uid]: { defaultMode: 'expenses' | 'investments', updatedAt } }

/household/main/config/goalParams       // meta de dividendos anuais
    dividendsYearlyGoal, dividendsYearlyGoalYear, monthlyContribution, expectedRate

/household/main/config/dividends        // objeto mensal histórico (legado, do seed)
/household/main/meta/connection         // heartbeat de presença
```

Todos os listeners principais estão em `app.js:2222-2358` (bloco `subscribeToFirestore`). Cada listener atualiza `state.*` e dispara render apropriado.

---

## 5. Integração com o Investidor 10

### Fluxo

1. Cliente chama `https://<worker>.workers.dev/i10/all/<walletId>?year=<year>`
2. Worker valida path + walletId, dispara 3 fetches paralelos pra API interna do I10 (`investidor10.com.br/wallet/api/proxy/wallet-app/...`), agrega e devolve JSON
3. `public/js/app.js` (`syncFromI10`, `syncLouise`) parseia o payload e persiste em `config/i10` ou `config/i10-louise`
4. `onSnapshot` nos dois docs propaga pro outro usuário em tempo real

### Endpoints do I10 consumidos (via worker)

| Endpoint upstream | Worker expõe como |
|---|---|
| `/summary/metrics/{walletId}?type=without-earnings&raw=1` | `/i10/metrics/:walletId` |
| `/earnings/total-period/{walletId}?start_date=&end_date=` | `/i10/earnings/:walletId?year=` |
| `/summary/actives/{walletId}/Ticker?raw=1&selected_wallet_currency=BRL` | `/i10/actives/:walletId` |
| `/summary/barchart/{walletId}/12/all` | `/i10/barchart/:walletId` |
| **(os 3 primeiros agregados)** | **`/i10/all/:walletId?year=` ← usado pelo app** |

### WalletIds

- **William (W, principal):** `1986068`
- **Louise (filha — carteira read-only acompanhada):** `2699282` (hardcoded em `state.i10LouiseCfg.walletId` em `public/js/app.js:80`)

O walletId do W é configurável pela UI (modal ⚙️ em Investimentos, salva em `config/i10sync`). O da Louise é hardcoded — se precisar mudar, editar código.

### Autenticação

**Nenhuma.** A API interna do I10 não requer auth quando a carteira é pública. O worker só encaminha GETs. Nenhum cookie, token ou credencial em jogo.

### Observação crítica

A API interna do I10 é **não oficial** — mapeada por engenharia reversa do link público. Pode mudar ou quebrar sem aviso. Se quebrar, o botão ✏️ manual nos cards continua funcionando como fallback (edição direta do doc Firestore).

---

## 6. Features implementadas no estado atual

### Modo Investimentos (default)

- **Hero de patrimônio total** = I10 (W) + Reservas + Previdência + FX (USD × rate). A carteira da Louise (filha) **não é somada** — é acompanhada separada no chip. Fórmula em `calcTotalNetWorth()` (`public/js/app.js`, compartilhada com o pill do Expenses).
- **Card I10 do W**: PL, aplicado, variação %, Profit TWR, dividendos YTD, botão 🔄 Sincronizar, botão ⚙️ de config, botão ✏️ de edição manual, link pra carteira pública
- **Chip da carteira da Louise** (filha, compacto): equity, variação, dividendos, timestamp — read-only, acompanhado apenas
- **Lista de ativos**: top 10 ordenados por patrimônio, com ticker, qtd, preço médio, preço atual, % da carteira, appreciation, tag "via I10" ou "manual"
- **Diversificação por categoria** (Ações / FIIs / Tesouro / Cripto / etc) com barras e %
- **Barchart 12m** com range toggle 1Y / 5Y / All, conector pontilhado entre topos + pill no meio (v8 Turno 9)
- **Meta de dividendos anuais** (card `#goalCardV2` em `public/index.html`, lógica em `app.js`): meta R$ 1M até 2035 por default, com projeção determinística, ritmo necessário vs. atual, sliders editáveis. Persistida em `config/goalParams`.
- **Aportes mensais** (`contributions`): visualização histórica por ano/mês
- **Reservas** (CC/poupança): lista editável, com seed automático de 3 contas default no primeiro load
- **Previdência** (Bradesco default): lista editável, com seed automático no primeiro load
- **FX / USD holdings**: valor em USD × rate USD→BRL (atualizado via worker), nota opcional

### Modo Despesas

- **Lançamento unificado** via `#expenseModal`: toggle no topo entre **Saída** (tipo `expense`) e **Ganho** (tipo `income`), swap do seletor entre `CATEGORIES` (10 opções) e `INCOME_SOURCES` (7 opções). Descrição + valor com máscara BRL + data + `notes` (opcional).
- **Owner** (`william` | `flavia` | `joint`) via picker segmentado com cores distintas. Default inferido do user autenticado (William/KNOWN_PRIMARY_EMAIL → `william`; qualquer outro → `flavia`).
- **Hero = Saldo do mês** (ganhos − saídas): verde quando positivo, vermelho quando negativo, prefixo `−` no R$ quando negativo. Sub inline: `↑ R$X entraram · ↓ R$Y saíram`.
- 3 stats expense-only: contagem, delta vs mês anterior (comparando despesas), maior despesa
- Breakdown por categoria com barras + % + **orçamento por categoria**:
  - `config/budgets.categories` guarda limite mensal por categoria
  - Quando há limite: barra mostra % do próprio limite, pct vira "X% do limite", amount adiciona "de R$ Y"
  - Estado `over-budget` pinta barra/valores de vermelho
  - Footer "Gasto / orçamento" com progresso agregado
  - Editor via botão "Orçamento" no card → `#budgetModal`
- Lista de "recentes" (6 últimas, clicáveis) + tabela completa do mês (clique na linha edita; `notes` aparece como segunda linha)
- Navegação por mês (`state.currentViewMonth`)
- CRUD via modal (`#expenseModal` com liquid border)
- Delete via modal custom `#confirmModal` (substituiu `confirm()` nativo)
- i18n completo: todas as strings estáticas/dinâmicas passam por `t()`; PT/EN
- **Analytics (Fase C)**:
  - **Sparkline diário** (`#expDailyChart`): linha de gasto acumulado do mês + linha tracejada de "ritmo esperado" (total/dias × dia), faixas sutis de fim de semana, marcador pro dia de hoje, footer comparando "Hoje: R$ X" vs pace (↑ vermelho acima, ↓ verde abaixo)
  - **Tendência 12m** (`#expTrendChart`): barras empilhadas por categoria dos últimos 12 meses, legenda auto-gerada, mês corrente destacado
  - **Top recorrentes** (`#expRecList`): groupBy descrição YTD (case-insensitive), ranking de gasto, mostra os 6 com count ≥ 2
  - **Over-budget badge no hero**: quando qualquer categoria ultrapassou seu limite mensal, pill animado substitui o sub line
- **Busca live** na tabela (`#expSearch`): filtra por descrição + categoria/fonte + notas + owner (nome completo ou letra curta), case-insensitive; estado `_expSearchQuery` persiste entre re-renders
- **Export CSV** (`#btnExportCsv`): baixa lançamentos do mês atual como CSV UTF-8 com BOM (Excel friendly), separador `;` (convenção BR). Colunas: Data, Tipo, De quem, Descrição, Categoria/Fonte, Valor (BRL — assinado, ganhos positivos, despesas negativas), Notas. `=SUM(F:F)` dá o saldo direto.
- **Pill de patrimônio da casa** (`#expNwPill`): chip clicável no topo do módulo mostrando o mesmo total da hero de Investments em tempo real (fórmula em `calcTotalNetWorth()`: i10 + USD·rate + reservas + previdência); clicar leva pra aba Investments; se esconde quando o total é zero
- **Default mode por usuário**: `config/userPrefs.{uid}.defaultMode` persistido automaticamente toda vez que `switchMode()` é chamado. Login lê via `getDoc` one-shot; se não houver entry pro UID, cai no fallback: email conhecido `KNOWN_PRIMARY_EMAIL` → investments, qualquer outro → expenses
- **Não implementado (ideias futuras)**: despesas recorrentes marcadas manualmente, parcelas com projeção (aba Endividamento ficou fora intencionalmente no minimalista), cartões de crédito como entidade separada, comparativo YoY por categoria, visão anual

### Transversal

- **Auth Google** (com early auth guard em `app.js:24-36` que recarrega se o main auth não registrar em 2s)
- **i18n PT/EN** persistido em `config/settings.lang`
- **Theme** claro/escuro persistido em `config/settings.theme`
- **Tab bar** mobile pra alternar Despesas ↔ Investimentos
- **Tags "via I10" vs "manual"** pra distinguir fonte do dado
- **Toasts** de feedback (`showToast`)
- **PWA instalável** (manifest + ícones + apple-touch)

---

## 7. Versão atual e changelog

**UI atual**: marcadores `v7` + `v8` espalhados pelo código. Não há arquivo CHANGELOG.md.

Marcadores `v8 Turno N` visíveis no código indicam iterações recentes:

- **v7** — "Linear meets Apple". Paleta `#29262B` / `#3C3541` / `#AC5FDB` / `#E3A2EE`. Inter + Geist Mono. Fundação.
- **v8 Turno 2** — Keyframes/animations globais (breathing, pulse, drift).
- **v8 Turno 3** — Inputs numéricos do goal-projection convertidos pra text format (R$ 24.000, 10,0%/yr), parse via helper compartilhado, fire on `change` (blur).
- **v8 Turno 4** — Compact values (64,2K / 1,34M), YoY sanitizado (>1000% → —), hatched area + classed paths pra engajar keyframes, stroke-dashoffset trace one-shot.
- **v8 Turno 6** — Bar chart range toggle (1Y / 5Y / All) com sync entre os dois cards.
- **v8 Turno 7** — Render do chip da carteira da Louise (filha) + piggyback sync (cada sync do W dispara também sync da carteira da Louise).
- **v8 Turno 8** — FX module (USD holdings + taxa USD→BRL via worker), USD incluído no hero total.
- **v8 Turno 9** — Bar chart: conector pontilhado entre topos + pill opaca central.
- **Liquid glass tokens / liquid border** — tokens `--glass-*` + `@property --liquid-angle` + anel animado `.liquid-border::before`.

Quando fizer uma mudança relevante, marcá-la como `v8 Turno N+1` (ou `v9 Turno 1` se for virada) num comentário do trecho afetado. Histórico de git cobre o resto.

---

## 8. Princípios e práticas não-negociáveis

1. **Zero build step.** Vanilla JS ES modules. Se um dia precisar de build, isso é conversa — não decisão no meio de uma task.
2. **Zero framework.** Sem React / Vue / Svelte. Funções que manipulam DOM direto, state global em objeto `state`, renderers idempotentes.
3. **Sem dependências npm.** Firebase entra via import direto da CDN (`https://www.gstatic.com/firebasejs/10.12.0/...`). Fontes via Google Fonts CDN.
4. **Um arquivo por responsabilidade grande, sem over-engineering.** `public/js/app.js` é monolítico de propósito — é mais fácil navegar 2800 linhas contíguas do que 40 módulos de 70 linhas.
5. **Firestore como fonte da verdade compartilhada.** Tudo que os dois usuários precisam ver em tempo real passa por Firestore + `onSnapshot`. Estado local é cache do Firestore, não fonte.
6. **Worker fica simples.** Proxy GET-only, whitelist, cache, pronto. Se precisar de lógica complexa, ela vai no cliente — não no worker.
7. **Estética importa.** Tokens de design (`v7`/`v8`), micro-interações, spring easings, liquid glass — isso é parte do produto, não enfeite. Mudanças visuais precisam preservar a linguagem atual (roxo, denso, mono pra números).
8. **Português na UI, inglês no código.** Strings visíveis ao usuário em `I18N.pt` / `I18N.en`. Identificadores, commits, comentários técnicos em inglês.
9. **Privacidade por default.** Os walletIds identificam uma carteira pública, mas não são "secretos" no sentido legal — mesmo assim, não os publique em logs públicos, issues, screenshots compartilhados fora do casal.

---

## 9. Workflow de entrega

1. **Conversa → plano.** Tarefas não-triviais começam com a gente alinhando escopo em texto antes de qualquer edit. Se for mudança UI, descrever o comportamento esperado e validar.
2. **Branches em worktree.** O projeto trabalha em worktrees do Claude Code (`.claude/worktrees/<nome>/`). Cada task fica isolada em sua branch `claude/<nome>`. Ao terminar: commit, push, PR pro `main`.
3. **Commits pequenos e descritivos.** Mensagem em inglês, 1-2 sentenças, foco no "porquê". Co-author do Claude incluído quando a task foi de fato assistida (formato padrão do `/commit`).
4. **Sem push direto pro `main`** quando a mudança não é trivial. Abrir PR, mesmo que o merge seja imediato — o histórico do PR ajuda depois.
5. **Testar no navegador antes de declarar pronto.** Mudança de UI sem teste visual não fecha. Se não for possível testar (ex.: depende do Firestore real do casal), dizer explicitamente "não testei em ambiente real" — nunca fingir sucesso.
6. **Mudanças no `worker/src/worker.js`** → publicar no Cloudflare e validar contra a wallet real antes de dar por entregue. Mudança no worker afeta os dois usuários imediatamente.
7. **`tools/fix-historico.html` e variantes destrutivas** → nunca rodar sem confirmação explícita do dono, mesmo que peçam. São scripts que apagam histórico.
8. **🔒 Docs sempre junto do código.** Toda mudança que afete qualquer um destes deve atualizar **os arquivos `.md` correspondentes no MESMO commit**, nunca em "commit de docs depois":
   - **Schema Firestore** (novo campo, tipo mudou, coleção nova, default diferente) → `docs/FIRESTORE-SCHEMA.md` + `CLAUDE.md §4`
   - **Nova feature ou mudança de fluxo** visível ao usuário → `CLAUDE.md §6` + `docs/CHANGELOG.md` [Unreleased]
   - **Nova convenção, padrão técnico, helper compartilhado, ou regra arquitetural** → `CLAUDE.md §10` + `docs/ARCHITECTURE.md` se aplicar
   - **Deploy/setup/rules** mexidos → `docs/DEPLOY.md`, `docs/DEPLOY-WORKER.md` ou `docs/FIRESTORE-RULES.md`
   - **Pessoas, emails, UIDs ou walletIds** — sempre conferir `CLAUDE.md §1` e §5 quando mexer
   
   Motivação: o CLAUDE.md é o contexto carregado em toda sessão futura. Se ficar desatualizado, sessões novas tomam decisões baseadas em informação errada (já aconteceu — "Fernanda" ficou propagando meses porque ninguém corrigiu o doc). **Regra operacional:** antes de `git commit`, revisar se o diff do commit toca schema/feature/padrão; se tocar, o diff TEM que incluir o `.md` correspondente.

---

## 10. Padrões técnicos

- **State global**: um único objeto `state` em `app.js:70`. Mutações síncronas + chamada do render correspondente.
- **Renderers idempotentes**: `renderInvestments`, `renderExpenses`, `renderFX`, `renderLouise`, `renderReserves`, `renderPension`, `renderContributions`, `renderBarChart`, `renderDividends`, etc. Podem rodar N vezes sem efeito colateral — sempre reconstroem a partir do `state`.
- **Firestore listeners** são registrados uma vez em `subscribeToFirestore()` e guardados no objeto `unsub` pra unsub no logout.
- **Atualizações persistidas** usam `setDoc(..., { merge: true })` quando é patch, `addDoc` quando é nova linha de coleção. `serverTimestamp()` sempre pra `updatedAt`/`createdAt`.
- **Campos numéricos vindos do I10** sempre coagidos com `+value || 0` ou `parseFloat(value) || 0` porque a API devolve às vezes string, às vezes number, às vezes `null`.
- **Formatação de valores**: helpers `fmtBRL0`, `fmtBRL2`, `formatDateTimeBR` em `public/js/app.js`. Nunca usar `toLocaleString` cru na UI — passa pelos helpers pra manter consistência.
- **CSS em `public/index.html`** com tokens no `:root`. Não espalhar cores hex cruas — usar `var(--purple)`, `var(--ink-2)`, `var(--gain)`, etc.
- **Animações respeitam `prefers-reduced-motion`** (bloco "v8 REDUCED MOTION" no CSS mata tudo quando ativo). Não adicionar animação sem respeitar isso.
- **Datas**: armazenar como ISO string `YYYY-MM-DD` (despesas) ou `serverTimestamp` (metadados). Sempre absolutas — nada de "3 dias atrás" persistido.
- **IDs de documento**: `dividendsYearly` usa o próprio ano como ID (`"2026"`). `expenses` e `contributions` usam ID auto do Firestore.

---

## 11. Coisas que NÃO devem acontecer

- ❌ **Nunca** expor o(s) walletId(s) em logs públicos, mensagens de erro voltadas ao usuário, screenshots em issues públicas, dashboards compartilhados. São carteiras pessoais.
- ❌ **Nunca** mexer em `worker/src/worker.js` sem testar localmente (`wrangler dev` ou equivalente) e validar contra a wallet real antes de publicar. Worker quebrado = os dois usuários ficam sem dashboard.
- ❌ **Nunca** adicionar dependência npm / build step / transpilação sem alinhar primeiro. O projeto é vanilla por decisão.
- ❌ **Nunca** rodar `tools/fix-historico.html` ou equivalentes destrutivos sem confirmação explícita do dono para essa execução específica. "Rodou outra vez" não autoriza rodar de novo.
- ❌ **Nunca** renomear coleções / caminhos Firestore (`household/main/...`) sem plano de migração. Os dados reais do casal estão lá.
- ❌ **Nunca** commitar arquivos com credenciais reais de outro serviço. A config do Firebase em `app.js:10` está ok (é client-side público, protegido por Rules) — mas **nada além disso**. Sem tokens de CF, chaves de API externas, secrets de worker.
- ❌ **Nunca** assumir que a API do I10 é estável. Se um campo mudar, parse defensivo (`|| 0`, `|| ''`, `Array.isArray(...)`) precisa continuar funcionando e o app tem que degradar pro botão ✏️ manual, não quebrar.
- ❌ **Nunca** mandar toast de erro técnico pro usuário final ("HTTP 502 from upstream"). Logar no console, mostrar mensagem humana ("Não deu pra sincronizar agora — tente de novo em instantes").
- ❌ **Nunca** deletar docs do Firestore sem passar por um fluxo de UI que o usuário dispare explicitamente. Sem "limpeza automática" de dados.
- ❌ **Nunca** mudar a paleta / tipografia / spacing sem contexto de design. A linguagem visual é `v7`/`v8` — edições pontuais sim, virada de estilo só em conversa explícita.
- ❌ **Nunca** ignorar `prefers-reduced-motion` em animação nova. É acessibilidade, não opcional.
- ❌ **Nunca** remover o early auth guard (`app.js:24-36`) — ele existe porque o main app às vezes trava e sem ele o login fica preso.
- ❌ **Nunca** commitar mudança de schema, feature visível, padrão técnico, pessoa/email/UID ou walletId **sem atualizar o `.md` correspondente NO MESMO commit**. Ver regra operacional em §9.8. Docs desatualizados contaminam sessões futuras com informação errada.

---

## Apêndice — quick reference

- **Repo local**: `C:\Users\willi\Documents\projects\vergara-schulz-wealthy-tracker\`
- **Main branch**: `main`
- **Worker URL**: `https://ledger-i10-proxy.<sub>.workers.dev` (configurada no app pelo modal ⚙️, persistida em `config/i10sync.workerUrl`)
- **Firebase project ID**: `wealthy-tracker-68658`
- **Entrypoint**: `public/index.html` → importa `public/js/app.js` (ES module, único arquivo JS do app)
- **Deploy do worker**: `wrangler deploy` ou colar no dashboard do Cloudflare Workers
- **Deploy do app**: push pro repo (GitHub Pages ou equivalente serve os estáticos)
