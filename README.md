# Ledger ↔ Investidor 10 — Integração automática

Sincroniza automaticamente os dados da sua carteira pública do Investidor 10
no seu Ledger PWA, via um Cloudflare Worker gratuito que resolve o CORS.

## O que foi adicionado

- **Patrimônio atual** (equity) puxado do I10
- **Aplicado total, variação %, profit TWR** (exibidos abaixo do PL)
- **Dividendos YTD do ano corrente** (soma de proventos)
- **Lista dos 10 ativos** com ticker, quantidade, preço médio, preço atual,
  % da carteira e appreciation — ordenados por patrimônio
- **Config compartilhada via Firestore** — W e F configuram uma vez, ambos
  recebem as atualizações pelo onSnapshot existente
- **Fallback manual preservado** — o botão "Editar" continua funcionando pra
  ajustes avulsos, com tag visual distinguindo "manual" de "via I10"

## Arquivos

| Arquivo | O que é |
|---|---|
| `worker.js` | Cloudflare Worker a ser publicado (proxy com CORS, cache 5min) |
| `DEPLOY-WORKER.md` | Passo a passo do deploy do Worker (3 minutos) |
| `app.js` | Substitui o `app.js` atual do Ledger |
| `index.html` | Substitui o `index.html` atual do Ledger |

## Instalação — ordem

### 1. Publique o Cloudflare Worker
Siga `DEPLOY-WORKER.md`. Ao final você vai ter uma URL do tipo:
```
https://ledger-i10-proxy.SEU-SUB.workers.dev
```

### 2. Atualize o projeto Ledger
Substitua no seu repositório:
- `app.js` (ou onde quer que ele esteja servido)
- `index.html`

Nenhuma outra mudança é necessária — o manifest, os ícones e os service workers
continuam iguais.

### 3. Configure o sync dentro do app
- Abra o Ledger, entre em **Investimentos**
- Clique no botão **⚙️** ao lado de "Editar"
- Cole a URL do Worker (passo 1)
- Coloque o Wallet ID: `1986068` (ou outro, se mudar)
- Clique **Salvar** → o sync roda automaticamente na sequência

### 4. Uso diário
- Botão **🔄 Sincronizar** no topo do card puxa os dados mais recentes
- Os valores ficam salvos no Firestore, então o outro usuário vê na hora
- O tag "via I10" aparece ao lado da data quando foi sincronizado automático;
  "manual" quando foi editado pelo botão ✏️

## Endpoints do Worker

| Rota | O que retorna |
|---|---|
| `/i10/all/:walletId?year=2026` | tudo de uma vez (usado pelo app) |
| `/i10/metrics/:walletId` | só PL, aplicado, variação |
| `/i10/earnings/:walletId?year=2026` | soma de proventos do ano |
| `/i10/actives/:walletId` | lista detalhada de ativos |
| `/i10/barchart/:walletId` | histórico dos últimos 12 meses |

## Segurança

- Worker só aceita **GET** com paths em whitelist (`/i10/...`)
- Wallet ID precisa ser numérico (regex `^\d{1,12}$`)
- Cache de 5 min reduz chamadas ao I10 e acelera as respostas
- Nenhuma autenticação / cookie / token é usado — só o ID público da carteira

## Observação importante

A API interna do Investidor 10 não é oficial — foi mapeada por engenharia
reversa do link público da carteira. Pode mudar ou parar de funcionar sem
aviso. Pro uso pessoal tá excelente; se um dia quebrar, basta voltar a usar
o botão ✏️ manual que continua funcionando.

## Dados validados na sondagem inicial (08/04/2026)

| Métrica | Valor |
|---|---|
| Patrimônio | R$ 1.757.288,45 |
| Aplicado | R$ 1.604.754,36 |
| Variação | +9,50% |
| Profit TWR | +28,69% |
| Dividendos YTD 2026 | R$ 71.167,55 |
| Ativos | 10 |
