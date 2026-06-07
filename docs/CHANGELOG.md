# Changelog

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/).
Datas em `YYYY-MM-DD`.

## [Unreleased]

### Auditoria profunda do import — race condition corrigida (2026-06-06)
- **Bug real (dobra de proventos):** `autoSyncProventos`/`doImport` deduplicam
  contra `state.expenses`. Se rodassem ANTES do 1º snapshot de despesas chegar
  (ex.: auto-sync 3s pós-login com rede lenta), o `existCount` ficava vazio e
  **relançava todos os ~381 proventos como duplicata** (dobra permanente).
  Guard: flag `state._expensesLoaded` (setada no listener), checada no topo das
  duas funções; o listener re-dispara o auto-sync no 1º load se um sync correu antes.
- Parse de arquivo que falha agora abre o **popup de erro** (com detalhe), não
  só um toast genérico.
- Auditado e OK: parsers à prova de NaN (`isFinite`/`parseBRMoney`/`||0`),
  `data-idx` sobrevive ao reagrupamento por mês, todas as linhas têm os selects,
  fingerprint manual == auto (cross-dedup), guessers sem caminho de crash.

### Bloco import + erros visíveis (2026-06-06) — v8 Turno 10
- **Animação de import suavizada**: tirado o `backdrop-filter: blur(14px)` de
  tela cheia do `.imp-overlay` (re-borrava o fundo a cada frame → travava no
  celular) por um fundo quase opaco; `.imp-scan` passou a animar
  `transform: translateY` (GPU) em vez de `top` (layout/paint) + `will-change`.
- **"Selecionar todos"** na tela de revisão (`#impSelectAll`): marca/desmarca
  as linhas visíveis (respeita a aba de mês), com estado indeterminate.
- **Ordenação na tabela de despesas**: cabeçalho clicável (Data/Descrição/
  Categoria/Valor), asc↔desc, seta na coluna ativa (`_expSort`/`expCompare`).
- **Auto-sync de proventos I10 → Ganhos** (`autoSyncProventos`): cada
  `syncFromI10` lança automaticamente os proventos já pagos (líquido) nos
  Ganhos, sem clicar. Dedup multiset (mesmo `fp` do import manual) →
  idempotente (verificado na carteira real: 1ª roda 381, 2ª/3ª 0).
- **Bug "não deixa importar" corrigido + blindagem**: a linha de revisão virou
  `<div>` (era `<label>` que, no iOS, desmarcava ao mexer no select) + clique
  que ignora os selects; `doImport` inteiro em try/finally → o botão
  "Importar" nunca mais trava em disabled. Categorias customizadas auditadas
  (sem `undefined`/throw).
- **`showErrorPopup`**: falha agora aparece num modal (título humano + detalhe
  técnico copiável) em vez de morrer calada. Plugado em import/proventos +
  rede global (`unhandledrejection`/`error`, deduplicada).

### Modal FX consertado + sweep de luz no sync (2026-06-01)
- O modal de USD (FX) estava quebrado: usava classes que não existem
  (`.modal-head/.modal-title/.modal-close/.modal-body/.modal-label`) e
  `display:grid` inline em vez do `.show`. Reescrito pro padrão que
  funciona (`.modal-bg.show` + `h3`/`.sub`/`.field`/`.modal-foot`),
  abre/fecha certo, com i18n (`fx.*`).
- **Sweep de luz** one-shot no hero quando o sync I10 completa (classe
  `.sweeping` + `@keyframes hero-sweep`) — junto com o count-up, dá o
  "uau" no momento do sync.

### Glamour Pass 2/3 — count-up, nav estática/top-nav, atalhos (2026-06-01)
- **Count-up nos números**: `countUpEl()` (rAF, ease-out, memo em
  `el._cuVal`, respeita prefers-reduced-motion) anima o patrimônio do
  hero (`#i10Equity`) e o saldo do mês (`#expHeroAmt`) de onde estavam
  até o novo valor — o "delight" pedido, sem ficar re-animando à toa.
- **Nav sem "ilha que balança"**: removida a animação `island-float`
  (a tab bar não boia mais). No **desktop (≥720px)** ela vira um
  **top-nav estático** abaixo do header (`position:static`, sem o
  padding-bottom de 140px) — fim do padrão mobile no PC.
- **Atalhos de teclado** (desktop, ignora quando digitando ou com modal
  aberto): `/` foca a busca · `N` nova despesa · `1`/`2` troca
  Investimentos/Despesas · `←`/`→` navega o mês.
Faltam do Pass 2/3: sweep de luz no sync, cascata universal nas listas,
Despesas em 2 colunas.

### Importador de fatura do cartão (PDF) — v1 (2026-06-01)
A feature mais pedida saiu do mock pro app. Botão **"Importar fatura"** na
aba Despesas → escolhe o PDF do extrato → revisa → grava em lote.
- **Lê o PDF no navegador** via PDF.js (CDN, import dinâmico/lazy — não
  pesa no load inicial; o PDF nunca sobe pro servidor).
- **Parser Bradesco**: agrupa os text-items por linha (Y), regex
  `DD/MM + descrição + R$`, detecta parcela `X/Y`, estorno (negativo),
  pula SALDO/PAGTO/TOTAL/IOF/encargos.
- **Palpite automático**: "de quem" em camadas (kids→Louise,
  casa→Família, estética→Flávia, barbearia→William, senão o portador) +
  categoria por palavra-chave. Tudo editável por `<select>` na revisão.
- **Anti-duplicata**: fingerprint `data|valor|descrição`; reimportou o
  mesmo lançamento → pula. Grava com `source: 'import:cartao'`, `fp`,
  nota com cartão+parcela.
- i18n PT/EN (`imp.*`). **v1**: ainda sem a animação de leitura, memória
  que aprende e provisão de parcelas — próximos incrementos.
- ⚠️ A extração via PDF.js depende do layout do PDF; testar com o extrato
  real (o dono faz o 1º teste logado).

### UI estática + destaque do "+ Ganho" + idioma (2026-06-01)
Pedidos do dono: "esse mundo que fica se mexendo não é legal, deixa
estático"; o "+ Ganho" precisa chamar mais atenção; e "o idioma está
bugado".
- **Estático**: `initMicroFX()` desligado (early return) — acabaram os
  CTAs magnéticos (que faziam "+ Ganho"/"+ Nova despesa" se sobrepor no
  hover) e o glow que seguia o cursor. Animação de drift do fundo
  (`body::after`) removida — fundo parado.
- **"+ Ganho"**: estava cinza por um bug de cascata (`.btn-ghost` na
  linha 1847 sobrescrevia o verde de `.btn-add-income`). Corrigido com
  seletor composto `.btn-ghost.btn-add-income` + verde reforçado (gain
  16%/45%, weight 700, glow sutil) — agora chama atenção como ação
  positiva.
- **Idioma**: auditoria multi-agente concluiu que o dicionário está
  saudável (236 chaves PT/EN simétricas) — o "bug" é texto chumbado que
  não passa por `t()`. `applyI18n()` agora também traduz `data-i18n-title`
  (tooltips) e `data-i18n-aria`. Os botões Cancel/Save/Delete/Close de 6
  modais (I10, config, reserva, previdência, ano, aporte, FX) estavam em
  inglês chumbado no modo PT → mapeados pras chaves `exp.btn.*` (nova:
  `exp.btn.close`). Pendente do sweep: rótulos de categoria (`CATEGORIES`)
  e toasts hardcoded em JS.

### "De quem é o gasto" — William / Flávia / Louise / Família (2026-06-01)
Pedido da Flávia: o lançamento precisa atribuir o gasto a mais gente que
só W/F/Conjunto. Expandido pra **4 opções** (picker 2×2): William (cyan),
Flávia (pink), **Louise** (verde), **Família** (roxo).
- Legado `joint` (W+F) normalizado pra `familia` na exibição/edição
  (`normOwner()`), sem migração de dados — entradas antigas viram Família.
- i18n PT/EN, chip do extrato, CSS (claro/escuro) e `setModalOwner`
  cobrindo os 4; `const OWNERS` é a fonte canônica.
- É **manual** (a Flávia escolhe) — "de quem é o gasto" ≠ "quem pagou"
  (esse vem do cartão na importação).
- Fundação pro importador de fatura. Próximo na trilha de Despesas:
  fixa×variável, parcelamento com provisão futura, dívidas/financiamentos.

### Desktop-first + hierarquia & glamour — Pass 1 (2026-06-01)
Auditoria multi-agente (5 dimensões: layout, navegação, interação,
densidade, hierarquia/glamour) → primeira leva de correções, **tudo CSS**:
- **Tokens fantasma definidos**: `--text`, `--text-dim`, `--text-faint`,
  `--border-soft`, `--card-border`, `--card-divider`, `--warn-soft` eram
  referenciados no CSS/markup mas **nunca declarados** → bordas/divisórias
  renderizavam transparentes e texto faint perdia a cor (raiz da
  "hierarquia fraca / tudo flutua"). Agora apontam pra escala real via
  `var()` (adapta ao tema claro automaticamente).
- **Hierarquia**: número do hero agora é Geist Mono (era Inter — o único
  número grande não-mono); `.cat-name` recua (13px/`--ink-2`) e
  `.cat-value` domina (15px/700/`--ink`) → a linha ganha âncora; eyebrows
  e labels uppercase → `--ink-muted` pra recuar.
- **Glamour**: `.hero-card` ganha gradiente roxo sutil + borda de acento
  (`--border-strong`) pra finalmente dominar; clamp do número re-escala
  melhor no desktop (`5.2vw`/`4.8vw`, cap 60/56).
- **Desktop**: `.page` 1320 → **1500px** (1680 em ≥1760px); grid de
  Investimentos com `minmax(0,1fr)` + auto-span via `:has()` pra
  tabelas/charts largos; bloco de **densidade desktop** (padding e linhas
  mais justos ≥1100px); Despesas com largura contida (1240px).

Próximo (Pass 2): count-up nos números, sweep de luz no sync, cascata
universal nas listas, top-nav no desktop (tab bar é padrão mobile), fix
do modal FX (usa classes inexistentes), `:focus-visible` + atalhos de
teclado.

### Firebase Hosting — URL `.web.app` (2026-06-01)
O app agora também publica no Firebase Hosting, com URL bonita
`https://ledger-schulz.web.app` (vira a principal). GitHub Pages segue
no ar como backup.

- `firebase.json` ganha bloco `hosting` (raiz `public/`, site
  `ledger-schulz`, `Cache-Control: no-cache` em html/js/css pra update
  instantâneo, cache de 1 dia em imagens).
- Novo workflow `firebase-hosting.yml`: deploy automático do `public/`
  no canal `live` a cada push (action `FirebaseExtended/action-hosting-deploy`,
  secret `FIREBASE_SERVICE_ACCOUNT`).
- Domínios `*.web.app` / `*.firebaseapp.com` já são autorizados no
  Firebase Auth → login Google funciona na URL nova sem config.
- Setup manual (uma vez): criar o site no console, pôr o secret no
  GitHub. Passo a passo em `docs/DEPLOY-HOSTING.md`.

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

### Cron diário às 8h BRT (worker → Firestore) — PARKED (não ativado)
> **Status:** código no repo, gatilho **desligado** (`crons` comentado no
> `wrangler.toml`). O auto-sync ao abrir o app já mantém tudo fresco;
> ligar o cron é opcional (ver `DEPLOY-WORKER.md`). Decisão do dono.

O auto-sync client-side só roda quando alguém abre o app. Pra atualizar
de verdade todo dia 8h sem ninguém abrir, o worker ganhou um Cron
Trigger que grava direto no Firestore.

- `scheduled()` handler no worker + `crons = ["0 11 * * *"]` (11 UTC =
  8h BRT) no `wrangler.toml`.
- Autentica como admin via service account do Firebase: JWT RS256
  assinado com Web Crypto → token OAuth (`oauth2.googleapis.com`) →
  Firestore REST API (PATCH com `updateMask` pra merge). A chave fica
  num secret encriptado do Cloudflare (`FIREBASE_SA`), nunca no repo.
- Escreve `config/i10` (equity, dividends, assets c/ categoria, monthly
  120m, profitTwr...), `config/i10-louise` e `config/fx` (rate via
  updateMask, preserva `usd`/`note` do usuário). `updatedBy: 'cron 8h'`.
- Como grava `config/i10.monthly`, o patrimônio por ano (derivado do
  barchart) também fica fresco via cron.
- **Setup manual necessário** (uma vez): criar service account no
  Firebase, colar como secret `FIREBASE_SA` no CF, adicionar o Cron
  Trigger no dashboard. Passo a passo em `docs/DEPLOY-WORKER.md`.

### Patrimônio por ano agora vem AO VIVO do I10 (barchart 120 meses)
Confirmado que `/summary/barchart/2814459/120/all` devolve os 10 anos
completos com `sum_equity` real (anonimamente). A solução definitiva:
derivar o patrimônio de fim de ano direto do barchart a cada Sync —
sem gravar no Firestore, então impossível de apagar.

- **Worker**: `/i10/all` passa a buscar `/barchart/.../120/all` (era 12),
  com fallback pra 12 se o range longo falhar. **Requer redeploy.**
- **App**: `parseI10Barchart` popula `state.i10.monthly` com ~70 meses.
  `derivedYearEndEquity(year)` pega o último mês de cada ano. `yearEquity`
  resolve com precedência: Firestore manual > derivado do barchart >
  `HISTORICAL_EQUITY` (fallback). Card de rentabilidade fatia os últimos
  13 meses pra não inflar.
- `HISTORICAL_EQUITY` corrigido pros valores reais de Dezembro (eram
  arredondados/errados: 2024 e 2025 estavam ~73-80k off).

Diagnóstico: o worker deployado ainda era a versão antiga do `/i10/yearly`
(equity hardcoded null) — o teste `/i10/yearly` voltava null em todo ano
mesmo com o barchart funcionando. O novo caminho (derivar do `/i10/all`)
elimina a dependência do botão "I10" e do Firestore pra esse dado.

### Net worth por ano blindado contra wipe (fallback embutido)
O patrimônio histórico (2020-2025) sumiu de novo — `renderPLChart` filtra
`equity > 0` e os anos antigos ficaram null/0 no Firestore. Em vez de
depender de um restore manual que pode ser sobrescrito, os valores reais
de fim de ano viraram constante no código (`HISTORICAL_EQUITY`):

- `yearEquity(y)`: usa o equity do Firestore se houver (> 0), senão cai
  pro mapa embutido. Edição manual via "+ Year" continua tendo
  prioridade (vence o fallback).
- Aplicado em `renderPLChart` (gráfico) e `renderYearlyTable` (tabela).
- Resultado: o gráfico de patrimônio por ano mostra 2020→2026 SEMPRE,
  imutável a qualquer sync/import. Zero ação do usuário.

Nota: o I10 **tem** o histórico de 10 anos na própria UI (toggle "10
Anos"), mas a chamada do worker pro barchart longo (`/120/all`) vinha
falhando pra carteira nova e devolvendo equity null. O fallback resolve
o sintoma de forma definitiva; puxar o barchart longo de verdade fica
como melhoria futura (precisa achar o endpoint certo no Network do I10).

### Micro-interações de proximidade (design-engineering polish)
Inspirado no padrão "dock proximity" (responder à distância do cursor,
não só hover binário). Curado pra um dashboard financeiro — nada que
escale/desloque números:

- **Botões magnéticos** (`initMicroFX()`): os CTAs (Sync, +Nova despesa,
  +Ganho, +Aporte, +Year, Import I10) "puxam" suavemente em direção ao
  cursor dentro de um raio de 95px. Transform inline via pointermove
  throttled em rAF; retorno suave via transição. Classe `.magnetic`.
- **Spotlight no hero**: o brilho radial de `.hero-card` e `.exp-hero`
  segue o cursor (`--spot-x/--spot-y`), em vez de glow estático. Repouso
  volta pro canto superior direito. Os estados saldo+/− do exp-hero
  também acompanham (verde/vermelho).
- **Press feedback** consistente: `.btn-primary:active` ganhou
  `scale(0.96)` (faltava; outros botões já tinham).
- Tudo gated em `(pointer: fine)` + sem `prefers-reduced-motion` —
  desliga no mobile/touch e pra quem pede menos movimento.

Mecânica validada via preview (magnético: cursor a 28px → translate
7px/4.8px; spotlight seta --spot-x). O efeito em si só roda em desktop
com mouse (o headless do preview não tem pointer fine).

### Layout desktop: de coluna mobile pra dashboard 2 colunas
O app parecia mobile no desktop — `.page` era `max-width: 980px`, então
num monitor de 1680px sobravam ~686px (41%) vazios e tudo ficava numa
coluna estreita empilhada. Como o uso real é desktop, virou dashboard:

- `.page` max-width 980 → **1320px**.
- `@media (min-width: 1100px)`: `#moduleInvestments.active` vira
  `display:grid` 2 colunas. Hero de patrimônio + a tabela de histórico
  anual (classe nova `.dash-span`) ocupam largura total; goal, YTD,
  carteira, dividendos, PL, rentabilidade e aportes fluem lado a lado.
  Margem de card zerada dentro do grid (gap cuida do espaçamento).
- Despesas: já pareia cards via `.grid-2` interno → só herda o container
  largo (stats 3-col, pares categoria|recentes e trend|recorrentes
  preenchem 1320px).
- `≤720px` continua colapsando tudo pra 1 coluna (mobile intacto).

Validado em viewport 1680px: módulo em grid 2×623px, hero 1264px full,
container 1320px.

### Restore de equity histórico executado + tool removida de produção
Os patrimônios de fim de ano 2020-2025 (zerados pelo incidente do import
I10) foram restaurados via `restore-equity.html` com os valores do
histórico do próprio usuário. O gráfico "net worth por ano" voltou
completo (2020-2026). A página foi servida temporariamente de `public/`
(porque `tools/` não vai pro GH Pages) e agora foi **removida de
produção** — continua em `tools/restore-equity.html` pra uso pontual
futuro (rodar local ou copiar pra public/ de novo se precisar).

Os valores de net worth pré-2025 NÃO existem na API do I10 pra a wallet
nova (2814459) — confirmado `equity: null` em todos os anos no
`/i10/yearly`. Por isso o restore manual é a fonte canônica desses anos.

### Aporte ganha campo de descrição (+ modal traduzido)
- Novo campo `note` (opcional, livre) no aporte — pra anotar pra onde
  foi (ex: "ITSA4", "Tesouro IPCA", "aporte XP"). Persiste em
  `contributions.{id}.note`.
- Aparece: na lista do mês (modal de detalhe) sempre; na lista principal
  inline quando o mês tem 1 aporte só (escapado via `esc()`).
- De quebra, traduzido o modal que estava em inglês ("Monthly
  contribution"→"Aporte mensal", "Year"→"Ano", botões Cancel/Save/Delete).

### Fix: aporte não salvava ("20.000" virava 20 ou NaN) + parse BRL
O modal de aporte usava `type="number"` + `parseFloat` cru. Digitar
"20.000" (vinte mil, ponto de milhar BR): em `type=number` algumas
combinações de locale resultavam em valor vazio → NaN → "Valor inválido"
→ não salvava. Onde salvava, `parseFloat('20.000')` = 20.

Além disso, o próprio `parseBRLInput` tratava ponto único como decimal,
então "20.000" → 20 mesmo no campo de despesa.

Correções:
- `parseBRLInput`: heurística BR-correta pro caso "só pontos" — se o
  segmento após o último ponto tem exatamente 3 dígitos, todos os
  pontos são separador de milhar ('20.000'→20000, '1.234.567'→1234567);
  senão o último ponto é decimal ('12.50'→12.5). Beneficia despesas E
  aportes.
- Campo de aporte: `type=text inputmode=decimal` + máscara BRL no blur +
  Enter pra salvar + prefill com `fmtBRLInput` na edição (mesma UX do
  campo de valor de despesa).
- `saveContrib` usa `parseBRLInput` em vez de `parseFloat`.

Validado: 12 formatos de entrada parseiam corretamente.

### Fix: "Total recebido all-time" excluía o ano corrente
O card somava só `dividendsYearly` (anos passados), deixando os
proventos YTD do ano corrente de fora — mostrava R$ 117.682 quando o
I10 contava ~R$ 182.883. Agora `allTime = soma(anos < ano corrente) +
state.i10.dividends` (YTD do ano corrente, vindo do sync). Filtra o ano
corrente do `dividendsYearly` pra não duplicar.

NOTA: pra bater 100% com o I10 ainda é preciso re-importar os valores
reais por ano (botão "I10" no card Histórico anual) — os `divs`
seedados originalmente não conferem com os registros reais do I10.

### Auditoria — lote 4 (limpeza final: confirm modais + código morto)
- **`confirm()` nativo → modal custom** nos 4 lugares restantes (excluir
  conta de reserva/previdência, aporte ×2, ano de histórico). Todos
  usam `openConfirmModal` agora, consistente com o delete de despesa e
  funcionando no PWA do iOS.
- **`renderFX()` removido** — estava morto E nocivo: referenciava ids
  inexistentes (`fxUsdNative` etc.) e lançava erro quando a taxa do USD
  mudava com o card já renderizado, bloqueando o `renderInvestments()`
  seguinte. O USD já é renderizado por `renderI10Assets`. Listener de FX
  agora chama `renderInvestments()` direto.
- **Modal órfão `#goalEditModal` removido** do HTML (zero referências em
  JS — a meta é editada pelos sliders inline).
- **Branch morta `usedFull`** removida do `syncFromI10` (nunca era true;
  referenciava `payload.yearly` que o worker não envia).
- Toast técnico ("Erro ao salvar: " + code) em `saveContrib` trocado por
  `t('toast.error.save')`.

### Segurança: regras Firestore confirmadas OK + repo sincronizado
A auditoria flagou as regras como CRÍTICO porque o `firestore.rules` do
repo tinha `REPLACE_WITH_*_UID`. Verificado no console: as regras
**deployadas estão corretas** — restringem a 2 UIDs reais (William +
Flávia), todo o resto negado. Era falso alarme (arquivo do repo
desatualizado, não a regra no ar). Sincronizado o `firestore.rules` do
repo pra refletir exatamente o que está deployado, pra futuros
`firebase deploy` não regredirem. UIDs do Firebase Auth não são
credenciais — podem viver no repo (diferente de walletIds).

### Auditoria — lote 3 (design / mobile / tema claro)
- **Charts espremidos no mobile** (UX #3): os 3 SVGs com texto
  (`expDailyChart`, `expTrendChart`, `mrChart`) usavam
  `preserveAspectRatio="none"` + altura fixa → texto distorcido no
  celular. Trocado pra `xMidYMid meet` + `height:auto` +
  `aspect-ratio`, escalando uniforme sem deformar.
- **Net-worth pill** (Design): número agora em `Geist Mono` (estava
  herdando Inter, inconsistente com todo o resto monetário).
- **Owner chips ilegíveis no tema claro** (Design HIGH): texto azul/rosa
  claro em card branco. Adicionados overrides `data-theme="light"` com
  tons escuros pros chips W/F/Conjunto e pro segmented control.
- **reduced-motion incompleto** (Design HIGH): elementos que animam de
  `opacity:0`/`scaleX(0)` com `forwards` (linhas de extrato, barras de
  categoria) agora são forçados a `opacity:1`/`scaleX(1)` sob
  reduced-motion — sem risco de ficarem invisíveis.
- **Instrument Serif** (Design MEDIUM): era referenciada em 5 lugares
  mas nunca carregada (fallback serif genérico). Adicionada ao link do
  Google Fonts (`ital@0;1`).

### Auditoria — lote 2 (timezone, i18n PT, error copy)
- **Bug de timezone** (robustez M2): datas de despesa são `YYYY-MM-DD`;
  `new Date()` parseava como UTC-meia-noite → em BRT (UTC-3) a despesa
  do dia 1 caía no mês anterior. Novo helper `parseLocalDate()` usado em
  `formatDateBR`, `monthKey`, `filterExpensesByMonth`, daily/trend/recurring
  charts e sorts. Validado no sandbox UTC-3: `2026-05-01` antes virava
  30/abril, agora fica 1/maio.
- **Inglês vazando no dicionário PT** (UX #1): `hero.manual`,
  `years.singular/plural`, `loading`, `goal.status.*`, todos os `toast.*`,
  e as 5 frases `goal.phrase.*` estavam em inglês no bloco PT. Traduzidos.
  Chip da Louise ("not yet synced"/"updated") agora via `t()`.
- **Error copy** (UX #2/#5): toasts de falha de sync/import deixam de
  vazar `err.message`/`HTTP 502` e mostram mensagem humana. Erro de login
  mapeia códigos Firebase conhecidos pra PT; código cru fica só no console.

### Auditoria multi-agente — correções P0/P1 (lote 1)
Auditoria completa (5 agentes: segurança, funcional, UX, design, robustez).
Vários bugs foram corroborados por 2+ agentes independentes. Este lote
corrige os críticos app-side (sem redeploy de worker):

- **Card "Minha carteira" renderizava vazio** (corroborado por 2 agentes).
  `renderI10Assets` dependia de `state.i10.categories`, que é sempre `[]`
  (o worker `/i10/all` nunca retorna `diversification`). Reescrito pra
  agrupar `state.i10.assets` pelo `.category` de cada ativo, via novo
  helper `canonicalCategory()` que normaliza acentos/sinônimos das 3
  vocabulários divergentes (I10_TYPE_TO_CAT, inferCategory, legacy) pra
  um conjunto canônico. Agora todas as classes aparecem (Ações, Tesouro,
  Renda Fixa, FIIs, ETFs, BDRs, Cripto), cada uma expansível com seus
  tickers. Estado de expand persiste em `_expandedCats` entre re-renders.
- **Rentabilidade mês a mês ignorava dividendos**. `computeMonthlyReturns`
  lia `y.amount` mas o campo é `y.divs` → divs sempre 0 no total return.
  One-liner.
- **XSS armazenado**: novo helper `esc()` (escape HTML) aplicado em todos
  os sinks de `innerHTML` com dados de usuário/API — descrição e notas de
  despesa, nomes de conta (reservas/previdência), tickers e categorias do
  I10. Fecha o vetor onde um texto malicioso salvo executava pros dois
  usuários via onSnapshot.
- Adicionado `BDRs` a CATEGORY_ORDER/ICONS/DISPLAY.

Pendências da auditoria ainda NÃO corrigidas (próximos lotes): regras
Firestore com placeholders (precisa confirmação do dono sobre o que está
deployado), inglês vazando no dicionário PT, bug de timezone em datas
(dia 1 cai no mês anterior em BRT), charts espremidos no mobile, owner
chips ilegíveis no tema claro, reduced-motion incompleto, `confirm()`
nativo em 4 lugares, toasts técnicos ("HTTP 502").

### Auto-sync mais agressivo + atualiza TUDO
User reportou que abria o app e nada atualizava, e que só algumas
coisas estavam no auto-sync. Dois ajustes:

- **Threshold 12h → 1h**. Antes: abria o app de manhã e tarde, só
  uma sync rodava no dia. Agora: cada visita após 1h dispara sync
  automática. Combinado com o cache de 5min do worker, custo de
  upstream API é desprezível.
- **Yearly history entra no piggyback**: o `syncFromI10` agora chama
  `importHistoryFromI10({ silent: true })` (sem toast, logado no
  console). Throttled internamente a 24h (`AUTO_YEARLY_INTERVAL_HOURS`)
  porque o `/i10/yearly` faz N upstream calls (1 por ano) e os anos
  passados não mudam.
- `importHistoryFromI10` ganha opção `{ silent: true }` que suprime
  toast + UI de loading no botão.

Resultado: cada sync (auto ou manual) refresca: metrics, earnings YTD,
actives todas as classes, barchart 12m, Louise, USD-BRL, **e** o
histórico anual quando faz mais de 24h.

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
