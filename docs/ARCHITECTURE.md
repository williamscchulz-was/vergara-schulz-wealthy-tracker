# Architecture

## Visão geral

```
┌─────────────────┐        ┌──────────────────┐        ┌────────────────┐
│                 │        │                  │        │                │
│   Browser PWA   │◀──────▶│  Cloud Firestore │        │ Investidor 10  │
│  (public/*)     │ onSnap │  (wealthy-       │        │ (API pública)  │
│                 │        │   tracker-68658) │        │                │
└────────┬────────┘        └──────────────────┘        └────────▲───────┘
         │                                                      │
         │ GET /i10/all/:walletId                                │
         ▼                                                      │
┌─────────────────┐                                              │
│ Cloudflare      │──────────────────────────────────────────────┘
│ Worker (proxy)  │   proxy com cache 5 min + CORS
│ (worker/)       │
└─────────────────┘
```

## Componentes

### 1. PWA cliente (`public/`)

HTML + CSS + JS puros. Sem build step. Firebase SDK via CDN
(`gstatic.com/firebasejs/10.12.0`). Um único `state` global em
`public/js/app.js`, renderers idempotentes, listeners `onSnapshot`
pra sincronização em tempo real entre W e F.

### 2. Firestore

Todo estado compartilhado fica sob `household/main/...`. Ver
[FIRESTORE-SCHEMA.md](FIRESTORE-SCHEMA.md) pra detalhe completo.

### 3. Worker Cloudflare (`worker/`)

Proxy GET-only na frente da API interna do Investidor 10. Resolve CORS
(a I10 não libera o `Origin` do GH Pages) e reduz carga com cache de
5 min.

### 4. Tools (`tools/`)

Scripts one-shot de seed/migração. Fora do bundle de produção. Ver
[tools/README.md](../tools/README.md).

## Fluxo de dados

### Sync automático do I10

1. Usuário clica **🔄 Sincronizar** no card I10
2. `app.js:syncFromI10()` → `fetch(WORKER/i10/all/:walletId?year=YYYY)`
3. Worker dispara 3 fetches paralelos à API do I10 (metrics, earnings,
   actives) via `Promise.all`, agrega e responde JSON
4. Cliente parseia o payload e faz `setDoc(docI10, {...}, { merge: true })`
5. Firestore propaga via `onSnapshot` pro outro usuário
6. Logo em seguida, `syncLouise()` é disparado (piggyback do Turno 7) —
   sincroniza a carteira da filha (Louise, walletId `2699282`) que é
   acompanhada read-only e **não entra** no total do patrimônio da casa

### Edição manual

Botão ✏️ em qualquer card abre modal de edição. `setDoc` direto no
Firestore sem passar pelo worker. Tag "manual" aparece na UI pra
diferenciar da origem "via I10".

### Auth

Firebase Auth com Google provider. Regras do Firestore (não versionadas
neste repo, vivem no console do Firebase) restringem escrita aos UIDs
do casal.

## Decisões

- **Sem framework, sem build** — prioridade em velocidade de edição e
  zero cerimônia. App é pequeno o bastante.
- **Monolito em `app.js`** — 2.8k linhas contíguas é mais navegável que
  40 módulos de 70 linhas pra esse escopo.
- **Firestore como fonte da verdade** — `state` local é cache da última
  snapshot recebida.
- **Worker simples** — sem lógica de negócio, só proxy + whitelist. Se
  precisar de algo complexo, vai no cliente.
