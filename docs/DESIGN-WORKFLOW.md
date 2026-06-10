# Design Workflow — Mockup-First (obrigatório)

Regra do dono (jun/2026): **nenhuma melhoria de design/UX entra no app só descrita em
texto**. O fluxo não é `Análise → Relatório → Recomendações`; é:

> **Análise → Relatório → Proposta Visual (mockup) → Aprovação → Blueprint → Implementação**

A IA frequentemente identifica o problema certo, mas implementa uma solução diferente
da imaginada. O mockup elimina essa lacuna: **o humano valida o visual ANTES da
implementação definitiva.** Não descreva a melhoria — **mostre**.

Caso real que originou a regra: `propostas.html` (3 opções de tags A/B/C + tela
Importações, publicado pra escolha, implementado após o "A" + "aprovado", deletado depois).

---

## 1. Fases obrigatórias de uma task de design

1. **Auditoria** — o que está errado/fraco, com evidência (print, medida do DOM, token).
2. **Relatório** — executivo (problemas + impacto) e técnico (causa estrutural).
3. **Mockup(s) de solução** — ver §2. Para decisões com mais de um caminho, mockar
   **2–3 variantes lado a lado** (como A/B/C das tags) e pedir a escolha.
4. **Aprovação explícita do dono** — uma letra/um "ok" basta. Sem aprovação, não implementa.
5. **Blueprint de implementação** — ver §4.
6. **Implementação + verificação técnica** (node --check, greps, leitura de código)
   + commit + push + deploy.
7. **Entrega = página HTML publicada (human taste).** A validação estética final é do
   dono, no aparelho dele: publicar uma página de entrega (before/after do que foi
   aplicado, checklist de status item a item, decisões pendentes com opções A/B) e
   mandar o link. **O preview interno do Claude Code é PROIBIDO** — não usar nem pra
   demonstrar, nem como prova, nem pra validação (regra explícita do dono, jun/2026).
8. **Limpeza** — páginas de mockup saem do repo após implementadas (`git rm`).

## 2. Como mockar (neste projeto)

- **Página HTML standalone em `public/`** (ex.: `propostas.html`, `propostas-<tema>.html`),
  publicada via `firebase deploy` pro dono abrir no celular/desktop real.
- **Sem Tailwind, sem framework, sem build** — o mockup usa HTML + CSS vanilla, de
  preferência **linkando os tokens reais** (`public/css/01-base.css`) ou replicando-os
  (`--bg`, `--ink*`, lime `#c7f73e`, Inter + Geist Mono).
- O mockup mostra de verdade: **layout, hierarquia, espaçamento, tipografia, cor,
  componentes, navegação e estados** — não wireframe abstrato.
- **Before/After** sempre que possível: estado atual vs. proposta, com justificativa.

## 3. Estados e microinterações — exemplos visíveis

Toda sugestão de microinteração/estado precisa de **exemplo concreto** no mockup:

- **Hover / click / focus** — estado inicial e final visíveis.
- **Loading** — skeleton/spinner desenhado.
- **Empty state** — composição real (ícone + título + CTA), não "mostrar mensagem".
- **Error state** — composição real (mensagem humana; o técnico vai pro console — §11 do CLAUDE.md).
- **Sucesso** — toast/feedback desenhado.

**Motion preview**: cada animação proposta especifica **gatilho · duração · easing ·
comportamento** (ex.: modal: fade+rise, 300ms, `--ease-back`; hover de card: elevação,
200ms). Exemplo implementável junto. **Toda animação respeita `prefers-reduced-motion`**
(bloco v8 REDUCED MOTION) — sem exceção.

**Design System preview**: se a proposta altera componentes base (botões, inputs,
selects, cards, badges, tabelas, modais, tooltips), o mockup mostra os componentes
afetados nos seus estados — e a implementação atualiza o token/camada certa
(`01-base.css` → tokens; camada da seção → componente; `11-polish.css` → override
consciente), nunca hex solto.

## 4. Blueprint de implementação (antes de codar)

Listar, curto e concreto:

- **Arquivos impactados** (ex.: `index.html` DOM, `app.js` renderers X/Y, `css/07`, `i18n.js`).
- **O que entra** (novos renderers/helpers/seções de CSS) e **o que sai** (DOM/CSS/JS removido).
- **O que é reutilizado** (helpers `fmtBRL*`, `sparkPath`, `openConfirmModal`, tokens, pills).

## 5. Arquitetura — limites (versão vanilla deste projeto)

A tradução dos princípios "componentização/modularização" pra cá (ver CLAUDE.md §8.4 —
nada de npm/build/framework):

- **Renderers idempotentes** e focados: um renderer desenha a partir do `state`; não
  busca dados, não valida formulário, não escreve no Firestore.
- **Lógica pura extraível** vai pra módulo próprio testável (padrão `import-core.js`,
  `recurring-core.js` + `node --test`).
- **CSS na camada certa** (01–11, a ordem dos `<link>` é a cascata) — não inflar o
  `11-polish.css` com o que pertence à camada da seção.
- **Nada de função-monstro**: UI + regra de negócio + acesso a dados não nascem juntos
  numa função nova. (O `app.js` é monolítico em *arquivo*, não em *responsabilidade*.)

## 6. Estrutura de entrega de uma auditoria de design

1. Auditoria → 2. Score/diagnóstico → 3. Problemas → 4. Oportunidades → 5. Quick wins →
6. Melhorias maiores → 7. **Mockups HTML** → 8. Microinterações exemplificadas →
9. Motion specs → 10. Blueprint → 11. Plano de implementação (ordem + riscos).

> Não descreva a melhoria apenas em texto. Sempre que possível, materialize-a em
> mockup visual/HTML funcional que permita ao humano ver o resultado esperado **antes**
> da implementação definitiva.
