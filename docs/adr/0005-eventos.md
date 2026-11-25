# ADR-0005 — Eventos: campeonatos agrupados com regra de participação

- **Status:** aceita
- **Data:** 2026-11-24
- **Origem:** validação do fluxo de criação e inscrição (critério: "um evento pode ter vários campeonatos, e o
  organizador decide se o participante joga um só ou vários")

## Contexto

Até aqui o campeonato era a unidade de tudo. O PRD usa "evento" só como sinônimo de campeonato ("equipe do evento",
"moderador do evento"). A organização pediu um nível acima: um **evento** (ex.: "Festival Free Fire") com vários
campeonatos (ex.: um em squad e outro solo) e uma regra decidida por quem organiza:

- **um só campeonato por jogador** — para dividir os jogadores entre as modalidades; ou
- **vários campeonatos por jogador** — o evento é só uma vitrine comum.

A liga semanal (`League`, issue #120) também agrupa campeonatos, mas com outro propósito (somar pontos por colocação,
um jogo só, período). Misturar as duas coisas complicaria as duas.

## Decisão

1. **Entidade própria.** `Event` (`slug`, `name`, `description`, `bannerUrl?`, `ownerId`, `participationRule`) e
   `Tournament.eventId?` (um campeonato está em no máximo um evento; excluir o evento deixa os campeonatos avulsos,
   `onDelete: SetNull`). A liga continua independente: um campeonato pode estar num evento e numa liga.
2. **Quem cria:** os mesmos papéis que criam campeonato (`ORGANIZER_AREA_ROLES`: Super Admin, Admin, Organizador).
   Quem gerencia: o dono do evento ou um Admin. Rotas no padrão das ligas: `/organizer/events…` para quem organiza e
   `GET /events/:slug` para o público (só os campeonatos publicados; evento sem campeonato publicado dá 404).
3. **Entrar e sair do evento:** pelo assistente (`eventId` em `POST /tournaments` e `PATCH /tournaments/:id`) ou pela
   página do evento (`POST|DELETE /organizer/events/:id/tournaments`). Só até o campeonato começar (até `CHECK_IN`);
   quem coloca precisa organizar o campeonato **e** o evento.
4. **O que conta como "estar" num campeonato:** inscrição ativa (`ACTIVE_REGISTRATION_STATUSES`, inclusive lista de
   espera) como inscrito solo ou como membro **confirmado** do elenco de um squad. Campeonato cancelado não conta.
   O membro convocado que ainda não confirmou não ocupa lugar: a regra é conferida quando ele confirma. Assim o
   capitão de um squad não "prende" um jogador num campeonato sem o aceite dele.
5. **Onde a regra `SINGLE` é conferida** (`packages/api/src/modules/events/rules.ts`, `assertEventExclusivity`):
   na inscrição (solo: a pessoa; squad: todo o elenco) e na confirmação do membro. Também ao colocar um campeonato
   com inscritos num evento `SINGLE` e ao trocar a regra de `MULTIPLE` para `SINGLE` (409 com quantos jogadores
   conflitam). O erro é `409 EVENT_SINGLE_CHAMPIONSHIP`, com o nome do outro campeonato (e do jogador, quando não é
   quem pediu). `GET /tournaments/:id/registration-eligibility` devolve `eventConflict` para a tela avisar antes do
   clique.
6. **Concorrência:** quem confere a regra numa transação trava a linha do evento (`FOR UPDATE`) depois da do
   campeonato. Duas inscrições simultâneas em campeonatos diferentes do mesmo evento esperam uma pela outra.

## Consequências

- A página do campeonato mostra "Faz parte do evento X" e a regra em palavras simples; a do evento (`/e/[slug]`)
  lista os campeonatos com a regra em destaque.
- Quem muda o elenco de um squad (rotas futuras de remanejamento) precisa chamar `assertEventExclusivity` para o
  jogador que entra.
- Cancelar a inscrição num campeonato libera a pessoa para outro do mesmo evento. Desistência (`WITHDRAWN`) e
  desclassificação também liberam: só inscrição ativa conta.
- A regra não é retroativa: trocar para `SINGLE` exige que ninguém esteja em dois campeonatos; a organização resolve
  as inscrições antes.
