/**
 * Denúncias e fila de moderação (issue #96, PAR-12, ADM-07, RF-20). Porta de `apps/web/mocks/handlers/reports.ts` e
 * `admin-moderation.ts`.
 *
 * - `POST /reports`: usuário, squad, partida ou resultado, com provas (anexos enviados antes por `/uploads`). O alvo é
 *   conferido e ganha nome e link no momento da denúncia; quem responde por ele (o próprio usuário, o capitão do squad
 *   ou quem enviou o resultado) fica guardado para as ações rápidas. Até 5 em aberto por autor e alvo.
 * - `GET /me/reports`: as minhas denúncias, com o status e a resposta da moderação.
 * - `GET /admin/reports` (fila: abertas primeiro, da mais antiga para a mais nova) e `PATCH /admin/reports/:id`
 *   (fechar exige explicação, que vai para quem denunciou). As ações rápidas usam `POST /admin/users/:id/sanctions`
 *   com `reportId`, que já fecha a denúncia.
 * - `GET /admin/disputes`: disputas escaladas (padrão) ou em outro estado. Os dados de disputa são do módulo de
 *   resultados; aqui só se lê a tabela `disputes`.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { AdminReport, CreateReportInput, Dispute, DisputeStatus, HandleReportInput, numberedPage, Report, ReportStatus, type DisputeMessage } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditContext, requireAdmin } from '../../auth/admin';
import { currentRoles } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { matchView } from '../../competition/bracket';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, notFound } from '../../errors';
import { AfterCommit, isUuid, nicknames, paginate } from '../admin/shared';
import { expireSuspensions } from '../admin/sanctions';
import { chatAccess } from '../chat';

/** Máximo de denúncias em aberto do mesmo autor para o mesmo alvo. */
export const MAX_OPEN_REPORTS_PER_TARGET = 5;
const OPEN: ('OPEN' | 'IN_REVIEW')[] = ['OPEN', 'IN_REVIEW'];

export const reports = new Hono<AppEnv>();

type ReportRow = Prisma.ReportGetPayload<{ include: { reporter: { select: { nickname: true } } } }>;

function toReport(r: ReportRow, names: Map<string, string>): Report {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel || 'Denúncia',
    targetLink: r.targetLink,
    reporterNickname: r.reporter.nickname,
    reason: r.reason as Report['reason'],
    description: r.description,
    evidenceUrls: r.evidenceUrls,
    status: r.status,
    resolution: r.resolution,
    handledByNickname: r.handledById ? (names.get(r.handledById) ?? 'Administração') : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const ownerOf = (r: { targetOwnerUserId: string | null; targetType: string; targetId: string }) => r.targetOwnerUserId ?? (r.targetType === 'USER' ? r.targetId : null);

async function toAdminReports(db: PrismaClient, rows: ReportRow[]): Promise<AdminReport[]> {
  const owners = [...new Set(rows.map(ownerOf).filter((id): id is string => !!id))];
  const [names, users] = await Promise.all([
    nicknames(
      db,
      rows.map((r) => r.handledById),
    ),
    db.user.findMany({ where: { id: { in: owners } }, select: { id: true, nickname: true, status: true } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const owner = byId.get(ownerOf(r) ?? '');
    return { ...toReport(r, names), reporterId: r.reporterId, targetUserId: owner?.id ?? null, targetUserNickname: owner?.nickname ?? null, targetUserStatus: owner?.status ?? null };
  });
}

// ── Alvo da denúncia ─────────────────────────────────────────────────
interface ResolvedTarget {
  targetId: string;
  targetLabel: string;
  targetLink: string | null;
  targetOwnerUserId: string | null;
}

/** Nome e link da partida (só partida de chave confirmada, que o público vê). */
async function resolveMatch(db: PrismaClient, matchId: string): Promise<{ label: string; link: string } | null> {
  if (!isUuid(matchId)) return null;
  const match = await matchView(db, matchId);
  if (!match) return null;
  const t = await db.tournament.findUnique({ where: { id: match.tournamentId }, select: { name: true, slug: true, status: true } });
  if (!t || t.status === 'DRAFT') return null;
  const names = match.participants.map((p) => p.name || 'A definir');
  const what = match.kind === 'LOBBY' ? `${match.stageName} · ${match.roundLabel}` : `${match.roundLabel}: ${names.join(' x ')}`;
  return { label: `${what} · ${t.name}`, link: `/c/${t.slug}?aba=partidas` };
}

async function resolveTarget(db: PrismaClient, input: CreateReportInput, viewer: { userId: string; roles: Awaited<ReturnType<typeof currentRoles>> }): Promise<ResolvedTarget> {
  switch (input.targetType) {
    case 'USER': {
      const nicknameKey = input.targetId.toLowerCase();
      const user = isUuid(input.targetId) ? await db.user.findUnique({ where: { id: input.targetId } }) : await db.user.findUnique({ where: { nicknameKey } });
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Usuário');
      return { targetId: user.id, targetLabel: user.nickname, targetLink: `/u/${encodeURIComponent(user.nickname)}`, targetOwnerUserId: user.id };
    }
    case 'TEAM': {
      const team = isUuid(input.targetId) ? await db.team.findUnique({ where: { id: input.targetId } }) : null;
      if (!team) throw notFound('Squad');
      return { targetId: team.id, targetLabel: `${team.name} [${team.tag}]`, targetLink: `/minha-conta/squads/${team.id}`, targetOwnerUserId: team.captainId };
    }
    case 'MATCH': {
      const match = await resolveMatch(db, input.targetId);
      if (!match) throw notFound('Partida');
      return { targetId: input.targetId, targetLabel: match.label, targetLink: match.link, targetOwnerUserId: null };
    }
    case 'RESULT': {
      // O alvo é um resultado enviado por participante (id do envio) ou o resultado de uma partida (id da partida).
      const submission = isUuid(input.targetId) ? await db.resultSubmission.findUnique({ where: { id: input.targetId }, select: { matchId: true, submittedById: true } }) : null;
      const match = await resolveMatch(db, submission?.matchId ?? input.targetId);
      if (!match) throw notFound('Resultado');
      return { targetId: input.targetId, targetLabel: `Resultado de ${match.label}`, targetLink: match.link, targetOwnerUserId: submission?.submittedById ?? null };
    }
    case 'CHAT_MESSAGE': {
      // Só denuncia quem enxerga o chat da partida (issue 125); a moderação vê o texto como estava.
      const message = isUuid(input.targetId) ? await db.matchChatMessage.findUnique({ where: { id: input.targetId } }) : null;
      const access = message ? await chatAccess(db, viewer, message.matchId) : null;
      const match = message && access ? await resolveMatch(db, message.matchId) : null;
      if (!message || !match) throw notFound('Mensagem');
      const author = await db.user.findUnique({ where: { id: message.authorId }, select: { nickname: true } });
      const excerpt = message.body.length > 120 ? `${message.body.slice(0, 117)}…` : message.body;
      return { targetId: message.id, targetLabel: `Mensagem de ${author?.nickname ?? 'usuário'} no chat de ${match.label}: “${excerpt}”`, targetLink: match.link, targetOwnerUserId: message.authorId };
    }
  }
}

/** Liga as provas enviadas pela própria pessoa (`/uploads`) à denúncia; endereço de outra pessoa não vale. */
async function attachEvidence(db: PrismaClient, reporterId: string, reportId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const fileIds = urls.map((u) => /\/files\/([0-9a-f-]{36})/i.exec(u)?.[1]).filter((id): id is string => isUuid(id));
  await db.upload.updateMany({
    where: { ownerId: reporterId, attachedAt: null, OR: [{ blobUrl: { in: urls } }, ...(fileIds.length > 0 ? [{ id: { in: fileIds } }] : [])] },
    data: { attachedType: 'REPORT', attachedId: reportId, attachedAt: new Date() },
  });
}

const reportInclude = { reporter: { select: { nickname: true } } } as const;

reports.post('/reports', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, CreateReportInput);
  const db = c.get('deps').db();
  const target = await resolveTarget(db, input, { userId: session.userId, roles: await currentRoles(c) });
  if (target.targetOwnerUserId === session.userId) {
    throw badRequest(input.targetType === 'USER' ? 'Você não pode denunciar a si mesmo.' : 'Você não pode denunciar algo que é seu.', 'REPORT_SELF');
  }
  const open = await db.report.count({ where: { reporterId: session.userId, targetType: input.targetType, targetId: target.targetId, status: { in: OPEN } } });
  if (open >= MAX_OPEN_REPORTS_PER_TARGET) throw conflict('Você já tem denúncias em aberto sobre isto. Aguarde a análise da moderação antes de enviar outra.', 'REPORT_LIMIT');
  const created = await db.report.create({
    data: { reporterId: session.userId, targetType: input.targetType, targetId: target.targetId, targetLabel: target.targetLabel, targetLink: target.targetLink, targetOwnerUserId: target.targetOwnerUserId, reason: input.reason, description: input.description.trim(), evidenceUrls: input.evidenceUrls },
    include: reportInclude,
  });
  await attachEvidence(db, session.userId, created.id, input.evidenceUrls).catch((error: unknown) => c.get('log').warn('não foi possível ligar as provas à denúncia', { reportId: created.id, error: String(error) }));
  return respond(c, Report, toReport(created, new Map()), 201);
});

/** As minhas denúncias, com o status e a resposta da moderação. As mais recentes primeiro. */
reports.get('/me/reports', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const rows = await db.report.findMany({ where: { reporterId: session.userId }, include: reportInclude, orderBy: { createdAt: 'desc' }, take: 200 });
  const names = await nicknames(
    db,
    rows.map((r) => r.handledById),
  );
  return respond(
    c,
    z.array(Report),
    rows.map((r) => toReport(r, names)),
  );
});

// ── Fila do Admin ────────────────────────────────────────────────────
const STATUS_ORDER: Record<AdminReport['status'], number> = { OPEN: 0, IN_REVIEW: 1, ACTIONED: 2, DISMISSED: 2 };

reports.get('/admin/reports', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  await expireSuspensions(db, now());
  const status = ReportStatus.safeParse(c.req.query('status'));
  const targetUserId = c.req.query('targetUserId');
  if (targetUserId && !isUuid(targetUserId)) return respond(c, numberedPage(AdminReport), { items: [], page: 1, pageCount: 1, total: 0 });
  const where: Prisma.ReportWhereInput = {
    ...(status.success ? { status: status.data } : {}),
    ...(targetUserId ? { OR: [{ targetOwnerUserId: targetUserId }, { targetType: 'USER', targetId: targetUserId }] } : {}),
  };
  const rows = await db.report.findMany({ where, include: reportInclude, orderBy: { createdAt: 'asc' }, take: 2000 });
  // Fila: abertas primeiro, da mais antiga para a mais nova; tratadas depois, da mais recente para a mais antiga.
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (STATUS_ORDER[a.status] < 2 ? a.createdAt.getTime() - b.createdAt.getTime() : b.updatedAt.getTime() - a.updatedAt.getTime()));
  const page = paginate(rows, c.req.query('page'));
  return respond(c, numberedPage(AdminReport), { ...page, items: await toAdminReports(db, page.items) });
});

reports.patch('/admin/reports/:id', async (c) => {
  const actor = await requireAdmin(c);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const record = isUuid(id) ? await db.report.findUnique({ where: { id }, include: reportInclude }) : null;
  if (!record) throw notFound('Denúncia');
  const input = await body(c, HandleReportInput);
  const resolution = input.resolution?.trim() || null;
  const closing = input.status === 'ACTIONED' || input.status === 'DISMISSED';
  // Quem denunciou lê a resposta: fechar a denúncia sem explicar não vale.
  if (closing && (!resolution || resolution.length < 5)) throw badRequest('Confira os campos destacados.', 'VALIDATION', { resolution: 'Explique a decisão (pelo menos 5 caracteres)' });
  const saved = await withAudit(db, await auditContext(c, resolution), async (tx) => {
    const updated = await tx.report.update({ where: { id: record.id }, data: { status: input.status, ...(resolution ? { resolution } : {}), handledById: actor.id }, include: reportInclude });
    await audited(tx, { action: 'REPORT_HANDLED', entityType: 'Report', entityId: record.id, entityLabel: record.targetLabel || record.targetId, before: { status: record.status }, after: { status: input.status }, reason: resolution });
    return updated;
  });
  if (closing) {
    await new AfterCommit()
      .notify([record.reporterId], {
        type: 'SANCTION',
        title: input.status === 'ACTIONED' ? 'Sua denúncia foi analisada' : 'Sua denúncia foi considerada improcedente',
        body: `${record.targetLabel || 'Denúncia'}: ${resolution}`,
        link: null,
      })
      .flush(c);
  }
  const [view] = await toAdminReports(db, [saved]);
  return respond(c, AdminReport, view as AdminReport);
});

// ── Disputas escaladas ───────────────────────────────────────────────
async function toDisputes(c: AppContext, rows: Prisma.DisputeGetPayload<{ include: { messages: true; match: { include: { stage: { include: { tournament: { select: { id: true; name: true; ownerId: true } } } } } } } }>[]): Promise<Dispute[]> {
  const db = c.get('deps').db();
  const tournamentIds = [...new Set(rows.map((d) => d.match.stage.tournament.id))];
  const authorIds = rows.flatMap((d) => [d.openedById, ...d.messages.map((m) => m.authorId)]);
  const [names, staff, admins] = await Promise.all([
    nicknames(db, authorIds),
    db.tournamentStaff.findMany({ where: { tournamentId: { in: tournamentIds } }, select: { tournamentId: true, userId: true } }),
    db.userRole.findMany({ where: { userId: { in: [...new Set(authorIds)] }, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, select: { userId: true } }),
  ]);
  const adminIds = new Set(admins.map((a) => a.userId));
  const roleOf = (userId: string, t: { id: string; ownerId: string }): z.infer<typeof DisputeMessage>['authorRole'] =>
    adminIds.has(userId) ? 'ADMIN' : t.ownerId === userId || staff.some((s) => s.tournamentId === t.id && s.userId === userId) ? 'STAFF' : 'PARTICIPANT';
  return rows.map((d) => {
    const t = d.match.stage.tournament;
    return {
      id: d.id,
      matchId: d.matchId,
      submissionId: d.submissionId,
      tournamentId: t.id,
      tournamentName: t.name,
      matchLabel: [d.match.stage.name, d.match.roundLabel].filter(Boolean).join(' · '),
      openedByNickname: names.get(d.openedById) ?? 'Participante',
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      messages: d.messages.map((m) => ({ id: m.id, authorNickname: names.get(m.authorId) ?? 'Participante', authorRole: roleOf(m.authorId, t), body: m.body, evidenceUrls: m.evidenceUrls, createdAt: m.createdAt.toISOString() })),
      createdAt: d.createdAt.toISOString(),
      resolvedAt: d.status === 'RESOLVED' ? d.updatedAt.toISOString() : null,
    };
  });
}

/** Disputas que o organizador escalou para a administração (padrão) ou em outro estado. */
reports.get('/admin/disputes', async (c) => {
  await requireAdmin(c);
  const wanted = DisputeStatus.safeParse(c.req.query('status') ?? 'ESCALATED');
  const rows = await c
    .get('deps')
    .db()
    .dispute.findMany({
      where: wanted.success ? { status: wanted.data } : {},
      include: { messages: { orderBy: { createdAt: 'asc' } }, match: { include: { stage: { include: { tournament: { select: { id: true, name: true, ownerId: true } } } } } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  return respond(c, z.array(Dispute), await toDisputes(c, rows));
});
