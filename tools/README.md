# tools/

Scripts one-shot — **não fazem parte do app em runtime**. Ficam aqui pra
histórico e conveniência, mas **não são servidos em produção** (o GH
Pages só serve `public/`).

## Como rodar

Qualquer um dos HTMLs daqui pode ser aberto:

1. **Direto do disco** (`file:///.../tools/seed.html`) — funciona na
   maioria dos navegadores, Firebase carrega da CDN normalmente.
2. **Via server local**, se o navegador reclamar de módulo:
   ```bash
   cd tools && python -m http.server 8000
   # abre http://localhost:8000/seed.html
   ```

Todos requerem login Google na mesma conta do casal.

## O que faz cada um

| Arquivo | Finalidade | Destrutivo? |
|---|---|---|
| `seed.html` | Popula Firestore pela primeira vez com as 11 ações + BTC do W (uso pré-I10-sync) | ⚠️ cria duplicatas se rodar 2x |
| `seed-history.html` | Seed inicial de `dividendsYearly` + `config/dividends` mensal | ⚠️ idem |
| `fix-historico.html` | **Apaga TODOS** os docs em `dividendsYearly` e recria com 6 anos hardcoded | 🔴 **destrutivo** |
| `import-historico.html` | Upsert dos 6 anos sem deletar nada | ✅ seguro |
| `brand.html` | Preview do brand kit (cores, tipografia) | ✅ visual apenas |

## Regra

Nunca rode `fix-historico.html` sem confirmação explícita — apaga
histórico de dividendos sem undo.
