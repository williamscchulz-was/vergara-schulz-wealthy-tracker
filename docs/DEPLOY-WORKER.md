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
4. Wallet ID: `2814459` (ou outro)
5. Salvar → dispara sync automático

## Smoke test

```bash
curl 'https://ledger-i10-proxy.<SEU-SUB>.workers.dev/i10/all/2814459?year=2026'
```

Esperado: JSON com `metrics`, `earnings`, `actives`, `fetchedAt`.

## Dev local

```bash
cd worker
wrangler dev
# abre http://localhost:8787/i10/all/2814459?year=2026
```

## Cron — sync diário às 8h (grava no Firestore)

O worker tem um `scheduled()` handler que roda **08:00 BRT** todo dia,
busca o I10 (William + Louise) + cotação USD e grava em `config/i10`,
`config/i10-louise`, `config/fx` — **sem ninguém abrir o app**. Pra isso
ele autentica como admin do Firebase via uma **service account**.

### Setup (uma vez)

**1. Criar a service account no Firebase**
1. https://console.firebase.google.com → projeto `wealthy-tracker-68658`
2. ⚙️ (engrenagem) → **Configurações do projeto** → aba **Contas de serviço**
3. Botão **Gerar nova chave privada** → baixa um arquivo `.json`
4. Abre o `.json` num editor de texto e copia **todo o conteúdo**

**2. Adicionar o secret no Cloudflare**
1. dash.cloudflare.com → Workers & Pages → `ledger-i10-proxy`
2. **Settings** → **Variables and Secrets** → **Add**
3. Tipo: **Secret** (encrypted). Nome: `FIREBASE_SA`
4. Valor: cola o JSON inteiro da service account
5. Save

**3. Adicionar o Cron Trigger**
1. Mesma página → **Settings** → **Triggers** → **Cron Triggers** → **Add Cron**
2. Cron: `0 11 * * *`  (11:00 UTC = 08:00 BRT)
3. Save

**4. Redeploy do código** (se ainda não fez com a versão que tem o
`scheduled`): cola o `worker/src/worker.js` atual no editor e Save and
deploy.

### Testar
- No dashboard do worker, aba **Triggers** → ao lado do cron tem
  **"Trigger"** (ou rode `wrangler tail` e dispare). Veja nos logs
  `cron sync OK`.
- Depois, no app, o "atualizado" dos cards deve mostrar o horário do
  cron com `updatedBy: cron 8h`.

### Segurança
- A `FIREBASE_SA` é um secret **encriptado** no Cloudflare — não vai pro
  repo, não aparece no código. É a única credencial sensível do sistema.
- Ela dá acesso de admin ao Firestore. Se vazar, **revogar** no Firebase
  Console (Contas de serviço → gerenciar chaves → deletar).

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
