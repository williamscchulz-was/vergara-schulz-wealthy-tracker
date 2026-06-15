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

O app é **single-page**, **client-side puro**, servido estaticamente. Não há build step — os arquivos são publicados como estão. **Hospedagem dupla** (mesmo `public/`): **Firebase Hosting** em `https://ledger-schulz.web.app` (URL principal) — publicada por **`firebase deploy` manual** (CLI logada no PC do dono); o Action `firebase-hosting.yml` fica **INERTE** até existir o secret `FIREBASE_SERVICE_ACCOUNT` (passa verde sem publicar). **GitHub Pages** (backup) **esse auto-deploya** no push (`pages.yml`). ⚠️ **`git push` NÃO atualiza o `.web.app`** — só `firebase deploy` manual (ou o secret) faz isso. Ver `docs/DEPLOY-HOSTING.md`.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript ES modules (sem bundler, sem framework) |
| Auth | Firebase Auth (Google provider) |
| Database | Cloud Firestore (projeto `wealthy-tracker-68658`) |
| Hosting | **Firebase Hosting** (`ledger-schulz.web.app`, principal) — publicada por `firebase deploy` manual (Action `firebase-hosting.yml` **inerte** sem o secret `FIREBASE_SERVICE_ACCOUNT`) + **GitHub Pages** backup (auto-deploy no push, `pages.yml`). ⚠️ `git push` não atualiza o `.web.app`. Config `firebase.json`. Setup `docs/DEPLOY-HOSTING.md` |
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
  - `/i10/earnings-list/:walletId` — lista DETALHADA de proventos (cada pagamento: ticker, tipo, data, líquido). Usado pelo import "Proventos I10" → Ganhos (o app filtra os já pagos).
  - `/i10/actives/:walletId` — lista detalhada de ativos (ticker, qtd, preço médio, preço atual, %, appreciation)
  - `/i10/barchart/:walletId` — histórico mensal 12 meses
  - `/i10/all/:walletId?year=YYYY` — **endpoint consolidado usado pelo app** (dispara metrics + earnings + actives + barchart em paralelo com `Promise.all`)
  - `/i10/yearly/:walletId?start=YYYY` — proventos ano a ano (reconstruído chamando `/earnings/total-period` em loop). Default `start=2018`. Usado pelo botão "I10" do card "histórico anual" pra rebackfill `dividendsYearly`.
  - `/fx/rate` — cotação USD→BRL via AwesomeAPI (`economia.awesomeapi.com.br`, free, sem auth), cache de 15min. Retorna `{ rateUSD, rateSource, rateUpdatedAt }`. ⚠️ **jun/2026: este endpoint dava HTTP 502** (AwesomeAPI bloqueia o IP do Cloudflare Worker). O app NÃO depende mais dele: `fetchFXRate()` busca **direto** do AwesomeAPI no browser (tem `Access-Control-Allow-Origin: *`) e só usa `/fx/rate` como fallback. Se for republicar o worker, trocar a fonte por uma que aceite datacenter (ex.: open.er-api.com).
- Nenhuma autenticação / cookie / token nos endpoints proxy — só o ID público da carteira
- Free tier (100k req/dia) sobra muito
- **Cron Trigger** (`scheduled()` handler) — **PARKED / NÃO ativado**. O código existe, mas o gatilho está desligado (`crons` comentado no `wrangler.toml`); o app atualiza ao abrir (auto-sync), o que já atende — decisão do dono (jun/2026: "deixa quieto o cron, tá funcionando legal quando abre atualiza"). Se ligado, rodaria 08:00 BRT diário buscando I10 (W + Louise) + USD e gravando em `config/i10` / `config/i10-louise` / `config/fx` sem ninguém abrir o app — autentica via service account do Firebase (secret `FIREBASE_SA`), JWT RS256 → token OAuth → Firestore REST API (PATCH `updateMask`), `updatedBy: 'cron 8h'`. Pra ligar: `docs/DEPLOY-WORKER.md`.

---

## 3. Arquivos principais

Layout do repo (pós-reorganização):

```
├── public/              → app estático (raiz do GitHub Pages)
│   ├── index.html       → shell + DOM (~990 linhas; CSS saiu pra css/)
│   ├── css/             → CSS em 9 arquivos (01-base … 09-contrast), <link> NA ORDEM
│   ├── manifest.json    → PWA
│   ├── js/
│   │   ├── app.js       → núcleo (~5000 linhas: renderers, listeners, lógica)
│   │   ├── firebase.js  → init Firebase + refs (importado por app.js)
│   │   ├── i18n.js      → tabela de traduções PT/EN (export const I18N)
│   │   ├── constants.js → ICONS, CATEGORIES, INCOME_*, MONTH_NAMES (puro)
│   │   ├── import-core.js → núcleo PURO do import (fingerprint, normalize, parse) — testável
│   │   ├── recurring-core.js → núcleo PURO de despesas fixas (projeção + reconciliação) — testável
│   │   └── goal-projection.js → card de projeção da meta
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
├── tests/               → node --test (SEM deps); `npm test` ou `node --test`
│   └── import-core.test.js
├── package.json         → manifest test-only (type:module + script test). SEM deps, SEM npm install
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
| `public/index.html` | Shell do app: `<head>`, `<link>`s de CSS e **toda a estrutura de DOM** (~990 linhas). O CSS foi extraído pra `public/css/`. |
| `public/css/*.css` | CSS em 9 arquivos (`01-base` → `09-contrast-light`), ligados por `<link>` **na ordem original** — a cascata depende dessa ordem, **não reordenar**. Tokens `v7`/`v8`, paleta verde (`--purple` = `#c7f73e`). |
| `public/js/app.js` | Núcleo da aplicação (~5100 linhas). State global, `t()`/`getLang`, renderers, listeners, sync com I10, lógica de despesas, investimentos, reservas, previdência, FX, contribuições, editores, modais, import. Importa `firebase.js` e `i18n.js`. |
| `public/js/firebase.js` | Init do Firebase (config + `app`/`auth`/`db`) e re-export das funções do SDK que o app usa. Importado por `app.js`. |
| `public/js/i18n.js` | `export const I18N` — tabela de strings PT/EN (~890 linhas). `t()`/`getLang()` vivem no `app.js` e consomem o `I18N` importado. |
| `public/js/constants.js` | `ICONS`, `CATEGORIES`, `INCOME_SOURCES`, `INCOME_OPTS`, `MONTH_NAMES_*` + helper `_svg()`. Dados puros, importados por `app.js`. |
| `public/js/import-core.js` | Núcleo **puro** do import (v8 Turno 11): `impFp` (fingerprint do dedup), `impNormalize`/`impTokens`/`impRuleKey`, `impToISO`, `parseBRMoney`. Sem DOM/Firebase/`state` → coberto por `tests/import-core.test.js`. |
| `tests/import-core.test.js` + `package.json` | Testes `node --test` (rodar `npm test` ou `node --test`). **Zero dependências, zero `npm install`** — o `package.json` só liga `type:module` (node lê .js como ESM, igual o browser) + o script `test`. Não é deployado (fica fora de `public/`). |
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
  - owner:       'william' | 'flavia' | 'louise' | 'familia' (legado 'joint' → exibido/editado como 'familia' via normOwner())
  - description: string
  - notes:       string (opcional)
  - createdBy:   string (displayName)
  - updatedBy:   string (displayName)
  - createdAt:   serverTimestamp
  - updatedAt:   serverTimestamp (on edit)

/household/main/dividendsYearly/{year}    // id = "2020", "2021", ...
  - year:      number
  - divs:      number (total anual recebido — ⚠ nome é `divs`, não `amount`)
  - equity:    number|null (PL ao fim do ano, vem do import I10)
  - applied:   number|null (aportes acumulados ao fim do ano)
  - flow:      number|null (fluxo compras−vendas)
  - source:    string  ('investidor10-yearly-import' quando importado)
  - updatedAt / updatedBy: serverTimestamp / displayName

/household/main/contributions/{id}         // aportes mensais
  - year:      number
  - month:     number (1-12)
  - amount:    number
  - note:      string (opcional — anotação livre: pra onde foi o aporte)
  - createdBy, createdAt, updatedAt

/household/main/recurring/{id}             // templates de despesa FIXA/recorrente (v8.19)
  - desc, value, category, owner, type:'expense', nature:'fixa'
  - dayOfMonth: number (1-28)
  - startYM:   'YYYY-MM'        // mês de início
  - endYM:     'YYYY-MM' | null // até quando (null = indefinido)
  - card:      boolean          // é no cartão? (reconcilia com a fatura)
  - ruleKey:   string           // impRuleKey do estabelecimento (casar c/ a fatura, se card)
  - createdAt / updatedAt / createdBy
  // O lançamento real liga-se ao template por `recurringId` (campo em expenses).
  // As instâncias mensais são PROJETADAS em runtime (recurring-core.js), NUNCA gravadas.
```

### Documentos de configuração

```
/household/main/config/settings         // lang, theme, etc
/household/main/config/i10              // snapshot sincronizado da carteira do W
    equity, applied, variation, profitTwr, dividends, year,
    assets[], categories[], monthly[], divsMonthly{}, tickerCategories{}, updatedAt, updatedBy, source
    // divsMonthly{}: { 'YYYY-MM': líquido } últimos ~30 meses (earnings-list por data
    //   de pagamento) — precisão do Dietz mensal; sem ele, fallback anual ÷ 12
    // monthly[]: [{ year, month, equity }] sorted asc — backbone do card
    // de rentabilidade mês a mês (vem do /summary/barchart/... do I10)

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

- **William (W, principal):** `2814459` _(carteira atual; a anterior era `1986068`, trocada em 2026-04)_
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
- **Patrimônio por ano — derivado ao vivo do I10**: `/i10/all` traz o barchart de **120 meses** (10 anos). `parseI10Barchart` popula `state.i10.monthly`, e `yearEquity(y)` resolve o patrimônio de fim de ano com precedência: **(1)** valor manual no Firestore (`+ Year`, sempre vence) → **(2)** `derivedYearEndEquity(year)` = último mês daquele ano no barchart (real, recalculado a cada Sync, nada gravado, nada pra apagar) → **(3)** `HISTORICAL_EQUITY` (fallback embutido com os valores reais de Dez, só usado offline). Usado por `renderPLChart` e `renderYearlyTable`. O card de rentabilidade mês a mês fatia `state.i10.monthly.slice(-13)` pra não desenhar 70 barras.
- **Rentabilidade mês a mês** (`#monthlyReturnsCard`, abaixo do "patrimônio por ano"): bar chart de ~11 barras (verde positivo, vermelho negativo) + badge "média +X% · últimos N meses" + tabela expansível (`<details>`) com PL início, PL fim, Aporte, Proventos, Retorno R$ e %. Fórmula: **modified Dietz** com **total return** (dividendos contam como parte do retorno, não saída). Helper: `computeMonthlyReturns(state.i10.monthly, state.contributions, state.yearly)` em `public/js/app.js`. Dados vêm do endpoint `/i10/barchart/:walletId` (fetch paralelo do `syncFromI10`, ou via agregado no `/i10/all` se o worker foi redeployado com a mudança — os dois caminhos convivem por `payload.barchart || await barRes.json()`) — shape é normalizado por `parseI10Barchart()` (aceita várias formas: array de {date, value}, {data: []}, {labels: [], values: []}, ou {year, month, equity} já explícitos). Proventos são distribuídos proporcionalmente 1/12 por mês a partir de `dividendsYearly` (aproximação; se quiser granular mensal, precisaria de outro endpoint do I10).
- **Meta de dividendos anuais** (card `#goalCardV2` em `public/index.html`, lógica em `app.js`): meta R$ 1M até 2035 por default, com projeção determinística, ritmo necessário vs. atual, sliders editáveis. Persistida em `config/goalParams`.
- **Aportes mensais** (`contributions`): visualização histórica por ano/mês
- **Reservas** (CC/poupança): lista editável, com seed automático de 3 contas default no primeiro load
- **Previdência** (Bradesco default): lista editável, com seed automático no primeiro load
- **FX / USD holdings**: valor em USD × rate USD→BRL (atualizado via worker), nota opcional

### Modo Despesas

- **Lançamento unificado** via `#expenseModal`: toggle no topo entre **Saída** (tipo `expense`) e **Ganho** (tipo `income`), swap do seletor entre `CATEGORIES` (10 opções) e `INCOME_SOURCES` (7 opções). Descrição + valor com máscara BRL + data + `notes` (opcional).
- **Owner / "de quem é o gasto"** (`william` | `flavia` | `louise` | `familia`) via picker segmentado 2×2 com cores distintas (W=cyan, F=pink, Louise=verde, Família=roxo). Legado `joint` (W+F) é normalizado pra `familia` na exibição/edição (`normOwner()` em `app.js`; sem migração de dados). Lista canônica em `const OWNERS`. Default num lançamento novo = inferido do user autenticado (William/KNOWN_PRIMARY_EMAIL → `william`; qualquer outro → `flavia`). É **manual** — "de quem é o gasto" ≠ "quem pagou" (esse último vem do cartão na importação).
- **Hero = Saldo do mês** (ganhos − saídas): verde quando positivo, vermelho quando negativo, prefixo `−` no R$ quando negativo. Sub inline: `↑ R$X entraram · ↓ R$Y saíram`.
- 3 stats expense-only: contagem, delta vs mês anterior (comparando despesas), maior despesa
- Breakdown por categoria com barras + % + **orçamento por categoria**:
  - `config/budgets.categories` guarda limite mensal por categoria
  - Quando há limite: barra mostra % do próprio limite, pct vira "X% do limite", amount adiciona "de R$ Y"
  - Estado `over-budget` pinta barra/valores de vermelho
  - Footer "Gasto / orçamento" com progresso agregado
  - Editor via botão "Orçamento" no card → `#budgetModal`
- Tabela completa do mês (clique na linha edita; `notes` aparece como segunda linha). **Só DESPESAS por padrão** (ganhos só com o filtro "Ganho"). **Totalizador** acima da tabela (`#expTotalBar`): nº de lançamentos + soma do que está à vista. _(v8.16: card "Lançamentos recentes" removido.)_
- **Categorias em ordem alfabética** em todo seletor — helper `catsAZ()` (filtro, modal de despesa, revisão do import, orçamento).
- **Despesas FIXAS / recorrentes** (v8.19): no modal, "Fixa" revela "Repetir todo mês" + "até quando" → cria um template em `recurring`. As instâncias mensais são **PROJETADAS** em runtime (`recurring-core.js` `projectRecurring`, injetado no `all` de `renderExpenses`) — **nunca gravadas**. **Não duplica**: a projeção é suprimida quando já existe o lançamento real do mês (manual via `recurringId`, ou da fatura via `impRuleKey`+valor pra cartão) → `doImport` intacto. Linha "fixa" projetada (badge) → clique abre `openRecurringEditor` (valor / até / parar). Meses futuros entram como `provisioned` (compromisso). Regra de ouro: virtual nunca persiste → pior caso é uma linha a mais, nunca dado duplicado.
- Navegação por mês (`state.currentViewMonth`)
- CRUD via modal (`#expenseModal` com liquid border)
- Delete via modal custom `#confirmModal` (substituiu `confirm()` nativo)
- i18n completo: todas as strings estáticas/dinâmicas passam por `t()`; PT/EN
- **Analytics**: _(v8.16: "Sparkline diário" / `renderDailyChart` removido — chamada tirada; a função segue inerte no código.)_
  - **Tendência 12m** (`#expTrendChart`): barras empilhadas por categoria dos últimos 12 meses, legenda auto-gerada, mês corrente destacado
  - **Top recorrentes** (`#expRecList`): groupBy descrição YTD (case-insensitive), ranking de gasto, mostra os 6 com count ≥ 2
  - **Over-budget badge no hero**: quando qualquer categoria ultrapassou seu limite mensal, pill animado substitui o sub line
- **Busca live** na tabela (`#expSearch`): filtra por descrição + categoria/fonte + notas + owner (nome completo ou letra curta), case-insensitive; estado `_expSearchQuery` persiste entre re-renders
- **Export CSV** (`#btnExportCsv`): baixa lançamentos do mês atual como CSV UTF-8 com BOM (Excel friendly), separador `;` (convenção BR). Colunas: Data, Tipo, De quem, Descrição, Categoria/Fonte, Valor (BRL — assinado, ganhos positivos, despesas negativas), Notas. `=SUM(F:F)` dá o saldo direto.
- **Pill de patrimônio da casa** (`#expNwPill`): chip clicável no topo do módulo mostrando o mesmo total da hero de Investments em tempo real (fórmula em `calcTotalNetWorth()`: i10 + USD·rate + reservas + previdência); clicar leva pra aba Investments; se esconde quando o total é zero
- **Default mode por usuário**: `config/userPrefs.{uid}.defaultMode` persistido automaticamente toda vez que `switchMode()` é chamado. Login lê via `getDoc` one-shot; se não houver entry pro UID, cai no fallback: email conhecido `KNOWN_PRIMARY_EMAIL` → investments, qualquer outro → expenses
- **Auto-sync** do I10 (`maybeAutoSync()` em `public/js/app.js`): dispara `syncFromI10()` em background quando a última sync foi há ≥1h. Sem scheduler externo — três triggers no client: (1) 3s após o login, (2) ao voltar pra aba (`visibilitychange` → `visible`), (3) heartbeat de hora em hora pra sessões deixadas abertas. Como os 2 usuários compartilham `config/i10`, quem dispara primeiro atualiza pros dois via `onSnapshot`. Debounce de 60s nas checagens evita spam. Pula se não houver sync prévia (primeiro setup precisa ser manual pelo usuário pra ele ver funcionar). Cada sync atualiza: metrics, earnings, actives (todas as classes), barchart 12m, Louise, FX (USD→BRL) e — throttled a 24h — também o histórico anual (`dividendsYearly` via `/i10/yearly`).
- **Ordenação da tabela** (jun/2026): o cabeçalho da tabela "Todas as despesas do mês" é clicável (Data / Descrição / Categoria / Valor), alterna asc↔desc, com seta indicadora na coluna ativa. Estado em `_expSort = {key, dir}` (default `date`/`desc`); comparador `expCompare()`, indicador `updateExpSortHeaders()` (roda no topo de `renderExpenses` p/ refletir sempre). Data/Valor ordenam numericamente, Descrição/Categoria alfabético (locale pt), desempate por data desc.
- **Não implementado (ideias futuras)**: despesas recorrentes marcadas manualmente, parcelas com projeção (aba Endividamento ficou fora intencionalmente no minimalista), cartões de crédito como entidade separada, comparativo YoY por categoria, visão anual

### Importação (fatura / extrato / proventos)

- **3 origens** via `#importTypeModal`: **PDF de cartão** (`_importKind='card'`, `parseStatement`), **CSV de conta** (`'cc'`), e **Proventos I10 / AO VIVO** (`'i10prov'`, `importI10Proventos()` busca `/i10/earnings-list` e lança como Ganhos).
- **Tela de revisão** `#importModal`: linhas editáveis (dono + categoria por linha), abas por mês de competência, dedup por **fingerprint multiset** (`fpFor`/`impFp`) → re-importar **não duplica** (idempotente). Animação de "lendo → categorizando → pronto" no `#importOverlay`.
- **"Selecionar todos"** (`#impSelectAll`, jun/2026): checkbox mestre que marca/desmarca as linhas **visíveis** (respeita a aba de mês ativa); reflete estado all/some/none (indeterminate). `impSetAllVisible()` + sync no `impUpdateConfirm()`.
- **Robustez (jun/2026, aprendizado real)**:
  - A linha de revisão é **`<div>`, NÃO `<label>`** + handler de clique-pra-alternar que **ignora cliques nos `<select>`** (dono/categoria). Motivo: um `<label>` envolvendo o checkbox + os selects fazia o iOS **desmarcar a linha** ao mexer no select → "não deixa importar". Não voltar pra `<label>`.
  - O commit do `doImport` (preview + animação + gravações) está todo dentro de **try/finally** → o botão "Importar" **sempre** reabilita e o modal fecha, mesmo se a animação lançar erro (antes podia travar em `disabled`).
  - Categorias customizadas (chave `c<timestamp>`) funcionam no import — auditado, sem caso de `undefined`/throw.
- **Auto-sync de proventos** (`autoSyncProventos()`, jun/2026): roda junto de **cada** `syncFromI10` (piggyback). Busca `/i10/earnings-list`, filtra os **já pagos** (data ≤ hoje), pega o **líquido**, e lança nos **Ganhos** (`category 'dividendos'`, owner william, `source 'auto:i10prov'`) **sem clicar**. Dedup multiset igual ao `doImport` (cruza com import manual pelo mesmo `fp`) → idempotente: 1ª vez faz backfill, depois só adiciona o novo. Toast informa quantos entraram.

### Transversal

- **Auth Google** (com early auth guard em `app.js:24-36` que recarrega se o main auth não registrar em 2s)
- **i18n PT/EN** persistido em `config/settings.lang`
- **Theme** claro/escuro persistido em `config/settings.theme`
- **Tab bar** mobile pra alternar Despesas ↔ Investimentos
- **Tags "via I10" vs "manual"** pra distinguir fonte do dado
- **Toasts** de feedback (`showToast`)
- **Popup de erro** (`showErrorPopup(title, err, opts)`, jun/2026): em vez de o app "não fazer nada" calado numa falha, abre um modal com título humano + **detalhe técnico copiável** (mensagem + stack). Plugado em `doImport`, `importI10Proventos`, `autoSyncProventos` (mostra HTTP status/body — ex.: 404 = worker sem `/i10/earnings-list`) e numa **rede de segurança global** (`window` `unhandledrejection` + `error`, deduplicada por mensagem via `opts.once`, ignora erros de carregamento de recurso). Decisão do dono (app pessoal, p/ debug) — ver nuance em §11.
- **Versão no header + popup de novidades** (jun/2026): `const APP_VERSION` (em `app.js`) aparece como badge clicável ao lado de "Ledger" (a tagline "personal finance" foi removida). `showUpdatePopup()` lista `APP_CHANGES` (novidades) num modal minimal; `maybeShowUpdatePopup()` mostra **1× por versão** (compara `localStorage.ledger_seen_ver` com `APP_VERSION`, ~1.4s pós-login). Clicar o badge reabre. **Pra lançar novidade:** bumpar `APP_VERSION` + atualizar `APP_CHANGES`.
- **PWA instalável** (manifest + ícones + apple-touch)

---

## 7. Versão atual e changelog

**UI atual**: marcadores `v7` + `v8` espalhados pelo código. Não há arquivo CHANGELOG.md.

Marcadores `v8 Turno N` visíveis no código indicam iterações recentes:

- **v7** — "Linear meets Apple". Fundação. Inter + Geist Mono. (Acento original roxo `#AC5FDB`; o app **migrou pra lime** `#bdf63f` nos temas Obsidian/Linen — o token CSS continua `--purple` por legado, mas renderiza **verde-limão**, não roxo.)
- **v9** — Port fiel dos mockups Apple (Obsidian/Linen). CSS dividido em `public/css/01..11`. Bento por aba (cards lado a lado, mesma altura), sparklines, donuts, gauge de poupança no Resumo. **Regras de consistência:** acento lime; números SEMPRE em Geist Mono; ícones neutros (`--ink-2`), cor só em donut/ganho-perda; títulos de card em Inter 700.
- **v8 Turno 2** — Keyframes/animations globais (breathing, pulse, drift).
- **v8 Turno 3** — Inputs numéricos do goal-projection convertidos pra text format (R$ 24.000, 10,0%/yr), parse via helper compartilhado, fire on `change` (blur).
- **v8 Turno 4** — Compact values (64,2K / 1,34M), YoY sanitizado (>1000% → —), hatched area + classed paths pra engajar keyframes, stroke-dashoffset trace one-shot.
- **v8 Turno 6** — Bar chart range toggle (1Y / 5Y / All) com sync entre os dois cards.
- **v8 Turno 7** — Render do chip da carteira da Louise (filha) + piggyback sync (cada sync do W dispara também sync da carteira da Louise).
- **v8 Turno 8** — FX module (USD holdings + taxa USD→BRL via worker), USD incluído no hero total.
- **v8 Turno 9** — Bar chart: conector pontilhado entre topos + pill opaca central.
- **Liquid glass tokens / liquid border** — tokens `--glass-*` + `@property --liquid-angle` + anel animado `.liquid-border::before`.
- **v8 Turno 10** (jun/2026) — Bloco de import + erros: (1) animação de import suavizada (tirado `backdrop-filter` de tela cheia do `.imp-overlay`; `.imp-scan` anima `transform` em vez de `top` + `will-change`); (2) "Selecionar todos" na revisão; (3) ordenação clicável no cabeçalho da tabela de despesas; (4) auto-sync de proventos I10 → Ganhos (`autoSyncProventos`); (5) linha de revisão `<div>` (não `<label>`) + `doImport` em try/finally (botão nunca trava); (6) `showErrorPopup` + rede de segurança global de erros.

Quando fizer uma mudança relevante, marcá-la como `v8 Turno N+1` (ou `v9 Turno 1` se for virada) num comentário do trecho afetado. Histórico de git cobre o resto.

---

## 8. Princípios e práticas não-negociáveis

1. **Zero build step.** Vanilla JS ES modules. Se um dia precisar de build, isso é conversa — não decisão no meio de uma task.
2. **Zero framework.** Sem React / Vue / Svelte. Funções que manipulam DOM direto, state global em objeto `state`, renderers idempotentes.
3. **Sem dependências npm.** Firebase entra via import direto da CDN (`https://www.gstatic.com/firebasejs/10.12.0/...`). Fontes via Google Fonts CDN.
4. **Sem over-engineering, mas sem arquivo gigante.** O CSS foi extraído do `index.html` pra `public/css/` (9 arquivos por seção, ligados por `<link>` **na ordem** — a cascata depende disso). O JS começou a modularizar em **ES modules nativos** (sem build): `firebase.js` e `i18n.js` saíram do `app.js` (que importa os dois). O núcleo de render/lógica segue junto no `app.js` (~5100 linhas) **de propósito** — é muito interligado (state + helpers + renderers chamando uns aos outros), e fatiar isso traz risco alto de quebra com pouco ganho. Sempre nativo: nada de bundler/npm. Extrações futuras só de blocos **auto-contidos** (sem referência de volta ao app.js → sem ciclo), em fases verificadas.
5. **Firestore como fonte da verdade compartilhada.** Tudo que os dois usuários precisam ver em tempo real passa por Firestore + `onSnapshot`. Estado local é cache do Firestore, não fonte.
6. **Worker fica simples.** Proxy GET-only, whitelist, cache, pronto. Se precisar de lógica complexa, ela vai no cliente — não no worker.
7. **Estética importa.** Tokens de design (`v7`/`v8`/`v9`), micro-interações, spring easings, liquid glass — isso é parte do produto, não enfeite. Mudanças visuais precisam preservar a linguagem atual: **acento lime** (não roxo — o token `--purple` é legado), denso, **números SEMPRE em Geist Mono**, **ícones neutros** (`--ink-2`; cor só em donut/ganho-perda), títulos de card Inter 700, cards de uma mesma linha do bento na **mesma altura**.
8. **Português na UI, inglês no código.** Strings visíveis ao usuário em `I18N.pt` / `I18N.en`. Identificadores, commits, comentários técnicos em inglês.
9. **Privacidade por default.** Os walletIds identificam uma carteira pública, mas não são "secretos" no sentido legal — mesmo assim, não os publique em logs públicos, issues, screenshots compartilhados fora do casal.

---

## 9. Workflow de entrega

> ⚠️ **REGRA CRÍTICA — MÚLTIPLAS MÁQUINAS.** Este projeto é editado pelo dono (William) usando Claude Code em **MAIS DE UM computador**. Portanto, em TODA sessão:
> - **SEMPRE** assuma que o repositório pode ter mudanças feitas em outra máquina.
> - **ANTES de começar a trabalhar:** `git fetch` + `git pull`. Se houver divergência, **avise o dono antes de mesclar**.
> - **DEPOIS de qualquer mudança relevante:** `git add` + `git commit` + `git push origin main`. O trabalho só está salvo de verdade **quando está no GitHub**.
> - `firebase deploy` publica o site mas **NÃO** envia o código pro GitHub. **Deploy ≠ push.** Nunca confie só no deploy pra preservar o código-fonte.

1. **Conversa → plano.** Tarefas não-triviais começam com a gente alinhando escopo em texto antes de qualquer edit. Se for mudança UI/design, **texto não basta — mockar** (ver item 9).
2. **Sempre no `main`, direto.** O projeto tem uma única branch ativa — `main`. Nada de worktrees isoladas, nada de branch `claude/<task>`, nada de PR com merge imediato. Commits pequenos, `git add` + `git commit` + `git push origin main`. Se houver um `.claude/worktrees/` no repo, é estado residual do início do projeto — ignorar, não operar ali. Quem está editando são os dois donos do repo; a única pessoa que o review protegeria é si mesmo, e o custo da cerimônia não compensa.
3. **Commits pequenos e descritivos.** Mensagem em inglês, 1-2 sentenças, foco no "porquê". Co-author do Claude incluído quando a task foi de fato assistida (formato padrão do `/commit`).
4. **Cada commit é auto-contido.** Código + docs que descrevem esse código (ver §9.8) + (se tiver) teste saem juntos. Nada de "depois eu arrumo o doc".
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
9. **🎨 Design = mockup-first (obrigatório).** Nenhuma melhoria de design/UX entra só descrita em texto. Fluxo: **Análise → Relatório → Mockup HTML (página standalone em `public/`, publicada) → Aprovação do dono → Blueprint → Implementação → remover o mockup**. Decisão com múltiplos caminhos → mockar 2–3 variantes lado a lado (caso `propostas.html`, tags A/B/C). Estados (hover/loading/empty/error/sucesso) e motion (gatilho · duração · easing) exemplificados visualmente, nunca só descritos. Processo completo: `docs/DESIGN-WORKFLOW.md`.
10. **🚫 NUNCA usar o preview interno do Claude Code.** Regra explícita do dono (jun/2026): nada de painel de preview — nem pra demonstrar, nem como "prova", nem pra validação. **Todo trabalho visual passa por MOCKUP HTML publicado** (página standalone `propostas-*.html` em `public/`, via `firebase deploy`) que o dono abre no aparelho dele, compara opções e escolhe — só depois implementa-se no app. Verificação técnica = `node --check`, greps e leitura de código.

---

## 10. Padrões técnicos

- **State global**: um único objeto `state` em `app.js:70`. Mutações síncronas + chamada do render correspondente.
- **Renderers idempotentes**: `renderInvestments`, `renderExpenses`, `renderFX`, `renderLouise`, `renderReserves`, `renderPension`, `renderContributions`, `renderBarChart`, `renderDividends`, etc. Podem rodar N vezes sem efeito colateral — sempre reconstroem a partir do `state`.
- **Firestore listeners** são registrados uma vez em `subscribeToFirestore()` e guardados no objeto `unsub` pra unsub no logout.
- **Atualizações persistidas** usam `setDoc(..., { merge: true })` quando é patch, `addDoc` quando é nova linha de coleção. `serverTimestamp()` sempre pra `updatedAt`/`createdAt`.
- **Campos numéricos vindos do I10** sempre coagidos com `+value || 0` ou `parseFloat(value) || 0` porque a API devolve às vezes string, às vezes number, às vezes `null`.
- **Formatação de valores**: helpers `fmtBRL` (2 casas, "R$ 1.234,56"), `fmtBRL0` (sem centavos), `fmtBRLInput`, `formatDateTimeBR` em `public/js/app.js`. ⚠️ NÃO existe `fmtBRL2` (já me derrubou — use `fmtBRL`). Nunca usar `toLocaleString` cru na UI.
- **CSS em `public/index.html`** com tokens no `:root`. Não espalhar cores hex cruas — usar `var(--purple)`, `var(--ink-2)`, `var(--gain)`, etc. **Aliases** `--text` / `--text-dim` / `--text-faint` / `--border-soft` / `--card-border` / `--card-divider` / `--warn-soft` existem e apontam pra escala real (não remover — partes do código os referenciam). Regra de hierarquia: **número = Geist Mono + `--ink` + 700; rótulo/label = Inter + `--ink-2`/`--ink-muted` + ≤600** (não deixar nome e valor com mesmo peso/cor). Densidade desktop vive no `@media (min-width:1100px)`.
- **Layout responsivo**: `.page` é `max-width: 1320px` centralizado. O app é **desktop-first no uso** (apesar de PWA). Em `≥1100px` o módulo de Investimentos vira grid 2 colunas (`#moduleInvestments.active { display:grid }`); o hero de patrimônio e cards marcados com a classe `.dash-span` (ex: tabela de histórico anual, larga demais pra meia coluna) ocupam largura total via `grid-column: 1 / -1`. O módulo de Despesas já pareia cards via `.grid-2` interno, então só usa o container largo. Em `≤720px` tudo colapsa pra 1 coluna. Ao adicionar card novo no Investimentos: por padrão ele entra no fluxo 2-up; se for largo (tabela/gráfico full-bleed), marcar `.dash-span`.
- **XSS / escape**: todo valor de usuário ou da API do I10 (descrição/notas de despesa, nomes de conta, tickers, categorias) DEVE passar por `esc()` antes de entrar em `innerHTML`. Helper em `public/js/app.js` perto do `$`. Nunca interpolar string crua de Firestore/I10 em template de innerHTML.
- **Categorias de ativos**: `renderI10Assets` agrupa `state.i10.assets` pelo `.category` de cada ativo (NÃO depende de `state.i10.categories`, que vem vazio do worker). O helper `canonicalCategory(label)` normaliza acento + sinônimos pra um conjunto canônico (`CATEGORY_ORDER`/`CATEGORY_ICONS`/`CATEGORY_DISPLAY`). Ao adicionar nova classe de ativo, atualizar os 3 mapas + a regex do `canonicalCategory`.
- **Iconografia = SVG, nunca emoji.** Registro central em `const ICONS = { home, utensils, car, ... }` em `public/js/app.js`, cada entrada é uma string SVG 24×24 stroke-only (Lucide-style) montada pelo helper `_svg(paths)`. Todas têm `class="icn"` + `stroke="currentColor"` — containers aplicam a cor via `color: var(--cat-color)` e a SVG herda. Tamanho via `.icn { width/height: ... }` em cada contexto (tile, pill, badge). Emoji unicode é banido da UI (inclusive em `<option>`, toasts e tooltips) porque o rendering varia entre OS/navegador e rompe a densidade v7/v8.
- **Micro-interações de proximidade** (`initMicroFX()` em `public/js/app.js`): desktop-only, gated em `(pointer: fine)` + sem `prefers-reduced-motion`. (1) **Botões magnéticos** — CTAs (`btnSyncI10`, `btnAddExpense`, `btnAddIncome`, `btnAddContrib`, `btnAddYear`, `btnImportHistory`) ganham a classe `.magnetic` e "puxam" em direção ao cursor dentro de um raio de 95px (transform inline via rAF-throttled pointermove). (2) **Spotlight no hero** — o `::after` radial de `.hero-card`/`.exp-hero` segue o cursor via `--spot-x/--spot-y`; repouso volta pro default (canto sup. direito). Regra de ouro: **micro-interação nunca escala/desloca conteúdo que contém número** (legibilidade primeiro). Pra adicionar um CTA magnético novo: incluir o id no array `MAG_IDS`.
- **Animações respeitam `prefers-reduced-motion`** (bloco "v8 REDUCED MOTION" no CSS mata tudo quando ativo). Não adicionar animação sem respeitar isso.
- **Datas**: armazenar como ISO string `YYYY-MM-DD` (despesas) ou `serverTimestamp` (metadados). Sempre absolutas — nada de "3 dias atrás" persistido.
- **IDs de documento**: `dividendsYearly` usa o próprio ano como ID (`"2026"`). `expenses` e `contributions` usam ID auto do Firestore.
- **Erros visíveis, não silenciosos**: `showErrorPopup(title, err, {once, extra})` (perto do `showToast`) abre modal com título humano + detalhe técnico copiável. Fluxos que fazem trabalho e podem falhar devem chamá-lo no `catch` (ou ter rede global). `opts.once` deduplica por mensagem (use em loops/auto-sync pra não nag). Toast continua só pra feedback curto/humano.
- **`<label>` + controle interativo = cilada (iOS)**: nunca envolver um `<input type=checkbox>` **junto** com `<select>`/botões dentro do mesmo `<label>` — no iOS, mexer no select alterna o checkbox do label. Use `<div>` + handler de clique explícito que faz `e.target.closest('select') && return`. (Foi exatamente o bug "não deixa importar" da tela de revisão.)
- **Animação só em `transform`/`opacity` + cuidado com `backdrop-filter`**: animar `top`/`left`/`width` causa layout/paint por frame (trava, sobretudo no celular). `backdrop-filter` de **tela cheia** com coisas animando por cima re-borra o fundo a cada frame — evitar em overlay animado (preferir fundo quase opaco). Promova o elemento que se move com `will-change: transform`. (Lição da animação de import, v8 Turno 10.)
- **Dedup de import idempotente**: lançamentos importados carregam `fp` (fingerprint `impFp(date,value,desc)`) e `fpBase`. Pra evitar duplicar ao reimportar, conte ocorrências por `fpBase` no que já existe (multiset) e pule as primeiras N de cada base. Vale pra `doImport` E `autoSyncProventos` — os dois usam o **mesmo** `fp`, então auto e manual não se duplicam. Sempre verificar idempotência (rodar 2× → 2ª adiciona 0) antes de soltar auto-write em coleção compartilhada.
- **⚠️ Dedup DEPENDE de `state.expenses` já ter carregado** (bug real achado na auditoria de jun/2026): se `autoSyncProventos`/`doImport` rodam ANTES do 1º `onSnapshot` de despesas chegar, o `existCount` fica vazio → relança TUDO como duplicata (e dobra permanente, porque na próxima vez já existem 2 de cada). Guard: `state._expensesLoaded` (setado no listener de `expenses`) é checado no topo das duas funções; e o listener, no 1º load, re-dispara `autoSyncProventos()` caso um sync tenha rodado antes. **Qualquer auto-write que deduplica contra `state.X` tem que esperar `state.X` carregar.**

---

## 11. Coisas que NÃO devem acontecer

- ❌ **Nunca** expor o(s) walletId(s) em logs públicos, mensagens de erro voltadas ao usuário, screenshots em issues públicas, dashboards compartilhados. São carteiras pessoais.
- ❌ **Nunca** mexer em `worker/src/worker.js` sem testar localmente (`wrangler dev` ou equivalente) e validar contra a wallet real antes de publicar. Worker quebrado = os dois usuários ficam sem dashboard.
- ❌ **Nunca** adicionar dependência npm / build step / transpilação sem alinhar primeiro. O projeto é vanilla por decisão.
- ❌ **Nunca** rodar `tools/fix-historico.html` ou equivalentes destrutivos sem confirmação explícita do dono para essa execução específica. "Rodou outra vez" não autoriza rodar de novo.
- ❌ **Nunca** renomear coleções / caminhos Firestore (`household/main/...`) sem plano de migração. Os dados reais do casal estão lá.
- ❌ **Nunca** commitar arquivos com credenciais reais de outro serviço. A config do Firebase em `app.js:10` está ok (é client-side público, protegido por Rules) — mas **nada além disso**. Sem tokens de CF, chaves de API externas, secrets de worker.
- ❌ **Nunca** assumir que a API do I10 é estável. Se um campo mudar, parse defensivo (`|| 0`, `|| ''`, `Array.isArray(...)`) precisa continuar funcionando e o app tem que degradar pro botão ✏️ manual, não quebrar.
- ⚠️ **Erros: nunca falhar calado.** Atualizado jun/2026 (pedido do dono): falha que pararia uma ação **tem que aparecer**. Os **toasts** seguem humanos (texto curto, sem stack). Mas falhas que antes morriam num `console.warn` silencioso agora usam `showErrorPopup(title, err)` — **título humano + detalhe técnico copiável** (mensagem/stack) pra debug, já que é app pessoal do casal. Use a rede global (`unhandledrejection`/`error`) e os popups nos fluxos críticos (import, sync). O que NÃO fazer: enfiar string técnica crua num **toast** (use o popup), ou engolir erro sem nenhum sinal visível.
- ❌ **Nunca** deletar docs do Firestore sem passar por um fluxo de UI que o usuário dispare explicitamente. Sem "limpeza automática" de dados.
- ❌ **Nunca** mudar a paleta / tipografia / spacing sem contexto de design. A linguagem visual é `v7`/`v8` — edições pontuais sim, virada de estilo só em conversa explícita.
- ❌ **Nunca** ignorar `prefers-reduced-motion` em animação nova. É acessibilidade, não opcional.
- ❌ **Nunca** remover o early auth guard (`app.js:24-36`) — ele existe porque o main app às vezes trava e sem ele o login fica preso.
- ❌ **Nunca** commitar mudança de schema, feature visível, padrão técnico, pessoa/email/UID ou walletId **sem atualizar o `.md` correspondente NO MESMO commit**. Ver regra operacional em §9.8. Docs desatualizados contaminam sessões futuras com informação errada.
- ❌ **Nunca** colocar emoji unicode (🏠 ✓ ⚠ ♥ 📱 etc.) em nenhum ponto da UI — `<option>`, toast, tooltip, botão, label, copy, header. Renderização de emoji depende de OS/navegador (Windows desenha diferente do iOS, etc.) e quebra a consistência v7/v8. Use SVG do registro `ICONS` (ou adicione uma nova chave lá). Se a mensagem precisa de símbolo de status, injete SVG via `innerHTML` (ex: toast não faz isso ainda — deixa só a cor comunicar).

---

## Apêndice — quick reference

- **Repo local**: `C:\Users\willi\Documents\projects\vergara-schulz-wealthy-tracker\`
- **Main branch**: `main`
- **Worker URL**: `https://ledger-i10-proxy.<sub>.workers.dev` (configurada no app pelo modal ⚙️, persistida em `config/i10sync.workerUrl`)
- **App URL**: `https://ledger-schulz.web.app` (Firebase Hosting, principal) + GitHub Pages (backup)
- **Firebase project ID**: `wealthy-tracker-68658`
- **Entrypoint**: `public/index.html` → importa `public/js/app.js` (ES module, único arquivo JS do app)
- **Deploy do worker**: `wrangler deploy` ou colar no dashboard do Cloudflare Workers
- **Deploy do app**: **GitHub Pages** (backup) auto-publica no push (`pages.yml`). O **`.web.app` principal** sai por `firebase deploy --only hosting --project wealthy-tracker-68658` (manual, CLI logada no PC do dono) — o Action `firebase-hosting.yml` só publica se o secret `FIREBASE_SERVICE_ACCOUNT` existir. ⚠️ `git push` NÃO atualiza o `.web.app`. Setup em `docs/DEPLOY-HOSTING.md`
