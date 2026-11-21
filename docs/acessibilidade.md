# Acessibilidade — WCAG 2.2 AA (R1.4, issue #106)

Este documento registra **o que já é garantido automaticamente**, **o que foi conferido à mão no navegador** e
**o que ainda precisa de teste manual com leitor de tela** (NVDA no Windows e VoiceOver no iPhone/Mac) antes de
fechar o critério de saída de R1 ("roteiros com leitor de tela aprovados").

> Status: os roteiros abaixo foram **escritos e conferidos com a árvore de acessibilidade do Chromium** (nomes,
> papéis, ordem de foco e regiões ao vivo) via Playwright. **Ainda não foram executados com NVDA nem com
> VoiceOver em aparelho real.** A coluna "Manual" de cada passo diz o que observar nesse teste.

## 1. O que roda sozinho (CI)

| Verificação | Onde | Critério |
|---|---|---|
| axe-core (WCAG 2.0/2.1/2.2 A e AA) em **todas as telas** (`e2e/rotas.ts`), temas claro e escuro, 1440 px e 360 px | `apps/web/e2e/r1-acessibilidade.spec.ts` | 0 violações sérias ou críticas; todo `iframe` com título |
| Áreas de toque ≥ 44×44 px nas telas principais, em 360 px | `apps/web/e2e/r1-toque-e-movimento.spec.ts` | nenhum alvo menor (links em linha no texto ficam fora, como na WCAG 2.5.8) |
| `inputmode`/`autocomplete` nos formulários principais | idem | campos numéricos abrem o teclado numérico; login e cadastro com `autocomplete` |
| `prefers-reduced-motion` | idem (`emulateMedia({ reducedMotion: 'reduce' })`) | o confete não anima; nenhuma animação longa ou em loop |
| Rolagem horizontal em 360, 480, 768, 1024, 1440 px e paisagem | `apps/web/e2e/r1-responsividade.spec.ts` | 0 px de rolagem (reflow, WCAG 1.4.10) |
| Contraste dos pares de tokens | `packages/ui/src/styles/contrast.test.ts` | ≥ 4,5:1 (texto) e ≥ 3:1 (não texto) |

Pendências registradas no próprio teste (telas de outras frentes, que este pacote não editou):

- `/admin` (dashboard, `features/admin/dashboard`): cartões de KPI com `aria-label` que não começa pelo texto
  visível (WCAG 2.5.3 — Rótulo no nome). Sugestão: tirar o `aria-label` do link e deixar o conteúdo visível ser o
  nome, com o complemento em `<span className="sr-only">` **no fim**.
- `/entrar` (`features/auth`): o link "Esqueci a senha" tem 28 px de altura (precisa de 44 px no celular).
  Sugestão: `-my-2 inline-block py-2` ou `inline-flex min-h-11 items-center`.

## 2. Padrões adotados (para quem for criar tela nova)

- **Pular para o conteúdo**: primeiro foco de toda página (`app/layout.tsx`), leva para `<main id="conteudo">`.
  Os esqueletos de carregamento (`loading.tsx` → `RouteSkeleton`) também são o `<main id="conteudo">`.
- **Foco visível**: `:focus-visible` global com contorno de 2 px na cor de acento (`theme.css`); itens de menu
  ganham contorno quando destacados.
- **Rótulo no nome (2.5.3)**: nunca use `aria-label` que não comece pelo texto visível. Para dar contexto, ponha
  o complemento depois (`Salvar como modelo: Copa Nova`) ou em `sr-only` no início/fim do conteúdo. Cartões
  inteiros clicáveis usam um botão transparente por cima (`absolute inset-0`) só com o nome acessível, e o texto
  visível fica fora dele (`MatchRow`, `BracketCanvas`).
- **Listas de definição**: dentro de `<dl>` só `<dt>`/`<dd>` (ou um `<div>` com eles). Ícones vão dentro do `<dt>`.
- **Status nunca só por cor**: `StatusPill` (ícone + texto).
- **Mudanças ao vivo**: `aria-live="polite"` sem roubar o foco:
  - classificação: resumo das mudanças de posição (`StandingsGrid`, `data-testid="standings-announcement"`);
  - check-in: contagem regressiva falada de minuto em minuto e aviso (toast) ao confirmar (`CheckInPanel`);
  - notificações: "Chegou 1 notificação nova…" (`shared/layout/UnreadAnnouncer.tsx`);
  - conexão do tempo real: "AO VIVO" / "Reconectando…" (`LiveIndicator`, `role="status"`);
  - avisos (toasts), resultado da busca da ajuda, versão nova do app.
- **Movimento**: animações curtas; tudo para com `prefers-reduced-motion` (regra global em `tokens.css` e
  checagem no `Confetti`/`useFlip`).

## 3. Roteiros com leitor de tela

Preparação: protótipo no ar (`pnpm dev`), dados reiniciados ("Entrar como" → "Reiniciar dados").
NVDA 2024+ com Firefox ou Chrome no Windows; VoiceOver no iPhone (Safari, iOS 17+) e no Mac.
Anote em cada passo: o que foi falado, se a ordem fez sentido e se deu para concluir sem ver a tela.

### 3.1 Inscrição num campeonato (participante)

Conta: **Bianca** (participante). Campeonato: "Copa eFootball Iniciantes" ou outro com inscrições abertas.

| # | Ação | Esperado (verificado na árvore de acessibilidade) | Manual (NVDA/VoiceOver) |
|---|---|---|---|
| 1 | Abrir `/campeonatos`; `Tab` uma vez | "Pular para o conteúdo, link" | O link aparece visualmente ao receber foco |
| 2 | Navegar por títulos (`H` no NVDA / rotor "Títulos" no VO) | `h1` "Campeonatos", depois um título por cartão | Cada cartão é lido com jogo, modo, data (com fuso) e vagas "12/48" |
| 3 | Abrir o campeonato | `h1` com o nome; status "Inscrições abertas" lido como texto, não só cor | — |
| 4 | Ir até "Inscrever-se" (ou "Inscrever squad") | Botão com o texto visível como nome; aceite do regulamento é uma caixa com rótulo | Se faltar o ID do jogo, o aviso explica e leva ao perfil |
| 5 | Confirmar | Toast anunciado (região `polite`): "Inscrição confirmada — Boa sorte!", "Squad inscrito…", "Inscrição enviada…" ou "Você entrou na lista de espera…", e o painel muda para a situação da inscrição | O foco não pula para o topo da página |
| 6 | Erro (ex.: sem vaga) | Mensagem com o que aconteceu e o que fazer, anunciada | — |

### 3.2 Check-in

Conta: **Bianca**. Página: `/c/liga-semanal-clash-royale?aba=partidas` (partida das quartas com check-in aberto).

| # | Ação | Esperado | Manual |
|---|---|---|---|
| 1 | Navegar até o cartão "Quartas de final" | Botão do cartão: "Quartas de final: BrunoPro7 contra Bianca, <data> às <hora>, horário de Brasília, check-in aberto, seu confronto. Abrir detalhes" | O horário é falado com o fuso |
| 2 | Painel "Check-in aberto" | Texto + contagem; a região viva fala o tempo restante **de minuto em minuto** (não a cada segundo) | Conferir que a contagem não "metralha" o leitor |
| 3 | Ativar "Fazer check-in" | Toast "Check-in feito — Sua presença está confirmada." anunciado; painel vira "Check-in feito" | No VoiceOver/iPhone, conferir o anúncio sem precisar procurar |
| 4 | Sala da partida | "Código" e "Senha" lidos como pares de definição; botões "Copiar código da sala" / "Copiar senha da sala" | Ao copiar, toast anunciado |

### 3.3 Ver a chave

Conta: visitante ou **Bianca**. Página: `/c/liga-semanal-clash-royale?aba=chave`.

| # | Ação | Esperado | Manual |
|---|---|---|---|
| 1 | Celular (< 768 px): abas por rodada | `tablist` "Rodadas da chave" com "Oitavas de final", "Quartas de final"… | Gesto de troca de aba no VO |
| 2 | Lista de confrontos | Cada confronto é **um** botão com nome completo: rodada, lados, horário com fuso, status e resultado ("LeoX15 venceu por 2 a 1"); setas ↑ ↓ andam entre eles | O desenho do cartão não é lido de novo (é decorativo) |
| 3 | Desktop (≥ 768 px): chave em SVG | Grupo "Chave com 16 confrontos"; um só confronto na ordem do `Tab`; setas ← → ↑ ↓ andam pela árvore; Home/End vão ao primeiro/último; Enter abre o detalhe | No NVDA, usar modo de foco (as setas são da chave); conferir que o foco fica visível e a chave rola até ele |
| 4 | Classificação (tabela) | Cabeçalhos de coluna; posição "1º" abre "como o desempate foi decidido"; mudanças de posição anunciadas | Atualizar um resultado em outra aba e ouvir o resumo |

### 3.4 Lançar resultado (organizador)

Conta: **Camila**. Página: `/organizador/campeonatos/tn_liga_cr?aba=partidas` (duelo) e a final BR da "Copa Nova FF".

| # | Ação | Esperado | Manual |
|---|---|---|---|
| 1 | Menu da área | Celular: botão "Abrir menu" abre a gaveta; tablet: "Expandir o menu" (`aria-expanded`); desktop: navegação "Organização" | — |
| 2 | "Lançar resultado: <partida>" | Abre o painel de lançamento (formulário "Lançamento: <rodada>, <lado A> x <lado B>") na própria lista | Conferir para onde vai o foco ao abrir o painel e ao fechá-lo (não foi verificado automaticamente) |
| 3 | Placar do duelo | Campos numéricos com o rótulo do lado ("Jogos vencidos de LeoX15", "Coroas de …"); teclado numérico no celular | — |
| 4 | Queda BR | Tabela com "Colocação" e "Kills" por squad; `Enter` avança célula a célula, setas sobem/descem; prévia dos pontos atualizada (calculada pelo motor) | Lançar uma queda inteira sem tirar a mão do teclado |
| 5 | Erros | Mensagens de campo com `role="alert"`, associadas ao campo | — |
| 6 | Validar | Toast de sucesso anunciado; a tabela pública atualiza e anuncia as mudanças | — |

## 4. Teste manual em aparelhos (pendente)

- **1 Android de entrada** (Chrome): instalar o app ("Instalar app" no rodapé), abrir offline (deve mostrar
  "Você está sem internet"), TalkBack nos roteiros 3.1 e 3.2, teclado numérico na queda BR.
- **1 iPhone** (Safari): "Adicionar à Tela de Início", abrir pelo ícone (tela cheia, notch respeitado),
  VoiceOver nos 4 roteiros, paisagem.
- **1 tablet**: menu lateral recolhível (768–1023 px), chave em SVG com zoom por toque.
- Zoom do navegador em 200% e 400% (reflow) nas telas de campeonato e na gestão.
