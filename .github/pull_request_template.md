<!--
  ⚠️ Fluxo padrão deste repo é commit direto no `main` (ver CLAUDE.md §9.2).
  Se você abriu um PR, ótimo — o template abaixo ajuda no review.
  Mas a maioria das mudanças não passa por aqui; elas vão direto pro main
  via `git commit` + `git push`.
-->

## O que muda

<!-- 1-3 bullets descrevendo a intenção da mudança (o porquê, não o quê) -->

## Onde mexeu

- [ ] `public/` (app)
- [ ] `worker/` (Cloudflare Worker — precisa redeploy)
- [ ] `tools/` (scripts one-shot)
- [ ] `docs/`
- [ ] Outro:

## Testes

<!-- Descreve como foi validado. Se UI, screenshot ou descrição do fluxo. -->

- [ ] Rodei localmente (`public/` via server local ou `wrangler dev`)
- [ ] Testei os dois usuários (W + F) ou N/A
- [ ] Sem regressão nos fluxos principais (sync I10, lançar despesa, editar manual)

## Checklist

- [ ] Paths relativos em `public/` ainda fecham (ícones, manifest, módulos)
- [ ] Nenhum walletId/email em log público

### Docs no mesmo commit (regra CLAUDE.md §9.8)
- [ ] Mudou schema Firestore? → `docs/FIRESTORE-SCHEMA.md` + `CLAUDE.md §4`
- [ ] Feature visível nova ou fluxo mudou? → `CLAUDE.md §6` + `docs/CHANGELOG.md [Unreleased]`
- [ ] Novo padrão/convenção/helper compartilhado? → `CLAUDE.md §10` (+ `docs/ARCHITECTURE.md` se aplicar)
- [ ] Deploy/rules mexidos? → `docs/DEPLOY.md` / `docs/DEPLOY-WORKER.md` / `docs/FIRESTORE-RULES.md`
- [ ] Pessoas/emails/UIDs/walletIds tocados? → conferir `CLAUDE.md §1` e §5
- [ ] N/A — mudança não toca nenhum dos itens acima
