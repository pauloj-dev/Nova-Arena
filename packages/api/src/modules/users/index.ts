/**
 * Perfil (issue #72): editar a própria conta, IDs de jogo, pedido para virar organizador e perfil público.
 * Porta de `apps/web/mocks/handlers/users.ts`: mesmas rotas, mensagens e códigos.
 *
 * - Apelido único sem diferenciar maiúsculas (`nicknameKey`) e passando pelo filtro de nomes (`NewNickname`).
 * - O perfil público é só `PublicUser`: **sem e-mail e sem IDs de jogo** (RNF-10).
 * - IDs de jogo de outra pessoa: só para quem precisa (`canSeeGameAccounts`).
 *
 * Diferença registrada no PR: o avatar ainda é a imagem recortada no navegador (data URL); com o
 * armazenamento da issue #73 ele passa a ser um endereço do Vercel Blob.
 */
import type { Prisma } from '@nova/db';
import { AccountField, GameAccount, Me, OrganizerRequest, OrganizerRequestInput, PublicUser, UpdateMeInput, UpsertGameAccountInput } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { currentRoles } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { canSeeGameAccounts } from '../../auth/visibility';
import { revalidateUser } from '../../revalidate';
import { EDGE_CACHE, publicCache } from '../../http-cache';
import { loadMe, meInclude, toMe } from '../../views';

/** Avatar recortado no navegador: data URL de imagem, com folga sobre os ~200 KB que a tela gera. */
const MAX_AVATAR_CHARS = 400_000;
const AVATAR_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT'] as const;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const trimOrNull = (value: string | null | undefined): string | null => value?.trim() || null;
const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

type OrganizerRequestRow = { id: string; userId: string; justification: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewReason: string | null; createdAt: Date; reviewedAt: Date | null };
const toOrganizerRequest = (r: OrganizerRequestRow): OrganizerRequest => ({
  id: r.id,
  userId: r.userId,
  justification: r.justification,
  status: r.status,
  reviewReason: r.reviewReason,
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

export const users = new Hono<AppEnv>();

users.patch('/me', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, UpdateMeInput);
  const db = c.get('deps').db();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId } });

  const data: Prisma.UserUpdateInput = {};
  if (input.nickname !== undefined && input.nickname.toLowerCase() !== user.nicknameKey) {
    const taken = await db.user.findUnique({ where: { nicknameKey: input.nickname.toLowerCase() }, select: { id: true } });
    if (taken) throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso. Escolha outro.' });
  }
  if (input.nickname !== undefined) Object.assign(data, { nickname: input.nickname, nicknameKey: input.nickname.toLowerCase() });
  if (input.avatarUrl) {
    if (!AVATAR_DATA_URL.test(input.avatarUrl)) throw badRequest('A imagem do avatar é inválida.', 'VALIDATION', { avatarUrl: 'Envie uma imagem PNG, JPG ou WebP.' });
    if (input.avatarUrl.length > MAX_AVATAR_CHARS) throw badRequest('A imagem do avatar é grande demais.', 'VALIDATION', { avatarUrl: 'A imagem ficou grande demais. Tente outra foto.' });
  }
  if (input.timezone && !isValidTimeZone(input.timezone)) throw badRequest('Fuso horário inválido.', 'VALIDATION', { timezone: 'Escolha um fuso horário da lista.' });
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
  if (input.country !== undefined) data.country = trimOrNull(input.country);
  if (input.state !== undefined) data.state = trimOrNull(input.state);
  if (input.bio !== undefined) data.bio = trimOrNull(input.bio);
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.socials !== undefined) {
    const socials: Record<string, string> = {};
    for (const key of ['discord', 'instagram', 'youtube', 'twitch'] as const) {
      const value = trimOrNull(input.socials[key]);
      if (value) socials[key] = value;
    }
    data.socials = socials;
  }

  try {
    const updated = await db.user.update({ where: { id: user.id }, data, include: meInclude });
    // Perfil público em cache: o apelido antigo e o novo.
    revalidateUser(c, user.nicknameKey, updated.nicknameKey);
    return respond(c, Me, toMe(updated));
  } catch (error) {
    // Corrida entre duas pessoas escolhendo o mesmo apelido: a restrição do banco decide.
    if (isUniqueViolation(error)) throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso. Escolha outro.' });
    throw error;
  }
});

/** Jogo por id ou slug, ativo. */
async function activeGame(c: Parameters<typeof requireSession>[0], idOrSlug: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const game = await c
    .get('deps')
    .db()
    .game.findFirst({ where: isUuid ? { id: idOrSlug } : { slug: idOrSlug } });
  return game;
}

users.put('/me/game-accounts/:gameId', async (c) => {
  const session = await requireSession(c);
  const game = await activeGame(c, c.req.param('gameId'));
  if (!game || !game.active) throw notFound('Jogo');
  const input = await body(c, UpsertGameAccountInput);

  // Só entram os campos que o jogo pede; cada um é obrigatório e segue o formato do jogo.
  const required = z.array(AccountField).catch([]).parse(game.requiredAccountFields);
  const fields: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const field of required) {
    const value = (input.fields[field.key] ?? '').trim();
    if (!value) errors[`fields.${field.key}`] = 'Preencha este campo';
    else if (field.pattern && !new RegExp(field.pattern).test(value)) errors[`fields.${field.key}`] = `Confira o formato de "${field.label}"`;
    else fields[field.key] = value;
  }
  if (Object.keys(errors).length > 0) throw badRequest('Confira os campos destacados.', 'VALIDATION', errors);

  const db = c.get('deps').db();
  await db.gameAccount.upsert({ where: { userId_gameId: { userId: session.userId, gameId: game.id } }, create: { userId: session.userId, gameId: game.id, fields }, update: { fields } });
  return respond(c, Me, await loadMe(db, session.userId));
});

users.delete('/me/game-accounts/:gameId', async (c) => {
  const session = await requireSession(c);
  const game = await activeGame(c, c.req.param('gameId'));
  const db = c.get('deps').db();
  const { count } = await db.gameAccount.deleteMany({ where: { userId: session.userId, gameId: game?.id ?? c.req.param('gameId') } });
  if (count === 0) throw notFound('ID de jogo');
  return respond(c, Me, await loadMe(db, session.userId));
});

// ── Pedido para ser organizador (PAR-13): vai para a fila do Admin ──
users.get('/me/organizer-request', async (c) => {
  const session = await requireSession(c);
  const latest = await c.get('deps').db().organizerRequest.findFirst({ where: { userId: session.userId }, orderBy: { createdAt: 'desc' } });
  return respond(c, OrganizerRequest.nullable(), latest ? toOrganizerRequest(latest) : null);
});

users.post('/me/organizer-request', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, OrganizerRequestInput);
  const roles = await currentRoles(c);
  if (roles.includes('ORGANIZER')) throw conflict('Você já é organizador.', 'ALREADY_ORGANIZER');
  const db = c.get('deps').db();
  if (await db.organizerRequest.findFirst({ where: { userId: session.userId, status: 'PENDING' }, select: { id: true } })) {
    throw conflict('Você já tem um pedido em análise. Aguarde a resposta da administração.', 'REQUEST_PENDING');
  }
  const record = await db.organizerRequest.create({ data: { userId: session.userId, justification: input.justification.trim() } });
  return respond(c, OrganizerRequest, toOrganizerRequest(record), 201);
});

// ── Perfil público ──────────────────────────────────────────────────
async function findPublicUser(c: Parameters<typeof requireSession>[0], nickname: string) {
  const user = await c
    .get('deps')
    .db()
    .user.findUnique({ where: { nicknameKey: decodeURIComponent(nickname).toLowerCase() }, include: { roles: true, organizerLimits: { select: { verified: true } } } });
  // Conta excluída ou mesclada some do site.
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');
  return user;
}

users.get('/users/:nickname', async (c) => {
  const user = await findPublicUser(c, c.req.param('nickname'));
  publicCache(c, EDGE_CACHE.profile);
  // Montado campo a campo: nada de e-mail, data de nascimento ou IDs de jogo escapa por engano.
  return respond(c, PublicUser, {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    country: user.country,
    state: user.state,
    bio: user.bio,
    socials: (user.socials ?? {}) as PublicUser['socials'],
    roles: ROLE_ORDER.filter((r) => user.roles.some((x) => x.role === r)),
    verifiedOrganizer: user.organizerLimits?.verified ?? false,
    createdAt: user.createdAt.toISOString(),
  });
});

/** IDs de jogo de outra pessoa: só a organização dos campeonatos dela, os adversários e o Admin. */
users.get('/users/:nickname/game-accounts', async (c) => {
  const session = await requireSession(c);
  const target = await findPublicUser(c, c.req.param('nickname'));
  const roles = await currentRoles(c);
  const db = c.get('deps').db();
  if (!(await canSeeGameAccounts(db, { id: session.userId, roles }, target.id))) {
    throw forbidden('Os IDs de jogo só aparecem para a organização do campeonato e os adversários da partida.', 'GAME_ACCOUNTS_HIDDEN');
  }
  const accounts = await db.gameAccount.findMany({ where: { userId: target.id }, orderBy: { updatedAt: 'desc' } });
  return respond(
    c,
    z.array(GameAccount),
    accounts.map((g) => ({ gameId: g.gameId, fields: g.fields as Record<string, string>, updatedAt: g.updatedAt.toISOString() })),
  );
});
