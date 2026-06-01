# Deploy — Firebase Hosting (URL `.web.app`)

O app é servido em dois lugares ao mesmo tempo (ambos de graça, mesmo
conteúdo da pasta `public/`):

- **GitHub Pages** — URL antiga, segue funcionando (workflow `pages.yml`).
- **Firebase Hosting** — URL bonita `https://ledger-schulz.web.app`
  (workflow `firebase-hosting.yml`). **Esta vira a principal.**

A cada push que mexe em `public/`, os dois publicam sozinhos. Não precisa
rodar nada no terminal.

> Os domínios `*.web.app` e `*.firebaseapp.com` já entram automaticamente
> na lista de **domínios autorizados** do Firebase Auth — o login com
> Google funciona na URL nova sem configurar nada.

---

## Setup (uma vez)

### 1. Criar o site no Firebase
1. https://console.firebase.google.com → projeto `wealthy-tracker-68658`
2. Menu lateral **Hosting** (em "Criação" / "Build")
3. Se for a primeira vez, **Começar** / **Get started** (pode pular os
   passos de CLI — só queremos o site criado).
4. Em **Hosting**, botão **Adicionar outro site** / **Add another site**
5. ID do site: **`ledger-schulz`** → cria. A URL fica
   `https://ledger-schulz.web.app`.
   - Se `ledger-schulz` estiver em uso (o nome é global), tente
     `ledger-schulz-app`, `schulz-ledger`, etc. **Anote o ID final** —
     ele precisa bater com o campo `"site"` em `firebase.json`.

### 2. Pôr a chave da service account como secret no GitHub
Reaproveite o **mesmo** arquivo `.json` da service account que você usou
no worker (Firebase Console → ⚙️ → Contas de serviço → Gerar nova chave,
caso não tenha mais).

1. https://github.com/<seu-usuário>/vergara-schulz-wealthy-tracker
2. **Settings** → **Secrets and variables** → **Actions**
3. **New repository secret**
4. Nome: `FIREBASE_SERVICE_ACCOUNT`
5. Valor: cola **todo o conteúdo** do `.json`
6. **Add secret**

### 3. Disparar o deploy
- GitHub → aba **Actions** → workflow **Deploy to Firebase Hosting** →
  **Run workflow** (ou faça qualquer push em `public/`).
- Em ~1 min fica verde. Abra `https://ledger-schulz.web.app`.

---

## Se o deploy falhar com erro de permissão

A service account `firebase-adminsdk-…` às vezes não tem o papel de
deploy de Hosting. Conserto (4 cliques):

1. https://console.cloud.google.com/iam-admin/iam?project=wealthy-tracker-68658
2. Acha a conta `firebase-adminsdk-…@wealthy-tracker-68658.iam.gserviceaccount.com`
3. Lápis (Editar) → **Adicionar outra função** → **Firebase Hosting Admin**
4. Salvar → reroda o workflow.

---

## Trocar o nome do site depois

1. Cria o novo site no console (passo 1).
2. Edita `"site"` em `firebase.json` pro novo ID.
3. Push → publica na URL nova. (A antiga continua no ar até você deletar
   o site no console.)

## Aposentar o GitHub Pages (opcional)

Quando a `.web.app` estiver redonda e você quiser uma fonte só, dá pra
remover `.github/workflows/pages.yml`. Não é obrigatório — manter os dois
é um backup grátis.
