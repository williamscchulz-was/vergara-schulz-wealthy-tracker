# Deploy — GitHub Pages

O app é servido estaticamente a partir da pasta `public/` no branch `main`.

## Setup inicial (uma vez)

1. GitHub → **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` / **Folder**: `/public`
4. Save

Em ~1 min o site sobe em `https://<user>.github.io/<repo>/`.

## Deploy contínuo

Qualquer push no `main` que toque `public/*` dispara o build/deploy do
Pages automaticamente. Não tem workflow custom — é o deploy nativo.

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

Se for configurar domínio próprio: adicionar arquivo `public/CNAME`
com o domínio (ex: `ledger.meudominio.com`) e configurar DNS.
