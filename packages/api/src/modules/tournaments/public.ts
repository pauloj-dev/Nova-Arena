/**
 * Leitura pública dos campeonatos e comunicados (issue #76, PAR-02, ORG-11). Porta de
 * `apps/web/mocks/handlers/tournaments.ts` e dos comunicados de `tournaments-ops.ts`.
 *
 * - Lista com filtros, busca e paginação por cursor (opaco). Rascunho e arquivado não aparecem; cancelado só
 *   com filtro de status. Ordem da vitrine: o que dá para se inscrever agora vem primeiro.
 * - Detalhe pelo endereço: rascunho só para a organização e o Admin (para os outros, 404).
 * - Comunicados: para todos, uma fase ou um grupo; enviar e apagar é da organização (não do moderador);
 *   auditados. A entrega por notificação chega com a issue #98.
 */
import { audited, withAudit, type Prisma } from '@nova/db';
import { Announcement, AnnouncementInput, page, Tournament, TournamentAccess, TournamentListQuery, TournamentSummary, type TournamentStatus } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, notFound } from '../../errors';
import { assertTournamentAccess, currentRoles, tournamentAccessDecision } from '../../auth/rbac';
import { currentSession, requireSession } from '../../auth/session';
import { clientIp } from '../../security';
import { revalidateTournaments } from '../../revalidate';
import { accessRole, countsOf, toTournament, toTournamentSummary, tournamentInclude } from './views';

const HIDDEN: TournamentStatus[] = ['DRAFT', 'ARCHIVED'];
const STATUS_GROUPS: Record<string, TournamentStatus[]> = {
  open: ['REGISTRATION_OPEN'],
  upcoming: ['PUBLISHED', 'REGISTRATION_CLOSED', 'CHECK_IN'],
  live: ['IN_PROGRESS', 'PAUSED'],
  finished: ['FINISHED'],
};
// Ordem da vitrine: o que dá para se inscrever agora vem primeiro.
const ORDER: TournamentStatus[] = ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CHECK_IN', 'PUBLISHED', 'REGISTRATION_CLOSED', 'PAUSED', 'FINISHED', 'CANCELLED'];

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^o:(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!match) throw badRequest('Filtros inválidos.', 'VALIDATION', { cursor: 'Página inválida' });
  return Number(match[1]);
}

/** Papel de quem está vendo (ou nulo), sem lançar erro. */
async function viewerAccess(c: AppContext, t: { id: string; ownerId: string }) {
  const session = await currentSession(c);
  if (!session) return null;
  const staff = await c.get('deps').db().tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  const via = tournamentAccessDecision({ userId: session.userId, roles: await currentRoles(c), ownerId: t.ownerId, staffRole: staff?.role ?? null, level: 'moderate' });
  return via ? accessRole(via) : null;
}

/** Rascunho é visível só para a organização e o Admin. */
async function findVisible(c: AppContext, idOrSlug: string) {
  const t = await c.get('deps').db().tournament.findUnique({ where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }, include: tournamentInclude });
  if (!t) throw notFound('Campeonato');
  if (t.status === 'DRAFT' && (await viewerAccess(c, t)) === null) throw notFound('Campeonato');
  return t;
}

export const publicTournaments = new Hono<AppEnv>();

publicTournaments.get('/tournaments', async (c) => {
  const parsed = TournamentListQuery.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('Filtros inválidos.', 'VALIDATION');
  const f = parsed.data;
  const offset = decodeCursor(f.cursor);
  const db = c.get('deps').db();

  const statuses = f.status ? (STATUS_GROUPS[f.status] ?? []) : ORDER.filter((s) => s !== 'CANCELLED');
  const where: Prisma.TournamentWhereInput = {
    status: { in: statuses.filter((s) => !HIDDEN.includes(s)) },
    ...(f.q?.trim() ? { name: { contains: f.q.trim(), mode: 'insensitive' } } : {}),
    ...(f.game ? { game: { slug: f.game } } : {}),
    ...(f.mode ? { participantType: f.mode } : {}),
    ...(f.from ? { startsAt: { gte: new Date(`${f.from}T00:00:00Z`) } } : {}),
    ...(f.verified ? { owner: { organizerLimits: { verified: true } } } : {}),
    ...(f.featured ? { featured: true } : {}),
    ...(f.slots ? { status: 'REGISTRATION_OPEN' } : {}),
  };
  // Só as colunas da ordenação; o resto é carregado apenas para a página pedida.
  let keys = await db.tournament.findMany({ where, select: { id: true, status: true, featured: true, startsAt: true, maxParticipants: true } });
  if (f.slots) {
    const counts = await countsOf(db, keys.map((k) => k.id));
    keys = keys.filter((k) => (counts.get(k.id)?.takenSlots ?? 0) < k.maxParticipants);
  }
  keys.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(b.featured) - Number(a.featured) || (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
  const pageKeys = keys.slice(offset, offset + f.limit);
  const rows = await db.tournament.findMany({ where: { id: { in: pageKeys.map((k) => k.id) } }, include: tournamentInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const counts = await countsOf(db, pageKeys.map((k) => k.id));
  const items = pageKeys.flatMap((k) => {
    const row = byId.get(k.id);
    return row ? [toTournamentSummary(row, counts.get(k.id))] : [];
  });
  return respond(c, page(TournamentSummary), { items, nextCursor: offset + f.limit < keys.length ? encodeCursor(offset + f.limit) : null, total: keys.length });
});

publicTournaments.get('/tournaments/:slug', async (c) => {
  const t = await findVisible(c, c.req.param('slug'));
  const counts = (await countsOf(c.get('deps').db(), [t.id])).get(t.id);
  return respond(c, Tournament, toTournament(t, counts));
});

/** Papel de quem está vendo neste campeonato (ou nulo). Usado para o link "Gerenciar campeonato". */
publicTournaments.get('/tournaments/:id/access', async (c) => {
  const t = await findVisible(c, c.req.param('id'));
  return respond(c, TournamentAccess, { access: await viewerAccess(c, t) });
});

// ── Comunicados (ORG-11) ─────────────────────────────────────────────
const announcementInclude = { tournament: { select: { id: true } } } satisfies Prisma.AnnouncementInclude;
type AnnouncementRow = { id: string; tournamentId: string | null; stageId: string | null; groupId: string | null; title: string; body: string; createdAt: Date; authorId: string };

async function toAnnouncements(c: AppContext, rows: AnnouncementRow[]): Promise<Announcement[]> {
  const authors = await c.get('deps').db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, nickname: true } });
  const nick = new Map(authors.map((a) => [a.id, a.nickname]));
  return rows.map((r) => ({ id: r.id, tournamentId: r.tournamentId, stageId: r.stageId, groupId: r.groupId, authorNickname: nick.get(r.authorId) ?? 'Organização', title: r.title, body: r.body, createdAt: r.createdAt.toISOString() }));
}

publicTournaments.get('/tournaments/:id/announcements', async (c) => {
  const t = await findVisible(c, c.req.param('id'));
  const rows = await c.get('deps').db().announcement.findMany({ where: { tournamentId: t.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  return respond(c, z.array(Announcement), await toAnnouncements(c, rows));
});

publicTournaments.post('/tournaments/:id/announcements', async (c) => {
  const db = c.get('deps').db();
  const t = await findVisible(c, c.req.param('id'));
  await assertTournamentAccess(c, t.id, 'manage');
  const session = await requireSession(c);
  const input = await body(c, AnnouncementInput);
  if (t.status === 'DRAFT') throw conflict('Publique o campeonato antes de enviar comunicados.', 'TOURNAMENT_NOT_PUBLISHED');

  let audience = 'Todos os inscritos';
  if (input.stageId === null) {
    if (input.groupId !== null) throw badRequest('Para enviar a um grupo, escolha também a fase.', 'VALIDATION', { groupId: 'Escolha a fase do grupo' });
  } else {
    const stage = t.stages.find((s) => s.id === input.stageId);
    if (!stage) throw badRequest('Esta fase não é deste campeonato.', 'VALIDATION', { stageId: 'Fase inválida' });
    audience = stage.name;
    if (input.groupId !== null) {
      const group = isUuid(input.groupId) ? await db.group.findFirst({ where: { id: input.groupId, stageId: stage.id } }) : null;
      if (!group) throw badRequest('Este grupo não existe na fase escolhida. Gere a chave da fase antes de escrever para um grupo.', 'VALIDATION', { groupId: 'Grupo inválido' });
      audience = `${stage.name} · ${group.name}`;
    }
  }

  const ctx = { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
  const created = await withAudit(db, ctx, async (tx) => {
    const a = await tx.announcement.create({
      data: { tournamentId: t.id, stageId: input.stageId, groupId: input.groupId, authorId: session.userId, title: input.title.trim(), body: input.body.trim(), audience: input.groupId ?? input.stageId ?? 'ALL' },
    });
    await audited(tx, { action: 'ANNOUNCEMENT_SENT', entityType: 'Announcement', entityId: a.id, entityLabel: `${t.name} · ${a.title}`, tournamentId: t.id, after: { publico: audience } });
    return a;
  });
  revalidateTournaments(c);
  const [view] = await toAnnouncements(c, [created]);
  return respond(c, Announcement, view as Announcement, 201);
});

publicTournaments.delete('/announcements/:id', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const announcement = isUuid(id) ? await db.announcement.findUnique({ where: { id }, include: announcementInclude }) : null;
  // Comunicado global (sem campeonato) é do painel Admin, não daqui.
  if (!announcement || announcement.tournamentId === null) throw notFound('Comunicado');
  const tournamentId = announcement.tournamentId;
  await assertTournamentAccess(c, tournamentId, 'manage');
  const session = await requireSession(c);
  const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { name: true } });
  await withAudit(db, { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null }, async (tx) => {
    await tx.announcement.delete({ where: { id } });
    await audited(tx, { action: 'ANNOUNCEMENT_DELETED', entityType: 'Announcement', entityId: id, entityLabel: `${t.name} · ${announcement.title}`, tournamentId, before: { titulo: announcement.title } });
  });
  revalidateTournaments(c);
  return c.body(null, 204);
});

