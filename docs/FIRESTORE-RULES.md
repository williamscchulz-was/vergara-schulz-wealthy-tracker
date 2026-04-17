# Firestore Rules

As regras de segurança do Firestore ficam em `firestore.rules` na raiz
do repo e são deployadas via Firebase CLI.

## Modelo

Uma "casa" (`household/main`), dois membros (W e F). Whitelist de UIDs
autorizados — qualquer outro usuário autenticado vê tela vazia e não
consegue escrever nada.

## Setup inicial

### 1. Descobrir os UIDs

No Firebase Console:

1. Entra em `wealthy-tracker-68658`
2. **Authentication → Users**
3. Copia a coluna **"User UID"** tanto do W quanto da F

### 2. Editar `firestore.rules`

Substitui os placeholders:

```diff
  function isHouseholdMember() {
    return request.auth != null && request.auth.uid in [
-     'REPLACE_WITH_WILLIAM_UID',
-     'REPLACE_WITH_FLAVIA_UID'
+     'abc123...',  // William
+     'xyz789...'   // Flávia
    ];
  }
```

### 3. Instalar Firebase CLI (uma vez)

```bash
npm install -g firebase-tools
firebase login
```

### 4. Deploy

```bash
firebase deploy --only firestore:rules
```

Saída esperada: `✔ Deploy complete!` em alguns segundos.

## Workflow diário

Qualquer mudança nas regras:

1. Editar `firestore.rules`
2. Commitar
3. `firebase deploy --only firestore:rules`

O ideal é versionar aqui **e** deployar — assim o git é a fonte da
verdade e o console é só reflexo.

## Testar localmente (opcional)

```bash
firebase emulators:start --only firestore
```

Permite rodar o app contra um Firestore local com as regras atuais,
sem risco de tocar em dados reais.

## Regra atual — resumo

- `household/main/**` → só os 2 UIDs do casal leem/escrevem
- Todo o resto é negado

Se um dia adicionar um terceiro membro (ex: contador) ou separar
escopos (ex: contador vê despesas mas não investimentos), é aqui que
a lógica muda.
