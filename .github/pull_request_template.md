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
- [ ] `CHANGELOG.md` atualizado se for mudança visível
- [ ] `CLAUDE.md` / docs atualizados se estrutura ou padrão mudou
- [ ] Nenhum walletId/email em log público
