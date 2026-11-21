/**
 * Visão global dos campeonatos e comunicados globais (issue #93, ADM-05, ADM-11, RF-23). Porta de
 * `apps/web/mocks/handlers/admin-tournaments.ts`.
 *
 * - `GET /admin/tournaments` (todos, inclusive rascunhos; busca, status e a fila "Sem responsável"), destacar na home,
 *   trocar o responsável, cancelar, arquivar e as fases com a chave travada. Destravar é `POST /stages/:id/unlock`
 *   (módulo de competição).
 * - Comunicados globais: banner, aviso de manutenção (aparece 48 h antes) e notificação por público. A notificação para
 *   públicos grandes sai **em lotes pela fila** (`/jobs/announcements/deliver`, um lote por mensagem do QStash): uma
 *   função não notifica milhares de pessoas de uma vez.
 * - `GET /site/banner` (público): o que aparece no topo do site para quem está vendo.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import {
  ACTIVE_REGISTRATION_STATUSES,
  AdminCancelTournamentInput,
  AdminTournament,
  AdminTournamentPatch,
  ChangeOwnerInput,
  GlobalAnnouncement,
  GlobalAnnouncementInput,
  GlobalAnnouncementPatch,
  LockedStage,
  numberedPage,
  SiteBannerItem,
  TournamentStatus,
} from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditContext, requireAdmin } from '../../auth/admin';
import { currentRoles } from '../../auth/rbac';
import { currentSession } from '../../auth/session';
import { isLocked, readRun } from '../../competition/run';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, notFound } from '../../errors';
import { requireQStash } from '../../jobs';
import { runJob } from '../../jobs/runner';
import { notify } from '../../notify';
import { revalidateTournaments } from '../../revalidate';
import { markUnchanged } from '../site/events';
import { countsOf } from '../tournaments/views';
import { AfterCommit, findTournamentRow, isActiveTournament, isUuid, normalize, paginate } from './shared';

const HOUR_MS = 3600_000;
/** O aviso de manutenção aparece no site 48 h antes do início. */
const MAINTENANCE_NOTICE_MS = 48 * HOUR_MS;
/** Notificação global: até este tamanho sai na própria requisição; acima, em lotes pela fila. */
export const ANNOUNCEMENT_BATCH = 200;
export const ANNOUNCEMENT_JOB_PATH = '/jobs/announcements/deliver';

export const adminTournaments = new Hono<AppEnv>();

// ── Campeonatos ──────────────────────────────────────────────────────
type TournamentRow = Awaited<ReturnType<typeof findTournamentRow>>;

async function toAdminTournaments(db: PrismaClient, rows: TournamentRow[]): Promise<AdminTournament[]> {
  const ids = rows.map((t) => t.id);
  const [counts, orphans] = await Promise.all([countsOf(db, ids), db.orphanTournament.findMany({ where: { tournamentId: { in: ids } }, select: { tournamentId: true } })]);
  const orphan = new Set(orphans.map((o) => o.tournamentId));
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    gameName: t.game.name,
    status: t.status,
    ownerId: t.ownerId,
    ownerNickname: t.owner.nickname,
    featured: t.featured,
    takenSlots: counts.get(t.id)?.takenSlots ?? 0,
    maxParticipants: t.maxParticipants,
    startsAt: t.startsAt?.toISOString() ?? null,
    hasOwner: !orphan.has(t.id) && t.owner.status === 'ACTIVE',
  }));
}

const tournamentInclude = { game: { select: { name: true } }, owner: { select: { id: true, nickname: true, status: true } } } as const;

adminTournaments.get('/admin/tournaments', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const term = normalize((c.req.query('q') ?? '').trim());
  const status = TournamentStatus.safeParse(c.req.query('status'));
  const orphanOnly = c.req.query('orphan') === 'true';
  const orphanIds = orphanOnly ? (await db.orphanTournament.findMany({ select: { tournamentId: true } })).map((o) => o.tournamentId) : [];
  const rows = await db.tournament.findMany({
    where: {
      ...(status.success ? { status: status.data } : {}),
      ...(orphanOnly ? { OR: [{ id: { in: orphanIds } }, { owner: { status: { not: 'ACTIVE' } } }] } : {}),
    },
    include: tournamentInclude,
    orderBy: { name: 'asc' },
    take: 5000,
  });
  const all = await toAdminTournaments(db, rows);
  const filtered = all
    .filter((t) => !orphanOnly || !t.hasOwner)
    .filter((t) => !term || [t.name, t.slug, t.gameName, t.ownerNickname].some((text) => normalize(text).includes(term)))
    .sort((a, b) => Number(a.hasOwner) - Number(b.hasOwner) || a.name.localeCompare(b.name, 'pt-BR'));
  return respond(c, numberedPage(AdminTournament), paginate(filtered, c.req.query('page')));
});

async function viewOf(c: AppContext, id: string): Promise<AdminTournament> {
  const db = c.get('deps').db();
  const [view] = await toAdminTournaments(db, [await findTournamentRow(db, id)]);
  return view as AdminTournament;
}

adminTournaments.patch('/admin/tournaments/:id', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const t = await findTournamentRow(db, c.req.param('id'));
  const { featured } = await body(c, AdminTournamentPatch);
  if (featured && !isActiveTournament(t.status) && t.status !== 'FINISHED') {
    throw conflict('Só dá para destacar um campeonato publicado. Rascunhos, cancelados e arquivados não aparecem na home.', 'NOT_PUBLIC');
  }
  if (t.featured !== featured) {
    await withAudit(db, await auditContext(c), async (tx) => {
      await tx.tournament.update({ where: { id: t.id }, data: { featured } });
      await audited(tx, { action: 'TOURNAMENT_FEATURED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { featured: t.featured }, after: { featured } });
    });
    revalidateTournaments(c);
    await new AfterCommit().publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id }).flush(c);
  } else markUnchanged(c);
  return respond(c, AdminTournament, await viewOf(c, t.id));
});

adminTournaments.post('/admin/tournaments/:id/owner', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const t = await findTournamentRow(db, c.req.param('id'));
  const input = await body(c, ChangeOwnerInput);
  const next = isUuid(input.ownerId) ? await db.user.findUnique({ where: { id: input.ownerId }, include: { roles: true } }) : null;
  if (!next) throw badRequest('Usuário não encontrado.', 'VALIDATION', { ownerId: 'Escolha um organizador da lista.' });
  if (!next.roles.some((r) => r.role === 'ORGANIZER') || next.status !== 'ACTIVE') {
    throw badRequest('O novo responsável precisa ser um organizador com a conta ativa.', 'NOT_ORGANIZER', { ownerId: 'Escolha um organizador com a conta ativa.' });
  }
  const orphan = await db.orphanTournament.findUnique({ where: { tournamentId: t.id } });
  const hadOwner = !orphan && t.owner.status === 'ACTIVE';
  if (next.id === t.ownerId && hadOwner) throw conflict(`${next.nickname} já é responsável por este campeonato.`, 'SAME_OWNER');
  await withAudit(db, await auditContext(c, input.reason), async (tx) => {
    await tx.tournament.update({ where: { id: t.id }, data: { ownerId: next.id } });
    await tx.tournamentStaff.deleteMany({ where: { tournamentId: t.id, userId: next.id } });
    await tx.orphanTournament.deleteMany({ where: { tournamentId: t.id } });
    await audited(tx, {
      action: 'TOURNAMENT_OWNER_CHANGED',
      entityType: 'Tournament',
      entityId: t.id,
      entityLabel: t.name,
      tournamentId: t.id,
      before: { ownerId: t.ownerId, responsavel: t.owner.nickname, semResponsavel: !hadOwner },
      after: { ownerId: next.id, responsavel: next.nickname, semResponsavel: false },
      reason: input.reason,
    });
  });
  const after = new AfterCommit().notify([next.id], { type: 'ANNOUNCEMENT', title: 'Você agora é responsável por um campeonato', body: `A administração passou "${t.name}" para você. Motivo: ${input.reason}`, link: `/organizador/campeonatos/${t.id}` });
  if (t.ownerId !== next.id) after.notify([t.ownerId], { type: 'ANNOUNCEMENT', title: 'Você deixou de ser responsável por um campeonato', body: `A administração passou "${t.name}" para ${next.nickname}. Motivo: ${input.reason}`, link: null });
  await after.publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id }).flush(c);
  revalidateTournaments(c);
  return respond(c, AdminTournament, await viewOf(c, t.id));
});

/** O Admin cancela em qualquer estado que ainda não terminou (inclusive em andamento). */
adminTournaments.post('/admin/tournaments/:id/cancel', async (c) => {
  const actor = await requireAdmin(c);
  const db = c.get('deps').db();
  const t = await findTournamentRow(db, c.req.param('id'));
  const { reason } = await body(c, AdminCancelTournamentInput);
  if (t.status === 'CANCELLED') throw conflict('Este campeonato já está cancelado.', 'INVALID_TRANSITION');
  if (t.status === 'FINISHED' || t.status === 'ARCHIVED') throw conflict('Campeonato finalizado não pode ser cancelado. Você pode arquivá-lo.', 'INVALID_TRANSITION');
  const wasPublic = isActiveTournament(t.status);
  await withAudit(db, await auditContext(c, reason), async (tx) => {
    // Corrida entre dois cliques: só muda se o status ainda é o que lemos.
    const { count } = await tx.tournament.updateMany({ where: { id: t.id, status: t.status }, data: { status: 'CANCELLED', featured: false, statusReason: reason } });
    if (count === 0) throw conflict('O status do campeonato mudou enquanto você agia. Atualize a página.', 'INVALID_TRANSITION');
    await tx.orphanTournament.deleteMany({ where: { tournamentId: t.id } });
    // Quem acompanha a página pública fica sabendo o motivo.
    if (wasPublic) await tx.announcement.create({ data: { tournamentId: t.id, authorId: actor.id, title: 'Campeonato cancelado', body: reason } });
    await audited(tx, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: t.status }, after: { status: 'CANCELLED' }, reason });
  });
  const after = new AfterCommit().notify([t.ownerId], { type: 'ANNOUNCEMENT', title: 'Campeonato cancelado pela administração', body: `${t.name}: ${reason}`, link: `/c/${t.slug}` });
  if (wasPublic) after.publish(`tournament:${t.id}`, { type: 'announcement.created', tournamentId: t.id, title: 'Campeonato cancelado' });
  await after.publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id }).flush(c);
  revalidateTournaments(c);
  return respond(c, AdminTournament, await viewOf(c, t.id));
});

adminTournaments.post('/admin/tournaments/:id/archive', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const t = await findTournamentRow(db, c.req.param('id'));
  if (t.status === 'ARCHIVED') throw conflict('Este campeonato já está arquivado.', 'INVALID_TRANSITION');
  if (t.status !== 'FINISHED' && t.status !== 'CANCELLED') throw conflict('Só dá para arquivar campeonato finalizado ou cancelado.', 'INVALID_TRANSITION');
  await withAudit(db, await auditContext(c), async (tx) => {
    const { count } = await tx.tournament.updateMany({ where: { id: t.id, status: t.status }, data: { status: 'ARCHIVED', featured: false } });
    if (count === 0) throw conflict('O status do campeonato mudou enquanto você agia. Atualize a página.', 'INVALID_TRANSITION');
    await audited(tx, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: t.status }, after: { status: 'ARCHIVED' } });
  });
  await new AfterCommit().publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id }).flush(c);
  revalidateTournaments(c);
  return respond(c, AdminTournament, await viewOf(c, t.id));
});

/** Fases com a chave travada (RN-07): já têm partida concluída. */
adminTournaments.get('/admin/tournaments/:id/locked-stages', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const t = await findTournamentRow(db, c.req.param('id'));
  const stages = await db.stage.findMany({ where: { tournamentId: t.id, confirmedAt: { not: null } }, select: { id: true, name: true, engineSnapshot: true, confirmedAt: true, unlocked: true }, orderBy: { order: 'asc' } });
  const locked: LockedStage[] = [];
  for (const stage of stages) {
    const run = readRun(stage);
    if (!run || !isLocked(run)) continue;
    locked.push({ stageId: stage.id, stageName: stage.name, tournamentId: t.id, tournamentName: t.name, completedMatches: Object.values(run.state.results).filter((r) => !r.voided).length });
  }
  return respond(c, z.array(LockedStage), locked);
});

// ── Comunicados globais ──────────────────────────────────────────────
type Audience = GlobalAnnouncement['audience'];
const AUDIENCE_LABEL: Record<Audience, string> = { ALL: 'Todos', ORGANIZERS: 'Organizadores', GAME: 'Inscritos de um jogo' };
const KINDS = ['BANNER', 'NOTIFICATION', 'MAINTENANCE'] as const;

function parseAudience(value: string): { audience: Audience; gameId: string | null } {
  if (value.startsWith('GAME:')) return { audience: 'GAME', gameId: value.slice(5) || null };
  return { audience: value === 'ORGANIZERS' ? 'ORGANIZERS' : 'ALL', gameId: null };
}

type AnnouncementRow = { id: string; title: string; body: string; kind: string | null; audience: string; startsAt: Date | null; endsAt: Date | null; active: boolean; authorId: string; createdAt: Date };
function toGlobalAnnouncement(a: AnnouncementRow, authors: Map<string, string>): GlobalAnnouncement {
  const { audience, gameId } = parseAudience(a.audience);
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    kind: (KINDS as readonly string[]).includes(a.kind ?? '') ? (a.kind as GlobalAnnouncement['kind']) : 'BANNER',
    audience,
    gameId,
    startsAt: a.startsAt?.toISOString() ?? null,
    endsAt: a.endsAt?.toISOString() ?? null,
    active: a.active,
    authorNickname: authors.get(a.authorId) ?? 'Administração',
    createdAt: a.createdAt.toISOString(),
  };
}

async function authorsOf(db: PrismaClient, rows: { authorId: string }[]) {
  const ids = [...new Set(rows.map((r) => r.authorId))];
  return new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true } })).map((u) => [u.id, u.nickname]));
}

const GLOBAL = { tournamentId: null, kind: { not: null } } satisfies Prisma.AnnouncementWhereInput;

/** Quem recebe: contas ativas do público (organizadores; quem joga — inscrição ativa — ou segue o jogo; todos). */
export function audienceWhere(audience: Audience, gameId: string | null): Prisma.UserWhereInput {
  if (audience === 'ORGANIZERS') return { status: 'ACTIVE', roles: { some: { role: 'ORGANIZER' } } };
  if (audience === 'GAME' && gameId) {
    return {
      status: 'ACTIVE',
      OR: [
        { registrations: { some: { status: { in: ACTIVE_REGISTRATION_STATUSES }, tournament: { gameId } } } },
        { registrationMembers: { some: { registration: { status: { in: ACTIVE_REGISTRATION_STATUSES }, tournament: { gameId } } } } },
        { follows: { some: { targetType: 'GAME', targetId: gameId } } },
      ],
    };
  }
  return { status: 'ACTIVE' };
}

adminTournaments.get('/admin/announcements', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const rows = await db.announcement.findMany({ where: GLOBAL, orderBy: { createdAt: 'desc' }, take: 200 });
  const authors = await authorsOf(db, rows);
  return respond(
    c,
    z.array(GlobalAnnouncement),
    rows.map((r) => toGlobalAnnouncement(r, authors)),
  );
});

/** Envia um lote da notificação global e diz de onde continuar (`null` = acabou). */
export async function deliverAnnouncementBatch(c: AppContext, announcementId: string, afterUserId: string | null): Promise<{ sent: number; next: string | null }> {
  const db = c.get('deps').db();
  const a = await db.announcement.findUnique({ where: { id: announcementId } });
  if (!a || a.kind !== 'NOTIFICATION' || a.tournamentId !== null) return { sent: 0, next: null };
  const { audience, gameId } = parseAudience(a.audience);
  const batch = await db.user.findMany({ where: { ...audienceWhere(audience, gameId), ...(afterUserId ? { id: { gt: afterUserId } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: ANNOUNCEMENT_BATCH });
  if (batch.length === 0) return { sent: 0, next: null };
  await notify(
    c,
    batch.map((u) => u.id),
    { type: 'ANNOUNCEMENT', title: a.title, body: a.body, link: null },
  );
  return { sent: batch.length, next: batch.length < ANNOUNCEMENT_BATCH ? null : (batch[batch.length - 1]?.id ?? null) };
}

/** Agenda o próximo lote na fila. Sem QStash (local), entrega o resto na hora. */
async function continueDelivery(c: AppContext, announcementId: string, after: string): Promise<void> {
  const env = c.get('env');
  if (env.QSTASH_TOKEN && env.NEXT_PUBLIC_SITE_URL) {
    await c
      .get('deps')
      .queue(env, c.get('log'))
      .schedule({ path: ANNOUNCEMENT_JOB_PATH, body: { announcementId, after }, at: c.get('deps').now(), dedupId: `announcement-${announcementId}-${after}` });
    return;
  }
  let cursor: string | null = after;
  while (cursor) cursor = (await deliverAnnouncementBatch(c, announcementId, cursor)).next;
}

adminTournaments.post('/admin/announcements', async (c) => {
  const actor = await requireAdmin(c);
  const input = await body(c, GlobalAnnouncementInput);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const errors: Record<string, string> = {};
  const game = input.audience === 'GAME' && isUuid(input.gameId) ? await db.game.findUnique({ where: { id: input.gameId }, select: { id: true, name: true } }) : null;
  if (input.audience === 'GAME' && !game) errors.gameId = 'Escolha o jogo';
  if (input.kind === 'MAINTENANCE') {
    if (!input.startsAt) errors.startsAt = 'Informe quando a manutenção começa';
    if (!input.endsAt) errors.endsAt = 'Informe quando a manutenção termina';
  }
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) errors.endsAt = 'O fim precisa ser depois do início';
  if (input.endsAt && !errors.endsAt && Date.parse(input.endsAt) <= now.getTime()) errors.endsAt = 'O fim precisa estar no futuro';
  if (Object.keys(errors).length > 0) throw badRequest('Confira os campos destacados.', 'VALIDATION', errors);

  const isNotification = input.kind === 'NOTIFICATION';
  const audience = input.audience === 'GAME' ? `GAME:${game?.id ?? ''}` : input.audience;
  const recipients = isNotification ? await db.user.count({ where: audienceWhere(input.audience, game?.id ?? null) }) : null;
  const record = await withAudit(db, await auditContext(c), async (tx) => {
    const created = await tx.announcement.create({
      data: {
        tournamentId: null,
        authorId: actor.id,
        title: input.title.trim(),
        body: input.body.trim(),
        kind: input.kind,
        audience,
        startsAt: isNotification || !input.startsAt ? null : new Date(input.startsAt),
        endsAt: isNotification || !input.endsAt ? null : new Date(input.endsAt),
        // Notificação é envio único: não fica "ativa" no topo do site.
        active: !isNotification,
        recipients,
      },
    });
    await audited(tx, {
      action: 'ANNOUNCEMENT_SENT',
      entityType: 'GlobalAnnouncement',
      entityId: created.id,
      entityLabel: created.title,
      after: {
        tipo: created.kind,
        publico: game ? `${AUDIENCE_LABEL[input.audience]}: ${game.name}` : AUDIENCE_LABEL[input.audience],
        ...(isNotification ? { destinatarios: recipients } : { inicio: created.startsAt?.toISOString() ?? null, fim: created.endsAt?.toISOString() ?? null }),
      },
    });
    return created;
  });
  if (isNotification) {
    try {
      const first = await deliverAnnouncementBatch(c, record.id, null);
      if (first.next) await continueDelivery(c, record.id, first.next);
    } catch (error) {
      c.get('log').error('falha ao entregar a notificação global', { announcementId: record.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return respond(c, GlobalAnnouncement, toGlobalAnnouncement(record, await authorsOf(db, [record])), 201);
});

adminTournaments.patch('/admin/announcements/:id', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const record = isUuid(id) ? await db.announcement.findFirst({ where: { id, ...GLOBAL } }) : null;
  if (!record) throw notFound('Comunicado');
  const { active } = await body(c, GlobalAnnouncementPatch);
  if (record.kind === 'NOTIFICATION') throw conflict('Notificação já enviada não pode ser ativada nem desativada.', 'NOT_TOGGLEABLE');
  let saved = record;
  if (record.active !== active) {
    saved = await withAudit(db, await auditContext(c), async (tx) => {
      const updated = await tx.announcement.update({ where: { id: record.id }, data: { active } });
      await audited(tx, { action: 'ANNOUNCEMENT_TOGGLED', entityType: 'GlobalAnnouncement', entityId: record.id, entityLabel: record.title, before: { active: record.active }, after: { active } });
      return updated;
    });
  } else markUnchanged(c);
  return respond(c, GlobalAnnouncement, toGlobalAnnouncement(saved, await authorsOf(db, [saved])));
});

/** Lote da notificação global, entregue pelo QStash (assinado). Idempotente o bastante: o cursor anda por id. */
adminTournaments.post(ANNOUNCEMENT_JOB_PATH, requireQStash, async (c) => {
  const parsed = z.object({ announcementId: z.uuid(), after: z.uuid().nullable() }).safeParse(c.get('jobBody'));
  if (!parsed.success) throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  const { announcementId, after } = parsed.data;
  const result = await runJob(c, 'jobs/announcements/deliver', 'qstash', () => deliverAnnouncementBatch(c, announcementId, after));
  if (result.next) await continueDelivery(c, announcementId, result.next);
  return c.json({ ok: true, sent: result.sent, done: result.next === null });
});

// ── Aviso no topo do site (público) ──────────────────────────────────
async function inAudience(c: AppContext, audience: Audience, gameId: string | null, userId: string | null): Promise<boolean> {
  if (audience === 'ALL') return true;
  if (!userId) return false;
  if (audience === 'ORGANIZERS') {
    const roles = await currentRoles(c);
    return roles.some((r) => r === 'ORGANIZER' || r === 'ADMIN' || r === 'SUPER_ADMIN');
  }
  if (!gameId) return false;
  return (await c.get('deps').db().user.count({ where: { id: userId, ...audienceWhere('GAME', gameId) } })) > 0;
}

adminTournaments.get('/site/banner', async (c) => {
  const db = c.get('deps').db();
  const now = c.get('deps').now().getTime();
  const session = await currentSession(c);
  const rows = await db.announcement.findMany({
    where: { tournamentId: null, active: true, kind: { in: ['BANNER', 'MAINTENANCE'] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date(now) } }] },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const items: SiteBannerItem[] = [];
  for (const a of rows) {
    const { audience, gameId } = parseAudience(a.audience);
    const start = a.startsAt?.getTime() ?? null;
    if (a.kind === 'MAINTENANCE') {
      if (start === null || now < start - MAINTENANCE_NOTICE_MS) continue;
    } else if (start !== null && now < start) continue;
    if (!(await inAudience(c, audience, gameId, session?.userId ?? null))) continue;
    const ongoing = a.kind === 'MAINTENANCE' && start !== null && now >= start;
    items.push({ id: a.id, kind: a.kind === 'MAINTENANCE' ? 'MAINTENANCE' : 'BANNER', title: a.title, body: a.body, startsAt: a.startsAt?.toISOString() ?? null, endsAt: a.endsAt?.toISOString() ?? null, ongoing, dismissible: !ongoing });
  }
  // Manutenção em curso primeiro; depois as manutenções; depois os banners (mais recentes primeiro).
  items.sort((x, y) => Number(y.ongoing) - Number(x.ongoing) || Number(y.kind === 'MAINTENANCE') - Number(x.kind === 'MAINTENANCE'));
  // Depende de quem está vendo: não pode ficar em cache compartilhado.
  c.header('Cache-Control', 'private, no-store');
  return respond(c, z.array(SiteBannerItem), items);
});
