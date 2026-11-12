# Nova Arena — Regras de negócio complementares

Regras que o PRD cita sem definir. Este documento é anexo do PRD e vale como requisito. Issue de origem: #6.

Códigos `RN-06` em diante continuam a numeração do PRD §11.4.

---

## RN-06 — Cancelamento de inscrição, desistência e desclassificação

| Momento | Quem | O que acontece |
|---|---|---|
| Até a abertura do check-in (ou até a trava de elenco, o que vier primeiro) | Participante / capitão | **Cancelamento.** A vaga é liberada e o primeiro da lista de espera é promovido (RN-12). |
| Depois disso, antes de a fase 1 começar | Participante / capitão | **Desistência.** O organizador pode substituir por alguém da lista de espera até a chave ser confirmada. |
| Com a fase em andamento | Participante (desistência) ou staff (desclassificação) | Depende do formato — tabela abaixo. Nunca há substituição com a fase em andamento. |

### Efeito na fase em andamento, por formato

| Formato | Desistência | Desclassificação |
|---|---|---|
| `SINGLE_ELIM`, `DOUBLE_ELIM`, `TEAM_VS_TEAM` | A partida atual e as futuras viram **W.O.** para o adversário. Resultados passados ficam. | Igual. |
| `ROUND_ROBIN`, `GROUPS` (duelos) | Se jogou **menos da metade** das partidas: todos os resultados dele são **anulados** (saem da tabela). Se jogou metade ou mais: as restantes viram W.O. pelo placar configurado. | Todos os resultados são anulados e ele sai da tabela (RN-05). |
| `SWISS` | Sai dos pareamentos futuros. Resultados passados ficam. | Sai dos pareamentos; pontos zerados. |
| `BATTLE_ROYALE`, `GROUPS` (quedas) | Sai das quedas futuras. Os pontos já feitos ficam. | Pontos zerados e tabela reordenada (RN-05). |

Toda desistência e desclassificação exige motivo e gera registro de auditoria.

## RN-07 — Regerar a chave

- A chave de uma fase pode ser regerada enquanto **nenhuma partida da fase foi concluída**.
- Regerar descarta as partidas da fase, sorteia com **nova seed** (registrada) e gera auditoria com a seed antiga e a nova.
- Depois da primeira partida concluída a chave fica travada. Só um Admin destrava, e destravar exige motivo.

## RN-08 — Início da partida (`LIVE`)

- Partida **com horário**: passa para `CHECK_IN` quando a janela abre e para `LIVE` no horário marcado, se o check-in exigido foi feito. Quem não fez check-in leva W.O. (RN-04).
- Partida **sem horário**: o staff inicia manualmente.
- O staff pode lançar resultado em partida `SCHEDULED` ou `CHECK_IN` (a partida é considerada jogada).
- O staff pode iniciar antes do horário ou devolver para `SCHEDULED` enquanto não houver resultado.

## RN-09 — Organizador revogado, suspenso ou banido

| Estado do campeonato | O que acontece |
|---|---|
| Rascunho | Fica com o dono, somente leitura. |
| Publicado até Pausado | O **co-organizador mais antigo** da equipe do evento assume como responsável. Se não houver, o campeonato é **pausado** e entra na fila "Sem responsável" do Admin. |
| Finalizado / Arquivado | Continua visível, com o nome do organizador original. |

O Admin é notificado em todos os casos. A troca de responsável é auditada.

## RN-10 — Limites do organizador

- "Simultâneo" = campeonato nos estados **Publicado, Inscrições abertas, Inscrições fechadas, Check-in, Em andamento ou Pausado**. Rascunhos, cancelados, finalizados e arquivados não contam.
- Padrão: **3 simultâneos**; organizador verificado: **10**. O Admin pode alterar por organizador.
- "Jogos permitidos": lista vazia = todos os jogos ativos.
- O limite é conferido ao **publicar** (não ao criar o rascunho).

## RN-11 — Remoção de administradores

- Ninguém remove o Super Admin. Só existe um Super Admin, e ele só transfere o papel.
- Um Admin pode remover outro Admin **mais novo** no papel que ele.
- Para remover um Admin **mais antigo**, o pedido fica pendente até o Super Admin aprovar (`AdminRemovalRequest`). Enquanto isso, o Admin alvo continua com acesso.
- A regra pode ser desligada pelo Super Admin nas configurações (`requireApprovalForSeniorAdminRemoval`, ligada por padrão).

## RN-12 — Lista de espera

- A promoção é automática, na ordem de entrada.
- **Squad promovido incompleto:** a vaga fica reservada, com a inscrição "Aguardando membros", por **24 horas** ou até o fechamento das inscrições (o que vier primeiro). Se não completar, a vaga passa para o próximo da lista e o squad volta ao fim dela.
- Com aprovação manual ligada, o promovido entra como "Aguardando aprovação".

## RN-13 — Mesclar contas duplicadas

- Só Admin, com motivo. É **irreversível**.
- A conta **destino** mantém e-mail, nick, senha, papéis e 2FA. Os papéis da conta de origem **não** são transferidos.
- São transferidos para o destino: inscrições, participações em squads (incluindo capitania), histórico de partidas, estatísticas, conquistas, denúncias e IDs de jogo (se houver conflito de ID para o mesmo jogo, vale o do destino).
- **Bloqueio:** se as duas contas estão inscritas no mesmo campeonato ativo (ou em squads diferentes nele), a mescla é recusada até o conflito ser resolvido.
- A conta de origem fica com status `MERGED`, sem login, e o nick dela fica reservado por 90 dias.

## RN-14 — Empate em duelo eliminatório

- Séries MD têm sempre número ímpar de jogos; a série não empata.
- Em um jogo isolado empatado, o resultado só é aceito com o **campo de desempate** do jogo preenchido:

| Jogo | Desempate |
|---|---|
| eFootball | Pênaltis (campo extra `penalties`) |
| Clash Royale | Não há empate válido: joga-se uma partida extra |
| 8 Ball Pool | Não há empate |
| Outros | Campo "vencedor do desempate" obrigatório |

- Em grupos e pontos corridos o empate é aceito quando o modelo de pontuação tem regra `OUTCOME` com valor para empate.

## RN-15 — Seguir campeonato ou jogo

- **Seguir campeonato:** o usuário recebe as notificações públicas do campeonato (comunicados, início, avanço de fase, campeão) e ele aparece em "Seguindo".
- **Seguir jogo:** o usuário é avisado quando um campeonato novo do jogo abre inscrições.
- Inscrever-se em um campeonato faz o participante segui-lo automaticamente.
