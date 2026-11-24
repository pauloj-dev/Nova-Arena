/**
 * Matriz RBAC **completa** do PRD §6 contra a API real e o Postgres (issue #102, Marco M2): **toda rota registrada**
 * no app × visitante, participante, moderador do campeonato, organizador dono, outro organizador, Admin sem o 2FA
 * feito, Admin com 2FA e Super Admin.
 *
 * Como ler:
 * - "nega" = 401 para o visitante (sem sessão) e 403 para quem está logado sem a permissão. Em recurso de outra
 *   pessoa (squad, inscrição, notificação…), 404 também vale como negação: a API não revela que o recurso existe.
 * - "permite" = a permissão passou: qualquer status que não seja 401 nem 403 (o corpo vazio costuma dar 400, o estado
 *   do campeonato pode dar 409 — a regra de negócio vem depois da permissão).
 * - Cada rota é chamada com sessões novas (logout ou troca de senha numa rota não derrubam as seguintes) e o
 *   primeiro teste confere que a tabela cobre **exatamente** as rotas do app: rota nova sem linha aqui quebra o build.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '../src';
import { readRun } from '../src/competition/run';
import { createHarness, type Harness } from './fixtures/admin';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;

const ACTORS = ['visitante', 'participante', 'moderador', 'organizadorDono', 'organizadorOutro', 'adminSem2fa', 'admin', 'superAdmin'] as const;
type Actor = (typeof ACTORS)[number];
type Policy = Partial<Record<Actor, 'allow' | 'deny' | number>>;

const all = (v: 'allow' | 'deny' | number): Policy => Object.fromEntries(ACTORS.map((a) => [a, v]));
const except = (base: Policy, over: Policy): Policy => ({ ...base, ...over });

/** Qualquer um (inclusive visitante). */
const PUBLIC = all('allow');
/** Precisa estar logado; qualquer papel. */
const AUTH = except(all('allow'), { visitante: 'deny' });
/** Área do organizador (organizador, Admin ou Super Admin). */
const ORGANIZER_AREA = except(all('deny'), { organizadorDono: 'allow', organizadorOutro: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' });
/** Editar/cancelar/gerar chave do campeonato: o dono (e o Admin). Moderador e outro organizador não. */
const MANAGE = except(all('deny'), { organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' });
/** Lançar/validar resultados, gerenciar inscrições e disputas: dono, moderador do campeonato e Admin. */
const MODERATE = except(MANAGE, { moderador: 'allow' });
/** Painel Admin: Admin ou Super Admin **com o 2FA feito na sessão**. */
const ADMIN = except(all('deny'), { admin: 'allow', superAdmin: 'allow' });
/** Só o Super Admin (configurações globais, flags, decisão de remoção de Admin). */
const SUPER = except(all('deny'), { superAdmin: 'allow' });
/** Chat da partida: quem joga (a participante está na 1ª partida) e a organização do campeonato. */
const MATCH_CHAT = except(MODERATE, { participante: 'allow' });
/** Recurso da participante (o squad, a inscrição, a notificação dela): só ela. */
const OWN = except(all('deny'), { participante: 'allow' });
/** Jobs (assinatura do QStash) e Cron (segredo do Vercel Cron): ninguém com sessão passa. */
const MACHINE = all(401);

interface Ctx {
  ids: Record<string, string>;
}
interface Row {
  route: string;
  path: (ctx: Ctx) => string;
  policy: Policy;
  /** Corpo válido quando a rota valida o corpo antes de saber quem pode (a permissão depende do corpo). */
  body?: (ctx: Ctx) => unknown;
  /** Rota com limite de tentativas por IP (códigos de convite): depois de várias recusas, 429 também é recusa. */
  limited?: boolean;
  /** Por que a rota tem essa política (quando não é óbvio pelo PRD §6). */
  note?: string;
}

const r = (route: string, policy: Policy, path?: (ctx: Ctx) => string, note?: string, body?: (ctx: Ctx) => unknown): Row => ({ route, policy, path: path ?? (() => route.split(' ')[1] ?? ''), note, body });

const MATRIX: Row[] = [
  // ── Público ──────────────────────────────────────────────────────
  r('GET /health', PUBLIC),
  r('GET /me', PUBLIC, undefined, 'visitante recebe null'),
  r('GET /games', PUBLIC),
  r('GET /games/:slug', PUBLIC, ({ ids }) => `/games/${ids.gameSlug}`),
  r('GET /games/:slug/ranking', PUBLIC, ({ ids }) => `/games/${ids.gameSlug}/ranking`),
  r('GET /tournaments', PUBLIC),
  r('GET /tournaments/:slug', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}`),
  r('GET /tournaments/:id/announcements', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/announcements`),
  r('GET /tournaments/:id/matches', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/matches`),
  r('GET /tournaments/:id/podium', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/podium`),
  r('GET /tournaments/:id/registrations', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/registrations`),
  r('GET /tournaments/:id/access', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/access`, 'diz o que a pessoa pode fazer; visitante recebe "nada"'),
  r('GET /tournaments/:id/my-registration', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/my-registration`, 'visitante recebe null'),
  r('GET /tournaments/:id/registration-eligibility', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/registration-eligibility`, 'visitante recebe "entre para se inscrever"'),
  r('GET /stages/:id/bracket', PUBLIC, ({ ids }) => `/stages/${ids.stage}/bracket`),
  r('GET /stages/:id/standings', PUBLIC, ({ ids }) => `/stages/${ids.stage}/standings`),
  r('GET /matches/:id', PUBLIC, ({ ids }) => `/matches/${ids.match}`),
  r('GET /matches/:id/events', PUBLIC, ({ ids }) => `/matches/${ids.match}/events`, 'histórico público do resultado (sem dado pessoal)'),
  r('GET /users/:nickname', PUBLIC, ({ ids }) => `/users/${ids.participanteNick}`),
  r(
    'GET /users/:nickname/game-accounts',
    except(MODERATE, { participante: 'allow' }),
    ({ ids }) => `/users/${ids.participanteNick}/game-accounts`,
    'IDs de jogo (privacidade): a própria pessoa e a organização dos campeonatos em que ela está inscrita',
  ),
  r('GET /users/:nickname/stats', PUBLIC, ({ ids }) => `/users/${ids.participanteNick}/stats`),
  r('GET /teams/:id', PUBLIC, ({ ids }) => `/teams/${ids.team}`),
  r('GET /team-invites/:code', PUBLIC, ({ ids }) => `/team-invites/${ids.teamInviteCode}`),
  r('GET /role-invites/:token', PUBLIC, () => '/role-invites/convite-que-nao-existe-123456'),
  r('GET /staff-invites/:token', PUBLIC, () => '/staff-invites/convite-que-nao-existe-123456', 'prévia do link da equipe do campeonato (antes do login)'),
  r('GET /site/banner', PUBLIC),
  r('GET /site/flags', PUBLIC),
  r('GET /site/settings', PUBLIC),
  r('GET /push/public-key', PUBLIC),
  r('POST /events', PUBLIC, undefined, 'eventos de produto sem cookie'),
  r('GET /auth/oauth/:provider', PUBLIC, () => '/auth/oauth/google'),
  r('GET /auth/oauth/:provider/callback', PUBLIC, () => '/auth/oauth/google/callback'),
  r('POST /auth/login', PUBLIC),
  r('POST /auth/register', PUBLIC),
  r('POST /auth/forgot-password', PUBLIC),
  r('POST /auth/reset-password', PUBLIC),
  r('POST /auth/verify-email', PUBLIC),
  r('POST /auth/confirm-email-change', PUBLIC),
  r('POST /auth/2fa/verify', all(401), undefined, 'segundo passo do login: sem o cookie do desafio (5 min depois da senha), 401 para todos'),
  r('POST /realtime/token', PUBLIC, undefined, 'visitante também recebe token (só os canais públicos de campeonato); sem Ably no teste: 503'),
  r('POST /auth/logout', PUBLIC, undefined, 'sem sessão, só apaga os cookies'),
  r('POST /auth/refresh', all(401), undefined, 'sem o cookie de refresh (só vai para /api/v1/auth) não há o que renovar'),

  // ── Logado (a própria conta) ─────────────────────────────────────
  ...[
    'GET /me/2fa',
    'GET /me/disputes',
    'GET /me/follows',
    'GET /me/notification-preferences',
    'GET /me/oauth',
    'GET /me/organizer-request',
    'GET /me/registrations',
    'GET /me/reports',
    'GET /me/sessions',
    'GET /me/staff-tournaments',
    'GET /me/team-invites',
    'GET /notifications',
    'GET /notifications/unread-count',
    'GET /teams/mine',
    'GET /user-search',
    'PATCH /me',
    'POST /me/2fa/disable',
    'POST /me/2fa/enable',
    'POST /me/2fa/setup',
    'POST /me/email',
    'POST /me/nps',
    'POST /me/organizer-request',
    'POST /me/password',
    'POST /me/password/change',
    'POST /me/push-subscriptions',
    'DELETE /me/push-subscriptions',
    'DELETE /me/sessions',
    'PUT /me/notification-preferences',
    'POST /notifications/read-all',
    'POST /auth/resend-verification',
    'POST /reports',
    'POST /teams',
    'POST /uploads/blob',
    'POST /uploads/complete',
  ].map((route) => r(route, AUTH)),
  r('DELETE /me/sessions/:id', AUTH, () => '/me/sessions/00000000-0000-4000-8000-000000000000', 'sessão de outra pessoa: 404'),
  r('DELETE /me/oauth/:provider', AUTH, () => '/me/oauth/discord'),
  r('PUT /me/game-accounts/:gameId', AUTH, ({ ids }) => `/me/game-accounts/${ids.game}`),
  r('DELETE /me/game-accounts/:gameId', AUTH, ({ ids }) => `/me/game-accounts/${ids.game}`),
  r('PUT /me/follows/:type/:id', AUTH, ({ ids }) => `/me/follows/game/${ids.game}`),
  r('DELETE /me/follows/:type/:id', AUTH, ({ ids }) => `/me/follows/game/${ids.game}`),
  r('POST /tournaments/:id/registrations', AUTH, ({ ids }) => `/tournaments/${ids.openTournament}/registrations`, 'inscrever-se: todos os papéis (o dono é recusado pela regra RN-06, não pela permissão)'),
  r('POST /team-invites/:code/accept', AUTH, ({ ids }) => `/team-invites/${ids.teamInviteCode}/accept`),
  { ...r('POST /team-invites/:code/decline', OWN, ({ ids }) => `/team-invites/${ids.personalInviteCode}/decline`, 'recusar: só quem foi convidado pelo apelido (código errado conta no limite de 10/min)'), limited: true },
  r('POST /role-invites/:token/accept', AUTH, () => '/role-invites/convite-que-nao-existe-123456/accept'),
  r('POST /staff-invites/:token/accept', AUTH, () => '/staff-invites/convite-que-nao-existe-123456/accept', 'entrar na equipe do campeonato pelo link: o próprio link é a permissão'),
  r('GET /files/:id', except(OWN, { admin: 'allow', superAdmin: 'allow', adminSem2fa: 'allow' }), ({ ids }) => `/files/${ids.upload}`, 'prova privada: quem enviou, o staff do campeonato (quando anexada) e a moderação da plataforma; sem Blob no teste: 503'),

  // ── Recursos da participante ─────────────────────────────────────
  r('PATCH /teams/:id', OWN, ({ ids }) => `/teams/${ids.team}`, 'só o capitão'),
  r('DELETE /teams/:id', OWN, ({ ids }) => `/teams/${ids.spareTeam}`, 'só o capitão'),
  r('POST /teams/:id/invites', OWN, ({ ids }) => `/teams/${ids.team}/invites`),
  r('POST /teams/:id/transfer-captain', OWN, ({ ids }) => `/teams/${ids.team}/transfer-captain`),
  r('PATCH /teams/:id/members/:userId', OWN, ({ ids }) => `/teams/${ids.team}/members/${ids.teamMember}`),
  r('DELETE /teams/:id/members/:userId', OWN, ({ ids }) => `/teams/${ids.team}/members/${ids.teamMember}`, 'capitão remove (o próprio membro também sai, fora desta matriz)'),
  r('DELETE /team-invites/:id', OWN, ({ ids }) => `/team-invites/${ids.teamInvite}`, 'quem pode convidar revoga'),
  r('POST /registrations/:id/confirm', OWN, ({ ids }) => `/registrations/${ids.teamRegistration}/confirm`, 'membro do squad confirma a participação'),
  r('POST /registrations/:id/decline', OWN, ({ ids }) => `/registrations/${ids.teamRegistration}/decline`),
  r('POST /registrations/:id/members', except(MANAGE, { participante: 'allow' }), ({ ids }) => `/registrations/${ids.teamRegistration}/members`, 'escalar no elenco: o capitão (até a trava de elenco) e quem gerencia o campeonato; moderador não'),
  r('DELETE /registrations/:id/members/:userId', except(MANAGE, { participante: 'allow' }), ({ ids }) => `/registrations/${ids.teamRegistration}/members/00000000-0000-4000-8000-000000000000`, 'tirar do elenco: o capitão (até a trava) e quem gerencia'),
  r('POST /registrations/:id/members/:userId/move', MANAGE, ({ ids }) => `/registrations/${ids.teamRegistration}/members/00000000-0000-4000-8000-000000000000/move`, 'remanejar entre squads: só quem gerencia o campeonato'),
  r('POST /notifications/:id/read', OWN, ({ ids }) => `/notifications/${ids.notification}/read`),
  r('GET /matches/:id/lobby', except(OWN, { moderador: 'allow', organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/matches/${ids.match}/lobby`, 'sala: quem joga a partida e o staff'),
  r('POST /matches/:id/check-in', OWN, ({ ids }) => `/matches/${ids.match}/check-in`, 'só quem joga a partida'),
  r('POST /matches/:id/submissions', OWN, ({ ids }) => `/matches/${ids.match}/submissions`, 'enviar resultado: capitão/jogador da partida (PRD §6)'),
  r('GET /matches/:id/submission', except(OWN, { moderador: 'allow', organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/matches/${ids.match}/submission`),
  r('GET /submissions/:id', except(OWN, { moderador: 'allow', organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/submissions/${ids.submission}`),
  r('POST /submissions/:id/confirm', except(all('deny'), { participante: 'deny' }), ({ ids }) => `/submissions/${ids.submission}`.concat('/confirm'), 'só o adversário confirma (aqui nenhum dos atores é o adversário)'),
  r('POST /submissions/:id/dispute', except(all('deny'), { participante: 'deny' }), ({ ids }) => `/submissions/${ids.submission}/dispute`, 'só o adversário contesta'),
  r('GET /disputes/:id', except(OWN, { moderador: 'allow', organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/disputes/${ids.dispute}`),
  r('POST /disputes/:id/messages', except(OWN, { moderador: 'allow', organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/disputes/${ids.dispute}/messages`),
  r('DELETE /registrations/:id', OWN, ({ ids }) => `/registrations/${ids.openRegistration}`, 'cancelar a própria inscrição'),

  // ── Organizador ──────────────────────────────────────────────────
  r('GET /organizer/tournaments', ORGANIZER_AREA),
  r('POST /tournaments', ORGANIZER_AREA, undefined, 'criar campeonato'),
  r('GET /tournament-templates', ORGANIZER_AREA),
  r('POST /tournament-templates', ORGANIZER_AREA),
  r('POST /organizer/scoring-models', ORGANIZER_AREA),
  r('DELETE /tournament-templates/:id', except(all('deny'), { organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }), ({ ids }) => `/tournament-templates/${ids.template}`, 'modelo de outra pessoa: só o dono (ou Admin)'),
  r(
    'PUT /organizer/scoring-models/:id',
    except(all('deny'), { organizadorDono: 'allow' }),
    ({ ids }) => `/organizer/scoring-models/${ids.ownModel}`,
    'modelo próprio: só quem criou (o Admin cuida dos modelos padrão em /admin/games)',
    ({ ids }) => ({ gameId: ids.game, name: 'Do dono', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], tiebreakers: ['points'] }),
  ),

  // ── Campeonato: gerenciar (dono) ─────────────────────────────────
  ...(
    [
      ['PATCH /tournaments/:id', 'tournaments'],
      ['DELETE /tournaments/:id', 'tournaments'],
      ['POST /tournaments/:id/archive', 'tournaments'],
      ['POST /tournaments/:id/cancel', 'tournaments'],
      ['POST /tournaments/:id/close-registration', 'tournaments'],
      ['POST /tournaments/:id/duplicate', 'tournaments'],
      ['POST /tournaments/:id/finish', 'tournaments'],
      ['POST /tournaments/:id/open-registration', 'tournaments'],
      ['POST /tournaments/:id/pause', 'tournaments'],
      ['POST /tournaments/:id/resume', 'tournaments'],
      ['POST /tournaments/:id/publish', 'tournaments'],
      ['POST /tournaments/:id/staff', 'tournaments'],
      ['GET /tournaments/:id/staff-invites', 'tournaments'],
      ['POST /tournaments/:id/staff-invites', 'tournaments'],
      ['GET /tournaments/:id/podium-suggestion', 'tournaments'],
      ['POST /tournaments/:id/registrations/import', 'tournaments'],
    ] as const
  ).map(([route, base]) => r(route, MANAGE, ({ ids }) => `/${base}/${ids.tournament}${route.split(':id')[1] ?? ''}`)),
  r('GET /tournaments/:id/audit-logs', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/audit-logs`, 'PRD §6: logs só dos próprios campeonatos (moderador não)'),
  r('PATCH /tournaments/:id/staff/:userId', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/staff/${ids.moderador}`),
  r('DELETE /tournaments/:id/staff/:userId', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/staff/${ids.nobody}`),
  r('DELETE /tournaments/:id/staff-invites/:inviteId', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/staff-invites/${ids.nobody}`, 'revogar o link da equipe: só o responsável (convite inexistente: 404)'),
  r('POST /tournaments/:id/announcements', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/announcements`),
  r('DELETE /announcements/:id', MANAGE, ({ ids }) => `/announcements/${ids.announcement}`),
  r('POST /stages/:id/generate', MANAGE, ({ ids }) => `/stages/${ids.stage}/generate`, 'gerar/regerar chave: não é do moderador'),
  r('POST /stages/:id/confirm', MANAGE, ({ ids }) => `/stages/${ids.stage}/confirm`),
  r('PATCH /stages/:id/seeding', MANAGE, ({ ids }) => `/stages/${ids.stage}/seeding`),
  r('PATCH /stages/:id/scoring', MANAGE, ({ ids }) => `/stages/${ids.stage}/scoring`),
  r('GET /stages/:id/advance', MANAGE, ({ ids }) => `/stages/${ids.stage}/advance`),
  r('POST /stages/:id/advance', MANAGE, ({ ids }) => `/stages/${ids.stage}/advance`),
  r('POST /stages/:id/next-round', MANAGE, ({ ids }) => `/stages/${ids.stage}/next-round`),
  r('POST /stages/:id/unlock', ADMIN, ({ ids }) => `/stages/${ids.stage}/unlock`, 'RN-07: só o Admin destrava a chave, com o 2FA feito', () => ({ reason: 'Teste da matriz' })),

  // ── Campeonato: moderar (dono, moderador, Admin) ─────────────────
  r('GET /organizer/tournaments/:id', MODERATE, ({ ids }) => `/organizer/tournaments/${ids.tournament}`, 'painel de operação: o moderador valida resultados por ele'),
  r('GET /tournaments/:id/staff', MODERATE, ({ ids }) => `/tournaments/${ids.tournament}/staff`),
  r('GET /tournaments/:id/registrations.csv', MODERATE, ({ ids }) => `/tournaments/${ids.tournament}/registrations.csv`, 'gerenciar inscrições'),
  r('POST /stages/:id/schedule-round', MODERATE, ({ ids }) => `/stages/${ids.stage}/schedule-round`, 'agenda: operação da partida', () => ({ round: 99, startsAt: new Date(Date.now() + 86_400_000).toISOString() })),
  r('PATCH /matches/:id', MODERATE, ({ ids }) => `/matches/${ids.match}`, 'agenda e sala'),
  r('POST /matches/:id/start', MODERATE, ({ ids }) => `/matches/${ids.match}/start`),
  r('POST /matches/:id/walkover', MODERATE, ({ ids }) => `/matches/${ids.match}/walkover`, 'W.O. manual', () => ({ winnerRegistrationId: '00000000-0000-4000-8000-000000000000', reason: 'Teste da matriz' })),
  r('PUT /matches/:id/result', MODERATE, ({ ids }) => `/matches/${ids.match}/result`, 'lançar/validar resultados'),
  r('POST /tournaments/:id/results/import', MODERATE, ({ ids }) => `/tournaments/${ids.tournament}/results/import`),
  r('GET /tournaments/:id/submissions', MODERATE, ({ ids }) => `/tournaments/${ids.tournament}/submissions`),
  r('PATCH /submissions/:id', MODERATE, ({ ids }) => `/submissions/${ids.submission}`, 'validar ou recusar o envio'),
  r('GET /tournaments/:id/disputes', MODERATE, ({ ids }) => `/tournaments/${ids.tournament}/disputes`),
  r('POST /disputes/:id/escalate', MODERATE, ({ ids }) => `/disputes/${ids.dispute}/escalate`),
  r('POST /disputes/:id/resolve', MODERATE, ({ ids }) => `/disputes/${ids.dispute}/resolve`),
  r('PATCH /registrations/:id', MODERATE, ({ ids }) => `/registrations/${ids.registration}`, 'aprovar/recusar inscrições'),

  // ── Painel Admin (2FA feito) ─────────────────────────────────────
  ...[
    'GET /admin/admin-removal-requests',
    'GET /admin/admins',
    'GET /admin/announcements',
    'GET /admin/audit-logs',
    'GET /admin/audit-logs.csv',
    'GET /admin/audit-logs/meta',
    'GET /admin/disputes',
    'GET /admin/flags',
    'GET /admin/health',
    'GET /admin/invites',
    'GET /admin/metrics',
    'GET /admin/organizer-requests',
    'GET /admin/organizers',
    'GET /admin/reports',
    'GET /admin/settings',
    'GET /admin/stats',
    'GET /admin/system/job-failures',
    'GET /admin/tournaments',
    'GET /admin/users',
    'POST /admin/announcements',
    'POST /admin/games',
    'POST /admin/invites',
  ].map((route) => r(route, ADMIN)),
  r('PATCH /admin/announcements/:id', ADMIN, () => '/admin/announcements/00000000-0000-4000-8000-000000000000'),
  r('PATCH /admin/games/:id', ADMIN, ({ ids }) => `/admin/games/${ids.game}`),
  r('POST /admin/games/:id/scoring-models', ADMIN, ({ ids }) => `/admin/games/${ids.game}/scoring-models`),
  r('PATCH /admin/games/:id/scoring-models/:modelId', ADMIN, ({ ids }) => `/admin/games/${ids.game}/scoring-models/${ids.model}`),
  r('POST /admin/games/:id/scoring-models/:modelId/duplicate', ADMIN, ({ ids }) => `/admin/games/${ids.game}/scoring-models/${ids.model}/duplicate`),
  r('DELETE /admin/games/:id/scoring-models/:modelId', ADMIN, ({ ids }) => `/admin/games/${ids.game}/scoring-models/${ids.model}`),
  r('DELETE /admin/invites/:id', ADMIN, () => '/admin/invites/00000000-0000-4000-8000-000000000000'),
  r('DELETE /admin/sanctions/:id', ADMIN, () => '/admin/sanctions/00000000-0000-4000-8000-000000000000'),
  r('PATCH /admin/organizer-requests/:id', ADMIN, () => '/admin/organizer-requests/00000000-0000-4000-8000-000000000000'),
  r('PATCH /admin/reports/:id', ADMIN, () => '/admin/reports/00000000-0000-4000-8000-000000000000'),
  r('GET /admin/tournaments/:id/locked-stages', ADMIN, ({ ids }) => `/admin/tournaments/${ids.tournament}/locked-stages`),
  r('PATCH /admin/tournaments/:id', ADMIN, ({ ids }) => `/admin/tournaments/${ids.tournament}`),
  r('POST /admin/tournaments/:id/archive', ADMIN, ({ ids }) => `/admin/tournaments/${ids.tournament}/archive`),
  r('POST /admin/tournaments/:id/cancel', ADMIN, ({ ids }) => `/admin/tournaments/${ids.tournament}/cancel`),
  r('POST /admin/tournaments/:id/owner', ADMIN, ({ ids }) => `/admin/tournaments/${ids.tournament}/owner`),
  r('GET /admin/users/:id', ADMIN, ({ ids }) => `/admin/users/${ids.target}`),
  r('PATCH /admin/users/:id/organizer-limits', ADMIN, ({ ids }) => `/admin/users/${ids.target}/organizer-limits`),
  r('POST /admin/users/:id/2fa/reset', SUPER, ({ ids }) => `/admin/users/${ids.target}/2fa/reset`, 'quem perdeu o autenticador: só o Super Admin redefine'),
  r('POST /admin/users/:id/merge', ADMIN, ({ ids }) => `/admin/users/${ids.target}/merge`),
  r('POST /admin/users/:id/reset-password', ADMIN, ({ ids }) => `/admin/users/${ids.target}/reset-password`),
  r('POST /admin/users/:id/roles', ADMIN, ({ ids }) => `/admin/users/${ids.target}/roles`, 'promover/revogar organizadores'),
  r('DELETE /admin/users/:id/roles/:role', ADMIN, ({ ids }) => `/admin/users/${ids.target}/roles/ORGANIZER`),
  r('POST /admin/users/:id/sanctions', ADMIN, ({ ids }) => `/admin/users/${ids.target}/sanctions`, 'banir usuário da plataforma'),
  r('POST /admin/system/job-failures/:id/resolve', ADMIN, () => '/admin/system/job-failures/00000000-0000-4000-8000-000000000000/resolve'),
  r('PUT /admin/settings', SUPER, undefined, 'configurações globais: Admin só lê'),
  r('PUT /admin/flags/:key', SUPER, () => '/admin/flags/ranking'),
  r('POST /admin/admin-removal-requests/:id/:decision', SUPER, () => '/admin/admin-removal-requests/00000000-0000-4000-8000-000000000000/approve', 'RN-11: só o Super Admin decide'),

  // ── Pós-lançamento: temporadas, ligas, Discord, chat e calendário (issues 120, 121, 125) ──
  r('GET /seasons', PUBLIC),
  r('GET /games/:slug/season-ranking', PUBLIC, ({ ids }) => `/games/${ids.gameSlug}/season-ranking`, 'flag ranking ligada'),
  r('GET /users/:nickname/rating', PUBLIC, ({ ids }) => `/users/${ids.participanteNick}/rating`),
  r('GET /teams/:id/rating', PUBLIC, ({ ids }) => `/teams/${ids.team}/rating`),
  r('POST /admin/seasons', ADMIN),
  r('PATCH /admin/seasons/:id', ADMIN, () => '/admin/seasons/00000000-0000-4000-8000-000000000000'),
  r('DELETE /admin/seasons/:id', ADMIN, () => '/admin/seasons/00000000-0000-4000-8000-000000000000'),
  r('GET /leagues', PUBLIC),
  r('GET /leagues/:slug', PUBLIC, ({ ids }) => `/leagues/${ids.leagueSlug}`),
  r('GET /organizer/leagues', ORGANIZER_AREA),
  r('POST /organizer/leagues', ORGANIZER_AREA),
  r('PATCH /organizer/leagues/:id', MANAGE, ({ ids }) => `/organizer/leagues/${ids.league}`, 'liga: a dona ou um Admin (o 2FA só é exigido no painel)'),
  r('POST /organizer/leagues/:id/tournaments', MANAGE, ({ ids }) => `/organizer/leagues/${ids.league}/tournaments`),
  r('DELETE /organizer/leagues/:id/tournaments/:tournamentId', MANAGE, ({ ids }) => `/organizer/leagues/${ids.league}/tournaments/${ids.tournament}`),
  r('DELETE /organizer/leagues/:id', MANAGE, ({ ids }) => `/organizer/leagues/${ids.spareLeague}`, 'liga separada: a dona apaga na 1ª chamada, as seguintes dão 404'),
  r('GET /tournaments/:id/discord', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/discord`, 'vincular o canal do Discord: quem gerencia o campeonato'),
  r('POST /tournaments/:id/discord/code', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/discord/code`, 'sem bot configurado: 503 depois da permissão'),
  r('POST /tournaments/:id/discord/test', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/discord/test`),
  r('DELETE /tournaments/:id/discord', MANAGE, ({ ids }) => `/tournaments/${ids.tournament}/discord`),
  r('GET /matches/:id/chat', MATCH_CHAT, ({ ids }) => `/matches/${ids.match}/chat`, 'chat da partida: quem joga e a organização (Admin incluso); o outro organizador não'),
  r('POST /matches/:id/chat', MATCH_CHAT, ({ ids }) => `/matches/${ids.match}/chat`),
  r('DELETE /matches/:id/chat/:messageId', MATCH_CHAT, ({ ids }) => `/matches/${ids.match}/chat/00000000-0000-4000-8000-000000000000`, 'quem joga oculta a própria mensagem; a organização, qualquer uma'),
  r('GET /me/calendar', AUTH),
  r('GET /calendar/u/:file', PUBLIC, () => '/calendar/u/00000000-0000-4000-8000-000000000000.assinatura-errada.ics', 'sem login (app de calendário): a assinatura no endereço é a permissão; inválida dá 404'),
  r('GET /tournaments/:id/calendar', PUBLIC, ({ ids }) => `/tournaments/${ids.tournament}/calendar`),
  r('GET /calendar/t/:file', PUBLIC, ({ ids }) => `/calendar/t/${ids.tournamentSlug}.ics`),
  r('POST /discord/interactions', MACHINE, undefined, 'só o Discord, com a assinatura Ed25519'),

  // ── R2: antifraude e LGPD (issues 114 e 115) ─────────────────────
  r('GET /admin/fraud-alerts', ADMIN, undefined, 'alerta sobre um Admin só aparece para o Super Admin (filtro, não permissão)'),
  r('PATCH /admin/fraud-alerts/:id', ADMIN, () => '/admin/fraud-alerts/00000000-0000-4000-8000-000000000000'),
  r('POST /me/export', AUTH, undefined, 'exportação dos próprios dados'),
  r('GET /me/exports', AUTH),
  r('GET /me/exports/:id/download', AUTH, () => '/me/exports/00000000-0000-4000-8000-000000000000/download', 'só o dono: de outra pessoa dá 404 (teste de IDOR)'),
  r('GET /me/deletion', AUTH),
  r('DELETE /me', AUTH, undefined, 'sem senha e frase de confirmação: 400 depois da sessão'),

  // ── Máquinas ─────────────────────────────────────────────────────
  // Por último: muda o estado da inscrição da participante (W.O. na partida).
  r(
    'POST /registrations/:id/withdraw',
    except(OWN, { organizadorDono: 'allow', adminSem2fa: 'allow', admin: 'allow', superAdmin: 'allow' }),
    ({ ids }) => `/registrations/${ids.registration}/withdraw`,
    'desistir: a própria pessoa (ou a organização registra); desclassificar: quem gerencia — moderador não (PRD §6)',
    () => ({ kind: 'WITHDRAWN', reason: 'Teste da matriz' }),
  ),
  ...['GET /cron/daily-cleanup', 'GET /cron/sanctions', 'GET /cron/sweep', 'GET /cron/tournaments', 'POST /jobs/announcements/deliver', 'POST /jobs/discord/announce', 'POST /jobs/discord/reminder', 'POST /jobs/privacy/export', 'POST /jobs/failures', 'POST /jobs/matches/check-in', 'POST /jobs/notifications/email', 'POST /jobs/notifications/push', 'POST /jobs/tournaments/registration'].map((route) => r(route, MACHINE)),
];

describe.skipIf(!url)('matriz RBAC completa (PRD §6) — toda rota × 8 perfis', () => {
  let db: PrismaClient;
  let h: Harness;
  const ids: Record<string, string> = {};
  const keyOf: Record<Exclude<Actor, 'visitante'>, string> = {
    participante: 'par',
    moderador: 'mod',
    organizadorDono: 'orgA',
    organizadorOutro: 'orgB',
    adminSem2fa: 'adm0',
    admin: 'adm',
    superAdmin: 'sup',
  };

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    // Sem a checagem de bot (cadastro e recuperação de senha): aqui só a permissão importa.
    h = createHarness(db, 'rf', {}, { botCheck: async () => false });
    const participante = await h.makeUser('par', ['PARTICIPANT']);
    const moderador = await h.makeUser('mod', ['PARTICIPANT']);
    const orgA = await h.makeUser('orgA', ['ORGANIZER']);
    await h.makeUser('orgB', ['ORGANIZER']);
    await h.makeUser('adm0', ['ADMIN'], { tfa: false });
    await h.makeUser('adm', ['ADMIN']);
    await h.makeUser('sup', ['SUPER_ADMIN', 'ADMIN']);
    const target = await h.makeUser('alvo', ['ORGANIZER']);
    const member = await h.makeUser('membro', ['PARTICIPANT']);
    const rival = await h.makeUser('rival', ['PARTICIPANT']);
    const nobody = await h.makeUser('ninguem', ['PARTICIPANT']);
    Object.assign(ids, { participanteNick: participante.nickname, moderador: moderador.id, target: target.id, teamMember: member.id, nobody: nobody.id });

    const game = await db.game.create({
      data: { slug: `rf-${h.stamp}`, name: `Jogo RF ${h.stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'], isDefault: true } } },
      include: { modes: true, scoringModels: true },
    });
    Object.assign(ids, { game: game.id, gameSlug: game.slug, model: game.scoringModels[0]?.id ?? '' });
    ids.ownModel = (await db.scoringModel.create({ data: { gameId: game.id, name: 'Do dono', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'], ownerId: orgA.id } })).id;
    const base = { gameId: game.id, gameModeId: game.modes[0]?.id ?? '', participantType: 'SOLO' as const, maxParticipants: 8, ownerId: orgA.id };

    // Campeonato em andamento, com a participante na 1ª partida e o moderador na equipe.
    const t = await db.tournament.create({ data: { ...base, slug: `rf-copa-${h.stamp}`, name: 'Copa RF', status: 'REGISTRATION_CLOSED', staff: { create: { userId: moderador.id, role: 'MODERATOR', addedById: orgA.id } } } });
    ids.tournament = t.id;
    ids.tournamentSlug = t.slug;
    const stage = await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: ids.model as string, tiebreakers: ['points'], config: { bestOf: 1 } } });
    ids.stage = stage.id;
    ids.registration = (await db.registration.create({ data: { tournamentId: t.id, userId: participante.id, status: 'CONFIRMED', createdAt: new Date(Date.now() - 10_000) } })).id;
    await db.registration.create({ data: { tournamentId: t.id, userId: rival.id, status: 'CONFIRMED', createdAt: new Date(Date.now() - 9_000) } });
    expect((await h.call('orgA', 'POST', `/stages/${stage.id}/generate`, { seeding: 'RANKED' })).status).toBe(200);
    expect((await h.call('orgA', 'POST', `/stages/${stage.id}/confirm`)).status).toBe(200);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    const run = readRun(await db.stage.findUniqueOrThrow({ where: { id: stage.id } }));
    const node = run?.structure.matches[0];
    const match = await db.match.findFirstOrThrow({ where: { stageId: stage.id, nodeId: node?.id ?? '' } });
    ids.match = match.id;
    ids.announcement = (await db.announcement.create({ data: { tournamentId: t.id, authorId: orgA.id, title: 'Aviso', body: 'Corpo do aviso.' } })).id;

    // Envio da participante (aguardando o adversário) e uma disputa aberta por ela.
    const regs = await db.registration.findMany({ where: { tournamentId: t.id }, select: { id: true } });
    const mine = regs.find((x) => x.id === ids.registration)?.id ?? '';
    const theirs = regs.find((x) => x.id !== ids.registration)?.id ?? '';
    const payload = { entries: [{ registrationId: mine, score: 1 }, { registrationId: theirs, score: 0 }], winnerRegistrationId: mine, submittedByRegistrationId: mine, opponentRegistrationId: theirs, tournamentId: t.id, tournamentName: t.name, stageId: stage.id, matchLabel: 'Final' };
    ids.submission = (await db.resultSubmission.create({ data: { matchId: match.id, submittedById: participante.id, payload, evidenceUrls: [] } })).id;
    ids.dispute = (await db.dispute.create({ data: { matchId: match.id, submissionId: ids.submission, openedById: participante.id, reason: 'Placar errado no print.' } })).id;

    // Campeonato com inscrições abertas (para inscrever e cancelar).
    const open = await db.tournament.create({ data: { ...base, slug: `rf-aberto-${h.stamp}`, name: 'Aberto RF', status: 'REGISTRATION_OPEN', registrationClosesAt: new Date(Date.now() + 5 * 86_400_000) } });
    ids.openTournament = open.id;
    const openDuel = await db.tournament.create({ data: { ...base, slug: `rf-aberto2-${h.stamp}`, name: 'Aberto RF 2', status: 'REGISTRATION_OPEN', registrationClosesAt: new Date(Date.now() + 5 * 86_400_000) } });
    ids.openRegistration = (await db.registration.create({ data: { tournamentId: openDuel.id, userId: participante.id, status: 'CONFIRMED' } })).id;

    // Squads da participante (um para os testes de capitão, outro para apagar), convite e inscrição de squad pendente.
    const team = await db.team.create({ data: { name: 'Squad RF', tag: `R${h.stamp.slice(-4)}`, captainId: participante.id, members: { create: [{ userId: participante.id, role: 'CAPTAIN' }, { userId: member.id, role: 'MEMBER' }] } } });
    ids.team = team.id;
    ids.spareTeam = (await db.team.create({ data: { name: 'Squad Sobra', tag: `S${h.stamp.slice(-4)}`, captainId: participante.id, members: { create: [{ userId: participante.id, role: 'CAPTAIN' }] } } })).id;
    const invite = await db.teamInvite.create({ data: { teamId: team.id, code: `RF${h.stamp.slice(-6)}`, expiresAt: new Date(Date.now() + 86_400_000), createdById: participante.id } });
    Object.assign(ids, { teamInvite: invite.id, teamInviteCode: invite.code });
    const rivalTeam = await db.team.create({ data: { name: 'Squad Rival', tag: `V${h.stamp.slice(-4)}`, captainId: rival.id, members: { create: [{ userId: rival.id, role: 'CAPTAIN' }] } } });
    ids.personalInviteCode = (await db.teamInvite.create({ data: { teamId: rivalTeam.id, invitedUserId: participante.id, code: `PV${h.stamp.slice(-6)}`, expiresAt: new Date(Date.now() + 86_400_000), createdById: rival.id } })).code;
    const squadT = await db.tournament.create({ data: { ...base, slug: `rf-squad-${h.stamp}`, name: 'Squad RF Copa', participantType: 'TEAM', status: 'REGISTRATION_OPEN' } });
    ids.teamRegistration = (
      await db.registration.create({ data: { tournamentId: squadT.id, teamId: team.id, status: 'PENDING_MEMBERS', members: { create: [{ tournamentId: squadT.id, userId: participante.id, isCaptain: true }] } } })
    ).id;

    ids.notification = (await db.notification.create({ data: { userId: participante.id, type: 'ANNOUNCEMENT', title: 'Oi', body: 'Corpo.' } })).id;
    ids.template = (await db.tournamentTemplate.create({ data: { ownerId: orgA.id, name: 'Modelo RF', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', payload: {} } })).id;
    ids.upload = (await db.upload.create({ data: { ownerId: participante.id, purpose: 'evidence', access: 'private', blobUrl: `https://blob.exemplo/rf-${h.stamp}.png`, pathname: `evidence/${participante.id}/rf.png`, contentType: 'image/png', size: 10 } })).id;

    // Ligas da organizadora dona: uma para editar e vincular campeonatos, outra para apagar.
    const leagueData = (suffix: string) => ({ slug: `rf-liga-${suffix}-${h.stamp}`, name: `Liga RF ${suffix}`, gameId: game.id, ownerId: orgA.id, startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000), placementPoints: [10, 6, 4] });
    const league = await db.league.create({ data: leagueData('a') });
    Object.assign(ids, { league: league.id, leagueSlug: league.slug, spareLeague: (await db.league.create({ data: leagueData('b') })).id });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('a tabela cobre exatamente as rotas registradas no app (rota nova sem linha aqui quebra)', () => {
    const real = new Set(h.app.routes.filter((x) => x.method !== 'ALL' && x.path.startsWith(`${API_BASE_PATH}/`)).map((x) => `${x.method} ${x.path.slice(API_BASE_PATH.length)}`));
    const mine = MATRIX.map((m) => m.route);
    expect(mine.filter((x, i) => mine.indexOf(x) !== i), 'linhas repetidas').toEqual([]);
    expect([...real].filter((x) => !mine.includes(x)).sort(), 'rotas sem linha na matriz').toEqual([]);
    expect(mine.filter((x) => !real.has(x)).sort(), 'linhas de rotas que não existem').toEqual([]);
    // Todos os perfis em toda linha.
    expect(MATRIX.filter((m) => ACTORS.some((a) => m.policy[a] === undefined)).map((m) => m.route)).toEqual([]);
  });

  it.each(MATRIX.map((m) => [m.route, m] as const))('%s', async (_label, row) => {
    const [method = 'GET'] = row.route.split(' ');
    const path = row.path({ ids });
    const failures: string[] = [];
    for (const actor of ACTORS) {
      // Sessão nova por chamada: logout, troca de senha ou "sair de todos" numa rota não afetam as próximas.
      if (actor !== 'visitante') await h.login(keyOf[actor], { tfa: actor !== 'adminSem2fa' });
      const res = await h.call(actor === 'visitante' ? null : keyOf[actor], method, path, method === 'GET' || method === 'DELETE' ? undefined : (row.body?.({ ids }) ?? {}));
      const want = row.policy[actor];
      const ok =
        typeof want === 'number'
          ? res.status === want
          : want === 'allow'
            ? res.status !== 401 && res.status !== 403
            : actor === 'visitante'
              ? res.status === 401
              : // Recurso de outra pessoa ou campeonato alheio: 404 também nega (não revela que existe).
                res.status === 403 || res.status === 404 || (row.limited === true && res.status === 429);
      if (!ok) failures.push(`${actor}: esperado ${String(want)}, veio ${res.status} ${res.code ?? ''}`);
    }
    expect(failures, `${row.route} (${path})${row.note ? ` — ${row.note}` : ''}`).toEqual([]);
  });

  it('Admin sem o 2FA feito recebe 403 TWO_FACTOR_REQUIRED no painel (e não o 403 comum)', async () => {
    await h.login('adm0', { tfa: false });
    const res = await h.call('adm0', 'GET', '/admin/users');
    expect(res.status).toBe(403);
    expect(res.code).toBe('TWO_FACTOR_REQUIRED');
  });
});
