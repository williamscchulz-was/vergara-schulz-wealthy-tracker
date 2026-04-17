# Firestore Schema

Projeto: **`wealthy-tracker-68658`**. Tudo fica sob `household/main/...`
(a casa é compartilhada entre W e F).

## Coleções

### `/household/main/expenses/{autoId}`

Despesas do mês.

| Campo | Tipo | Descrição |
|---|---|---|
| `date` | string | ISO `YYYY-MM-DD` |
| `value` | number | BRL (⚠ nome do campo é `value`, não `amount`) |
| `category` | string | chave de `CATEGORIES` em `public/js/app.js` |
| `description` | string | livre |
| `notes` | string | opcional, livre (hoje não é exibido na UI) |
| `createdBy` | string | displayName do usuário que lançou |
| `updatedBy` | string | displayName do último a editar |
| `createdAt` | timestamp | serverTimestamp |
| `updatedAt` | timestamp | serverTimestamp (em edições) |

### `/household/main/dividendsYearly/{year}`

Total de dividendos recebidos por ano. **ID do doc = ano como string**
(`"2020"`, `"2021"`, ...).

| Campo | Tipo |
|---|---|
| `year` | number |
| `amount` | number |
| `createdAt` / `updatedAt` | timestamp |

### `/household/main/contributions/{autoId}`

Aportes mensais.

| Campo | Tipo |
|---|---|
| `year` | number |
| `month` | number (1-12) |
| `amount` | number |
| `createdBy`, `createdAt`, `updatedAt` | — |

## Documentos de configuração

### `/household/main/config/settings`
`lang`, `theme`, `updatedAt`.

### `/household/main/config/i10`
Snapshot da carteira do W sincronizada do Investidor 10.
Campos: `equity`, `applied`, `variation`, `profitTwr`, `dividends`,
`year`, `assets[]`, `categories[]`, `tickerCategories{}`, `updatedAt`,
`updatedBy`, `source`.

### `/household/main/config/i10-louise`
Idem pra carteira da F (walletId `2699282`).
Campos: `equity`, `applied`, `variation`, `dividends`, `year`,
`updatedAt`, `updatedBy`, `source`.

### `/household/main/config/i10sync`
Config compartilhada do sync.
Campos: `workerUrl`, `walletId`, `publicHash`.

### `/household/main/config/fx`
Cotação USD→BRL + holdings em dólar.
Campos: `usd`, `rateUSD`, `rateUpdatedAt`, `rateSource`, `note`.

### `/household/main/config/reserves`
Contas correntes / poupança.
Campos: `accounts: [{ id, name, bank, amount, ... }]`, `updatedAt`,
`updatedBy`, `seeded`.

### `/household/main/config/pension`
Previdência privada (Bradesco default).
Campos: `accounts: [...]`, `updatedAt`, `updatedBy`, `seeded`.

### `/household/main/config/userPrefs`
Preferências por usuário. Map indexado por UID.
```
{
  [uid]: {
    defaultMode: 'expenses' | 'investments',
    updatedAt
  }
}
```
Persistido automaticamente sempre que o usuário troca de aba via
`switchMode()`. O login lê este doc (getDoc one-shot) pra decidir a
aba inicial; se o UID ainda não tem entry, cai no fallback por email
(`KNOWN_PRIMARY_EMAIL` em `public/js/app.js` → investments, qualquer
outro UID → expenses).

### `/household/main/config/budgets`
Orçamento mensal por categoria de despesa.
Campos:
- `categories`: `{ [catKey]: number }` — limite em BRL por categoria
  (apenas categorias em `CATEGORIES` de `app.js`; valores <= 0 são
  tratados como "sem limite")
- `updatedAt`, `updatedBy`

### `/household/main/config/goalParams`
Meta de dividendos anuais.
Campos: `dividendsYearlyGoal`, `dividendsYearlyGoalYear`,
`monthlyContribution`, `expectedRate`.

### `/household/main/config/dividends`
Legado. Objeto mensal histórico criado pelo `seed-history.html`.

### `/household/main/meta/connection`
Heartbeat de presença online.

## Listeners no cliente

Todos registrados em `subscribeToFirestore()` em `public/js/app.js`
(cerca da linha 2222 — procure por `unsub.expenses = onSnapshot`).
Cada listener atualiza `state.*` e dispara o render apropriado.

## Regras (Firestore Rules)

Versionadas em [`firestore.rules`](../firestore.rules) na raiz do repo
e deployadas via Firebase CLI. Ver [FIRESTORE-RULES.md](FIRESTORE-RULES.md)
pra setup + deploy.
