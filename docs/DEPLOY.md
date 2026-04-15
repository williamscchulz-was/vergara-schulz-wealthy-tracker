# Deploy — GitHub Pages

O app é servido estaticamente a partir da pasta `public/` via GitHub
Actions (o modo "Deploy from a branch" do Pages não aceita pastas custom
— só `/` ou `/docs` — por isso usamos Actions).

## Setup inicial (uma vez)

1. GitHub → **Settings → Pages**
2. **Source**: `GitHub Actions`
3. Salvar (se aparecer botão; em alguns repos já aplica direto)

Pronto. O workflow `.github/workflows/pages.yml` cuida do resto.

## Deploy contínuo

Qualquer push no `main` que toque `public/**` ou o próprio workflow
dispara deploy. Pode acompanhar em **Actions → Deploy to GitHub Pages**.

Pra forçar redeploy sem alterar arquivos: **Actions → Deploy to GitHub
Pages → Run workflow** (dispara manualmente via `workflow_dispatch`).

## Como o workflow funciona

1. Checkout do repo
2. `actions/configure-pages@v5` prepara o ambiente
3. `actions/upload-pages-artifact@v3` empacota `./public/` como artifact
4. `actions/deploy-pages@v4` publica

Concorrência configurada pra cancelar deploy em curso se chegar push
novo — evita condições de corrida.

## Dev local

```bash
cd public
python -m http.server 8000
# abre http://localhost:8000
```

Ou qualquer outro server estático (`npx serve`, `http-server`, etc).

## Nota sobre `.nojekyll`

O arquivo vazio `public/.nojekyll` força o Pages a servir os arquivos
tal como estão, sem processamento Jekyll (que ignoraria arquivos/pastas
começando com `_`).

## Domínio custom

Adicionar arquivo `public/CNAME` com o domínio (ex: `ledger.meudominio.com`)
e configurar DNS.
