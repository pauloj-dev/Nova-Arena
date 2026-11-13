# @nova/schemas

Contratos Zod compartilhados entre as telas, a API simulada e (a partir de B1) a API real.
Toda requisição e toda resposta de `/api/v1` têm schema aqui; a API real implementa exatamente estes contratos.

| Arquivo | Conteúdo | Endpoints (PRD §18.1 e novos) |
|---|---|---|
| `common.ts` | `Problem` (RFC 7807), página por cursor (`page`) e numerada (`numberedPage`) | todos |
| `user.ts` | `Me`, `PublicUser`, cadastro, login, verificação e redefinição, conta de jogo, pedido de organizador, convite de papel, seguir | `/auth/*`, `/me`, `/me/game-accounts/:gameId`, `/users/:nickname`, `/me/organizer-request`, `/role-invites/:token`, `/me/follows` |
| `game.ts` | `Game`, `GameMode`, `ScoringRule` (6 tipos), `ScoringModel`, `Tiebreaker`, ranking por jogo | `/games`, `/games/:slug`, `/games/:slug/ranking`, `/admin/games`, `/admin/games/:id/scoring-models` |
| `tournament.ts` | `Tournament`, `TournamentSummary`, `Stage`, `StageConfig`, `Qualification`, máquina de estados (`canTransition`), rascunho, modelos, comunicados, equipe do evento | `/tournaments`, `/tournaments/:slug`, `/tournaments/:id/publish` (e demais do ciclo de vida), `/tournament-templates`, `/tournaments/:id/staff`, `/tournaments/:id/announcements`, `/stages/:id/scoring` |
| `team.ts` | `Team`, `TeamMember`, `TeamInvite`, prévia do convite | `/teams`, `/teams/:id/members`, `/teams/:id/invites`, `/team-invites/:code` |
| `registration.ts` | `Registration`, inscrição, revisão, importação por CSV, "Meus campeonatos" | `/tournaments/:id/registrations`, `/registrations/:id`, `/me/registrations` |
| `competition.ts` | `Bracket`, `Match`, `Standings`, agenda e sala, resultado (só estatísticas brutas), W.O., avanço de fase, pódio, envio pelo participante, disputa, upload, perfil competitivo | `/stages/:id/bracket`, `/stages/:id/generate`, `/stages/:id/seeding`, `/stages/:id/confirm`, `/stages/:id/advance`, `/stages/:id/standings`, `/tournaments/:id/matches`, `/matches/:id`, `/matches/:id/check-in`, `/matches/:id/lobby`, `/matches/:id/result`, `/matches/:id/submissions`, `/submissions/:id/dispute`, `/disputes/:id`, `/uploads/token`, `/users/:nickname/stats` |
| `governance.ts` | Denúncias, sanções, usuários do Admin, convites, pedidos, auditoria, estatísticas, configurações, flags, saúde, comunicados globais, 2FA | `/reports`, `/admin/stats`, `/admin/users`, `/admin/users/:id/sanctions`, `/admin/invites`, `/admin/users/:id/roles`, `/admin/organizer-requests`, `/admin/audit-logs`, `/admin/tournaments`, `/admin/reports`, `/admin/settings`, `/admin/flags`, `/admin/health`, `/admin/announcements`, `/me/2fa/*` |
| `notification.ts` | Notificações, preferências e os eventos de tempo real (`RealtimeEvent`) | `/notifications`, `/me/notification-preferences`; canais `tournament:{id}`, `match:{id}`, `user:{id}` |

Regras:

- **Pontos nunca vêm do cliente.** `SubmitResultInput` aceita só estatísticas brutas; os pontos voltam calculados em `SubmitResultResponse`.
- Mensagens de validação em pt-BR, prontas para aparecer no formulário.
- `ScoringRule` e `Tiebreaker` são os mesmos tipos do motor (`@nova/engine`); `apps/web/shared/api/contract-check.ts` quebra o `typecheck` se divergirem.
