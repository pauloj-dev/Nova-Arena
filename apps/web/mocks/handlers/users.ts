/**
 * Módulo `users` da API simulada: conta (`/me`), IDs de jogo, pedido de organizador,
 * perfil público, seguir campeonato/jogo (RN-15) e convites de papel (PRD §7.3).
 */
import { http, type HttpHandler } from 'msw';
import {
  FollowTargetType,
  OrganizerRequestInput,
  UpdateMeInput,
  UpsertGameAccountInput,
  type FollowList,
  type OrganizerRequest,
  type RoleInvitePreview,
} from '@nova/schemas';
import { db, nowIso, save, uid, type DbOrganizerRequest, type DbRoleInvite, type DbUser } from '../db';
import { badRequest, body, conflict, forbidden, handle, HttpProblem, json, notFound, param, requireUser, tournamentAccess, url, type HandlerArgs } from '../http';
import { findUser, toMe, toPublicUser } from '../views';

export const moduleName = 'users';

/** Avatar recortado no navegador: data URL de imagem, com folga sobre os ~200 KB que a tela gera. */
const MAX_AVATAR_CHARS = 400_000;
const AVATAR_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Caminhos de `/users/...` que pertencem a outros módulos (ex.: busca por apelido nos convites de squad). */
const RESERVED_USER_PATHS = new Set(['search']);

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

// ── Pedido de organizador ────────────────────────────────────────────
function toOrganizerRequest(r: DbOrganizerRequest): OrganizerRequest {
  return { id: r.id, userId: r.userId, justification: r.justification, status: r.status, reviewReason: r.reviewReason, createdAt: r.createdAt, reviewedAt: r.reviewedAt };
}

// ── Seguir ───────────────────────────────────────────────────────────
function followList(user: DbUser): FollowList {
  const mine = db().follows.filter((f) => f.userId === user.id);
  return {
    tournaments: mine.filter((f) => f.targetType === 'TOURNAMENT').map((f) => f.targetId),
    games: mine.filter((f) => f.targetType === 'GAME').map((f) => f.targetId),
  };
}

/** Confere o tipo e se o alvo existe (e é visível para quem pede). Devolve o tipo no formato do banco e o id canônico. */
function followTarget(params: HandlerArgs['params'], user: DbUser): { targetType: 'TOURNAMENT' | 'GAME'; targetId: string } {
  const type = FollowTargetType.safeParse(param(params, 'type'));
  if (!type.success) throw notFound();
  const id = param(params, 'id');
  const d = db();
  if (type.data === 'game') {
    const game = d.games.find((g) => g.id === id || g.slug === id);
    if (!game) throw notFound('Jogo');
    return { targetType: 'GAME', targetId: game.id };
  }
  const t = d.tournaments.find((x) => x.id === id || x.slug === id);
  // Rascunho não existe para quem não é da organização.
  if (!t || (t.status === 'DRAFT' && tournamentAccess(user, t) === null)) throw notFound('Campeonato');
  return { targetType: 'TOURNAMENT', targetId: t.id };
}

// ── Convites de papel ────────────────────────────────────────────────
function inviteState(invite: DbRoleInvite): RoleInvitePreview['state'] {
  if (invite.revokedAt) return 'REVOKED';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return 'EXPIRED';
  if (invite.uses >= invite.maxUses) return 'EXHAUSTED';
  return 'VALID';
}

function findInvite(token: string): DbRoleInvite {
  const invite = db().roleInvites.find((i) => i.token === token);
  if (!invite) throw notFound('Convite');
  return invite;
}

const INVALID_INVITE: Record<Exclude<RoleInvitePreview['state'], 'VALID'>, { title: string; code: string }> = {
  EXPIRED: { title: 'Este convite expirou. Peça um novo a quem convidou você.', code: 'INVITE_EXPIRED' },
  REVOKED: { title: 'Este convite foi cancelado por quem o criou.', code: 'INVITE_REVOKED' },
  EXHAUSTED: { title: 'Este convite já foi usado o número máximo de vezes.', code: 'INVITE_EXHAUSTED' },
};

export const handlers: HttpHandler[] = [
  // ── Conta ──────────────────────────────────────────────────────────
  http.patch(
    url('/me'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, UpdateMeInput);
      const d = db();

      if (input.nickname !== undefined && input.nickname.toLowerCase() !== user.nickname.toLowerCase()) {
        const taken = d.users.some((u) => u.id !== user.id && u.nickname.toLowerCase() === input.nickname?.toLowerCase());
        if (taken) throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso. Escolha outro.' });
      }
      if (input.avatarUrl) {
        if (!AVATAR_DATA_URL.test(input.avatarUrl)) throw badRequest('A imagem do avatar é inválida.', 'VALIDATION', { avatarUrl: 'Envie uma imagem PNG, JPG ou WebP.' });
        if (input.avatarUrl.length > MAX_AVATAR_CHARS) throw badRequest('A imagem do avatar é grande demais.', 'VALIDATION', { avatarUrl: 'A imagem ficou grande demais. Tente outra foto.' });
      }
      if (input.timezone && !isValidTimeZone(input.timezone)) throw badRequest('Fuso horário inválido.', 'VALIDATION', { timezone: 'Escolha um fuso horário da lista.' });

      if (input.nickname !== undefined) user.nickname = input.nickname;
      if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
      if (input.country !== undefined) user.country = trimOrNull(input.country);
      if (input.state !== undefined) user.state = trimOrNull(input.state);
      if (input.bio !== undefined) user.bio = trimOrNull(input.bio);
      if (input.timezone !== undefined) user.timezone = input.timezone;
      if (input.socials !== undefined) {
        const socials: DbUser['socials'] = {};
        for (const key of ['discord', 'instagram', 'youtube', 'twitch'] as const) {
          const value = trimOrNull(input.socials[key]);
          if (value) socials[key] = value;
        }
        user.socials = socials;
      }
      save();
      return json(toMe(user));
    }),
  ),

  http.put(
    url('/me/game-accounts/:gameId'),
    handle(async ({ request, params }) => {
      const user = requireUser();
      const gameId = param(params, 'gameId');
      const game = db().games.find((g) => g.id === gameId || g.slug === gameId);
      if (!game || !game.active) throw notFound('Jogo');
      const input = await body(request, UpsertGameAccountInput);

      // Só entram os campos que o jogo pede; cada um é obrigatório e segue o formato do jogo.
      const fields: Record<string, string> = {};
      const errors: Record<string, string> = {};
      for (const field of game.requiredAccountFields) {
        const value = (input.fields[field.key] ?? '').trim();
        if (!value) errors[`fields.${field.key}`] = 'Preencha este campo';
        else if (field.pattern && !new RegExp(field.pattern).test(value)) errors[`fields.${field.key}`] = `Confira o formato de "${field.label}"`;
        else fields[field.key] = value;
      }
      if (Object.keys(errors).length > 0) throw badRequest('Confira os campos destacados.', 'VALIDATION', errors);

      const account = { gameId: game.id, fields, updatedAt: nowIso() };
      const index = user.gameAccounts.findIndex((a) => a.gameId === game.id);
      if (index >= 0) user.gameAccounts[index] = account;
      else user.gameAccounts.push(account);
      save();
      return json(toMe(user));
    }),
  ),

  http.delete(
    url('/me/game-accounts/:gameId'),
    handle(({ params }) => {
      const user = requireUser();
      const gameId = param(params, 'gameId');
      const game = db().games.find((g) => g.id === gameId || g.slug === gameId);
      const id = game?.id ?? gameId;
      if (!user.gameAccounts.some((a) => a.gameId === id)) throw notFound('ID de jogo');
      user.gameAccounts = user.gameAccounts.filter((a) => a.gameId !== id);
      save();
      return json(toMe(user));
    }),
  ),

  // ── Pedido para ser organizador (PAR-13) ───────────────────────────
  http.get(
    url('/me/organizer-request'),
    handle(() => {
      const user = requireUser();
      const latest = db()
        .organizerRequests.filter((r) => r.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return json(latest ? toOrganizerRequest(latest) : null);
    }),
  ),

  http.post(
    url('/me/organizer-request'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, OrganizerRequestInput);
      const d = db();
      if (user.roles.includes('ORGANIZER')) throw conflict('Você já é organizador.', 'ALREADY_ORGANIZER');
      if (d.organizerRequests.some((r) => r.userId === user.id && r.status === 'PENDING')) {
        throw conflict('Você já tem um pedido em análise. Aguarde a resposta da administração.', 'REQUEST_PENDING');
      }
      const record: DbOrganizerRequest = {
        id: uid('or'),
        userId: user.id,
        justification: input.justification.trim(),
        status: 'PENDING',
        reviewReason: null,
        reviewedById: null,
        createdAt: nowIso(),
        reviewedAt: null,
      };
      d.organizerRequests.push(record);
      save();
      return json(toOrganizerRequest(record), 201);
    }),
  ),

  // ── Seguir campeonato ou jogo (RN-15) ──────────────────────────────
  http.get(
    url('/me/follows'),
    handle(() => json(followList(requireUser()))),
  ),

  http.put(
    url('/me/follows/:type/:id'),
    handle(({ params }) => {
      const user = requireUser();
      const target = followTarget(params, user);
      const d = db();
      // Idempotente: seguir de novo não duplica.
      if (!d.follows.some((f) => f.userId === user.id && f.targetType === target.targetType && f.targetId === target.targetId)) {
        d.follows.push({ userId: user.id, ...target });
        save();
      }
      return json(followList(user));
    }),
  ),

  http.delete(
    url('/me/follows/:type/:id'),
    handle(({ params }) => {
      const user = requireUser();
      const target = followTarget(params, user);
      const d = db();
      d.follows = d.follows.filter((f) => !(f.userId === user.id && f.targetType === target.targetType && f.targetId === target.targetId));
      save();
      return json(followList(user));
    }),
  ),

  // ── Perfil público ─────────────────────────────────────────────────
  http.get(url('/users/:nickname'), (args) => {
    // `/users/search` e afins são de outros módulos: sem resposta aqui, o MSW passa para o próximo handler.
    if (typeof args.params.nickname === 'string' && RESERVED_USER_PATHS.has(args.params.nickname)) return undefined;
    return handle(({ params }) => {
      const nickname = decodeURIComponent(param(params, 'nickname')).toLowerCase();
      const user = db().users.find((u) => u.nickname.toLowerCase() === nickname);
      // Conta excluída ou mesclada some do site. O que sai é só `PublicUser`: sem e-mail e sem IDs de jogo (RNF-10).
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');
      return json(toPublicUser(user));
    })(args);
  }),

  // ── Convites de Admin/Organizador (PRD §7.3) ───────────────────────
  http.get(
    url('/role-invites/:token'),
    handle(({ params }) => {
      const invite = findInvite(param(params, 'token'));
      const preview: RoleInvitePreview = {
        role: invite.role,
        state: inviteState(invite),
        invitedBy: findUser(invite.createdById)?.nickname ?? 'Nova Arena',
        expiresAt: invite.expiresAt,
      };
      return json(preview);
    }),
  ),

  http.post(
    url('/role-invites/:token/accept'),
    handle(({ params }) => {
      const user = requireUser();
      const invite = findInvite(param(params, 'token'));

      // Convite inválido: 410 e nada muda (nenhum papel concedido, `uses` intacto).
      const state = inviteState(invite);
      if (state !== 'VALID') throw new HttpProblem(410, INVALID_INVITE[state].title, INVALID_INVITE[state].code);

      if (!user.emailVerified) throw new HttpProblem(403, 'Confirme seu e-mail antes de aceitar o convite.', 'EMAIL_NOT_VERIFIED');
      if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('Este convite foi enviado para outro e-mail.');
      if (user.roles.includes(invite.role)) {
        throw conflict(invite.role === 'ADMIN' ? 'Você já é administrador.' : 'Você já é organizador.', 'ROLE_ALREADY_GRANTED');
      }

      user.roles = [...user.roles, invite.role];
      // RN-10: organizador novo começa com o limite padrão (3 simultâneos, todos os jogos).
      if (invite.role === 'ORGANIZER' && !user.organizerLimits) user.organizerLimits = { maxActiveTournaments: 3, allowedGameIds: [] };
      invite.uses += 1;
      save();
      return json({ role: invite.role, user: toMe(user) });
    }),
  ),
];
