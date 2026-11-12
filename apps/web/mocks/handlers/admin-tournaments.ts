/**
 * Módulo `admin-tournaments` da API simulada (ADM-05 e ADM-11):
 * visão global dos campeonatos (destacar, trocar o responsável, cancelar, arquivar, fila "Sem responsável",
 * chaves travadas) e comunicados globais (banner, notificação e aviso de manutenção).
 *
 * Também aplica a RN-09: o que acontece com os campeonatos de um organizador revogado, suspenso ou banido.
 */
import { http, type HttpHandler } from 'msw';
import {
  ACTIVE_REGISTRATION_STATUSES,
  ACTIVE_TOURNAMENT_STATUSES,
  AdminCancelTournamentInput,
  AdminTournamentPatch,
  ChangeOwnerInput,
  GlobalAnnouncementInput,
  GlobalAnnouncementPatch,
  TournamentStatus,
  type AdminTournament,
  type Announcement,
  type GlobalAnnouncement,
  type LockedStage,
  type OrphanOutcome,
  type SiteBannerItem,
} from '@nova/schemas';
import { audit } from '../audit';
import { publish } from '../bus';
import { isLocked, stageRuns } from '../competition';
import { collection, db, nowIso, save, uid, type DbTournament, type DbUser } from '../db';
import { badRequest, body, conflict, currentUser, findTournament, handle, isAdmin, json, notFound, paginateNumbered, param, query, url } from '../http';
import { notify } from '../notify';
import { findUser, takenSlots } from '../views';
import { adminOnly } from './admin-settings';

export const moduleName = 'admin-tournaments';

const HOUR = 3600_000;
/** O aviso de manutenção aparece no site 48 h antes do início. */
const MAINTENANCE_NOTICE_MS = 48 * HOUR;

// ── Fila "Sem responsável" (RN-09) ───────────────────────────────────
export interface DbOrphanTournament {
  tournamentId: string;
  previousOwnerId: string;
  /** Estado em que o campeonato estava antes de ser pausado. */
  previousStatus: TournamentStatus;
  cause: string;
  since: string;
}
export const orphanTournaments = () => collection<DbOrphanTournament>('orphanTournaments');

function clearOrphan(tournamentId: string): void {
  const list = orphanTournaments();
  const index = list.findIndex((o) => o.tournamentId === tournamentId);
  if (index >= 0) list.splice(index, 1);
}

function adminIds(): string[] {
  return db()
    .users.filter((u) => isAdmin(u) && u.status === 'ACTIVE')
    .map((u) => u.id);
}

/**
 * RN-09: o organizador perdeu o papel (revogado, suspenso, banido ou conta mesclada).
 * Rascunhos, finalizados, cancelados e arquivados ficam como estão. Nos campeonatos em curso
 * (Publicado até Pausado) o co-organizador mais antigo assume; sem co-organizador, o campeonato
 * é pausado e entra na fila "Sem responsável". Tudo auditado; os Admins são avisados.
 */
export function releaseTournamentsOf(owner: DbUser, actor: DbUser, cause: string): OrphanOutcome[] {
  const d = db();
  const outcomes: OrphanOutcome[] = [];
  for (const t of d.tournaments) {
    if (t.ownerId !== owner.id || !ACTIVE_TOURNAMENT_STATUSES.includes(t.status)) continue;
    const successor = d.staff
      .filter((s) => s.tournamentId === t.id && s.role === 'CO_ORGANIZER' && s.userId !== owner.id && findUser(s.userId)?.status === 'ACTIVE')
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];
    const now = nowIso();
    if (successor) {
      const next = findUser(successor.userId) as DbUser;
      t.ownerId = next.id;
      t.updatedAt = now;
      // Quem virou responsável deixa de constar como co-organizador.
      d.staff = d.staff.filter((s) => !(s.tournamentId === t.id && s.userId === next.id));
      save();
      audit(actor, {
        action: 'TOURNAMENT_OWNER_CHANGED',
        entityType: 'Tournament',
        entityId: t.id,
        entityLabel: t.name,
        tournamentId: t.id,
        before: { ownerId: owner.id, responsavel: owner.nickname },
        after: { ownerId: next.id, responsavel: next.nickname },
        reason: `${cause}. O co-organizador mais antigo assumiu (RN-09).`,
      });
      notify([next.id], 'ANNOUNCEMENT', 'Você agora é responsável por um campeonato', `${t.name}: ${owner.nickname} deixou a organização e você, como co-organizador mais antigo, assumiu.`, `/organizador/campeonatos/${t.id}`);
      outcomes.push({ id: t.id, name: t.name, outcome: 'TRANSFERRED', newOwnerNickname: next.nickname });
    } else {
      const previousStatus = t.status;
      t.status = 'PAUSED';
      t.updatedAt = now;
      clearOrphan(t.id);
      orphanTournaments().push({ tournamentId: t.id, previousOwnerId: owner.id, previousStatus, cause, since: now });
      save();
      audit(actor, {
        action: 'TOURNAMENT_STATUS_CHANGED',
        entityType: 'Tournament',
        entityId: t.id,
        entityLabel: t.name,
        tournamentId: t.id,
        before: { status: previousStatus, semResponsavel: false },
        after: { status: 'PAUSED', semResponsavel: true },
        reason: `${cause}. Sem co-organizador: campeonato pausado e enviado para a fila "Sem responsável" (RN-09).`,
      });
      outcomes.push({ id: t.id, name: t.name, outcome: 'PAUSED', newOwnerNickname: null });
    }
    publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
  }
  if (outcomes.length > 0) {
    const paused = outcomes.filter((o) => o.outcome === 'PAUSED').length;
    notify(
      adminIds(),
      'ANNOUNCEMENT',
      paused > 0 ? `${paused} campeonato(s) sem responsável` : 'Responsável de campeonato trocado',
      `${owner.nickname} deixou de organizar ${outcomes.length} campeonato(s) em curso: ${outcomes.map((o) => (o.outcome === 'PAUSED' ? `${o.name} (pausado)` : `${o.name} (assumido por ${o.newOwnerNickname})`)).join('; ')}.`,
      paused > 0 ? '/admin/campeonatos?fila=sem-responsavel' : '/admin/campeonatos',
    );
  }
  return outcomes;
}

// ── Visão do Admin ───────────────────────────────────────────────────
function hasOwner(t: DbTournament): boolean {
  if (orphanTournaments().some((o) => o.tournamentId === t.id)) return false;
  return findUser(t.ownerId)?.status === 'ACTIVE';
}

function toAdminTournament(t: DbTournament): AdminTournament {
  const game = db().games.find((g) => g.id === t.gameId);
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    gameName: game?.name ?? 'Jogo',
    status: t.status,
    ownerId: t.ownerId,
    ownerNickname: findUser(t.ownerId)?.nickname ?? 'Sem responsável',
    featured: t.featured,
    takenSlots: takenSlots(t.id),
    maxParticipants: t.maxParticipants,
    startsAt: t.startsAt,
    hasOwner: hasOwner(t),
  };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

interface DbCancellation {
  tournamentId: string;
  reason: string;
  byUserId: string;
  at: string;
}
/** Mesma coleção que o módulo do organizador usa para guardar o motivo do cancelamento. */
const cancellations = () => collection<DbCancellation>('tournamentCancellations');

// ── Comunicados globais ──────────────────────────────────────────────
interface DbGlobalAnnouncement extends GlobalAnnouncement {
  authorId: string;
}
const globalAnnouncements = () => collection<DbGlobalAnnouncement>('globalAnnouncements');

function toGlobalAnnouncement(a: DbGlobalAnnouncement): GlobalAnnouncement {
  return { id: a.id, title: a.title, body: a.body, kind: a.kind, audience: a.audience, gameId: a.gameId, startsAt: a.startsAt, endsAt: a.endsAt, active: a.active, authorNickname: a.authorNickname, createdAt: a.createdAt };
}

/** Quem joga (inscrição ativa) ou segue o jogo. */
function playersOfGame(gameId: string): Set<string> {
  const d = db();
  const tournamentIds = new Set(d.tournaments.filter((t) => t.gameId === gameId).map((t) => t.id));
  const ids = new Set<string>();
  for (const r of d.registrations) {
    if (!tournamentIds.has(r.tournamentId) || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) continue;
    if (r.userId) ids.add(r.userId);
    for (const m of r.members) ids.add(m.userId);
  }
  for (const f of d.follows) if (f.targetType === 'GAME' && f.targetId === gameId) ids.add(f.userId);
  return ids;
}

function audienceUserIds(a: Pick<GlobalAnnouncement, 'audience' | 'gameId'>): string[] {
  const active = db().users.filter((u) => u.status === 'ACTIVE');
  if (a.audience === 'ORGANIZERS') return active.filter((u) => u.roles.includes('ORGANIZER')).map((u) => u.id);
  if (a.audience === 'GAME' && a.gameId) {
    const players = playersOfGame(a.gameId);
    return active.filter((u) => players.has(u.id)).map((u) => u.id);
  }
  return active.map((u) => u.id);
}

function inAudience(a: Pick<GlobalAnnouncement, 'audience' | 'gameId'>, user: DbUser | null): boolean {
  if (a.audience === 'ALL') return true;
  if (!user) return false;
  if (a.audience === 'ORGANIZERS') return user.roles.includes('ORGANIZER') || isAdmin(user);
  return a.gameId ? playersOfGame(a.gameId).has(user.id) : false;
}

/** Banners ativos e avisos de manutenção (48 h antes do início até o fim da janela) para quem está vendo o site. */
function activeBanners(user: DbUser | null, now = Date.now()): SiteBannerItem[] {
  const items: SiteBannerItem[] = [];
  for (const a of globalAnnouncements()) {
    if (!a.active || a.kind === 'NOTIFICATION' || !inAudience(a, user)) continue;
    const start = a.startsAt ? new Date(a.startsAt).getTime() : null;
    const end = a.endsAt ? new Date(a.endsAt).getTime() : null;
    if (end !== null && now >= end) continue;
    if (a.kind === 'MAINTENANCE') {
      if (start === null || now < start - MAINTENANCE_NOTICE_MS) continue;
      const ongoing = now >= start;
      items.push({ id: a.id, kind: 'MAINTENANCE', title: a.title, body: a.body, startsAt: a.startsAt, endsAt: a.endsAt, ongoing, dismissible: !ongoing });
    } else {
      if (start !== null && now < start) continue;
      items.push({ id: a.id, kind: 'BANNER', title: a.title, body: a.body, startsAt: a.startsAt, endsAt: a.endsAt, ongoing: false, dismissible: true });
    }
  }
  // Manutenção em curso primeiro; depois as mais recentes.
  return items.sort((x, y) => Number(y.ongoing) - Number(x.ongoing) || Number(y.kind === 'MAINTENANCE') - Number(x.kind === 'MAINTENANCE'));
}

const AUDIENCE_LABEL: Record<GlobalAnnouncement['audience'], string> = { ALL: 'Todos', ORGANIZERS: 'Organizadores', GAME: 'Inscritos de um jogo' };

export const handlers: HttpHandler[] = [
  // ── Campeonatos ────────────────────────────────────────────────────
  http.get(
    url('/admin/tournaments'),
    handle(({ request }) => {
      adminOnly();
      const q = query(request);
      const term = normalize((q.get('q') ?? '').trim());
      const status = TournamentStatus.safeParse(q.get('status'));
      const orphanOnly = q.get('orphan') === 'true';
      const orphans = new Set(orphanTournaments().map((o) => o.tournamentId));
      const rows = db()
        .tournaments.filter((t) => !status.success || t.status === status.data)
        .filter((t) => !orphanOnly || orphans.has(t.id) || !hasOwner(t))
        .map(toAdminTournament)
        .filter((t) => !term || [t.name, t.slug, t.gameName, t.ownerNickname].some((text) => normalize(text).includes(term)))
        .sort((a, b) => Number(a.hasOwner) - Number(b.hasOwner) || a.name.localeCompare(b.name, 'pt-BR'));
      return json(paginateNumbered(rows, q.get('page')));
    }),
  ),

  http.patch(
    url('/admin/tournaments/:id'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const t = findTournament(param(params, 'id'));
      const { featured } = await body(request, AdminTournamentPatch);
      if (featured && !ACTIVE_TOURNAMENT_STATUSES.includes(t.status) && t.status !== 'FINISHED') {
        throw conflict('Só dá para destacar um campeonato publicado. Rascunhos, cancelados e arquivados não aparecem na home.', 'NOT_PUBLIC');
      }
      if (t.featured !== featured) {
        const before = t.featured;
        t.featured = featured;
        t.updatedAt = nowIso();
        save();
        audit(actor, { action: 'TOURNAMENT_FEATURED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { featured: before }, after: { featured } });
        publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
      }
      return json(toAdminTournament(t));
    }),
  ),

  http.post(
    url('/admin/tournaments/:id/owner'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const t = findTournament(param(params, 'id'));
      const input = await body(request, ChangeOwnerInput);
      const d = db();
      const next = d.users.find((u) => u.id === input.ownerId);
      if (!next) throw badRequest('Usuário não encontrado.', 'VALIDATION', { ownerId: 'Escolha um organizador da lista.' });
      if (!next.roles.includes('ORGANIZER') || next.status !== 'ACTIVE') {
        throw badRequest('O novo responsável precisa ser um organizador com a conta ativa.', 'NOT_ORGANIZER', { ownerId: 'Escolha um organizador com a conta ativa.' });
      }
      if (next.id === t.ownerId && hasOwner(t)) throw conflict(`${next.nickname} já é responsável por este campeonato.`, 'SAME_OWNER');

      const previous = findUser(t.ownerId);
      const wasOrphan = !hasOwner(t);
      t.ownerId = next.id;
      t.updatedAt = nowIso();
      d.staff = d.staff.filter((s) => !(s.tournamentId === t.id && s.userId === next.id));
      clearOrphan(t.id);
      save();
      audit(actor, {
        action: 'TOURNAMENT_OWNER_CHANGED',
        entityType: 'Tournament',
        entityId: t.id,
        entityLabel: t.name,
        tournamentId: t.id,
        before: { ownerId: previous?.id ?? null, responsavel: previous?.nickname ?? 'Sem responsável', semResponsavel: wasOrphan },
        after: { ownerId: next.id, responsavel: next.nickname, semResponsavel: false },
        reason: input.reason,
      });
      notify([next.id], 'ANNOUNCEMENT', 'Você agora é responsável por um campeonato', `A administração passou "${t.name}" para você. Motivo: ${input.reason}`, `/organizador/campeonatos/${t.id}`);
      if (previous && previous.id !== next.id) {
        notify([previous.id], 'ANNOUNCEMENT', 'Você deixou de ser responsável por um campeonato', `A administração passou "${t.name}" para ${next.nickname}. Motivo: ${input.reason}`, null);
      }
      publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
      return json(toAdminTournament(t));
    }),
  ),

  /** O Admin cancela em qualquer estado que ainda não terminou (inclusive em andamento). */
  http.post(
    url('/admin/tournaments/:id/cancel'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const t = findTournament(param(params, 'id'));
      const { reason } = await body(request, AdminCancelTournamentInput);
      if (t.status === 'CANCELLED') throw conflict('Este campeonato já está cancelado.', 'INVALID_TRANSITION');
      if (t.status === 'FINISHED' || t.status === 'ARCHIVED') throw conflict('Campeonato finalizado não pode ser cancelado. Você pode arquivá-lo.', 'INVALID_TRANSITION');
      const before = t.status;
      const wasPublic = ACTIVE_TOURNAMENT_STATUSES.includes(t.status);
      const now = nowIso();
      t.status = 'CANCELLED';
      t.featured = false;
      t.updatedAt = now;
      cancellations().push({ tournamentId: t.id, reason, byUserId: actor.id, at: now });
      clearOrphan(t.id);
      if (wasPublic) {
        const notice: Announcement = { id: uid('an'), tournamentId: t.id, stageId: null, groupId: null, authorNickname: 'Administração', title: 'Campeonato cancelado', body: reason, createdAt: now };
        db().announcements.push(notice);
      }
      save();
      audit(actor, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: before }, after: { status: 'CANCELLED' }, reason });
      notify([t.ownerId], 'ANNOUNCEMENT', 'Campeonato cancelado pela administração', `${t.name}: ${reason}`, `/c/${t.slug}`);
      publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
      return json(toAdminTournament(t));
    }),
  ),

  http.post(
    url('/admin/tournaments/:id/archive'),
    handle(({ params }) => {
      const actor = adminOnly();
      const t = findTournament(param(params, 'id'));
      if (t.status === 'ARCHIVED') throw conflict('Este campeonato já está arquivado.', 'INVALID_TRANSITION');
      if (t.status !== 'FINISHED' && t.status !== 'CANCELLED') throw conflict('Só dá para arquivar campeonato finalizado ou cancelado.', 'INVALID_TRANSITION');
      const before = t.status;
      t.status = 'ARCHIVED';
      t.featured = false;
      t.updatedAt = nowIso();
      save();
      audit(actor, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: before }, after: { status: 'ARCHIVED' } });
      publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
      return json(toAdminTournament(t));
    }),
  ),

  /** Fases com a chave travada (RN-07). Destravar é `POST /stages/:id/unlock`, do módulo de competição. */
  http.get(
    url('/admin/tournaments/:id/locked-stages'),
    handle(({ params }) => {
      adminOnly();
      const t = findTournament(param(params, 'id'));
      const locked: LockedStage[] = [];
      for (const run of stageRuns()) {
        if (run.tournamentId !== t.id || !isLocked(run)) continue;
        const stage = t.stages.find((s) => s.id === run.stageId);
        if (!stage) continue;
        locked.push({ stageId: stage.id, stageName: stage.name, tournamentId: t.id, tournamentName: t.name, completedMatches: Object.values(run.state.results).filter((r) => !r.voided).length });
      }
      return json(locked);
    }),
  ),

  // ── Comunicados globais ────────────────────────────────────────────
  http.get(
    url('/admin/announcements'),
    handle(() => {
      adminOnly();
      return json([...globalAnnouncements()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toGlobalAnnouncement));
    }),
  ),

  http.post(
    url('/admin/announcements'),
    handle(async ({ request }) => {
      const actor = adminOnly();
      const input = await body(request, GlobalAnnouncementInput);
      const errors: Record<string, string> = {};
      const game = input.audience === 'GAME' ? db().games.find((g) => g.id === input.gameId) : undefined;
      if (input.audience === 'GAME' && !game) errors.gameId = 'Escolha o jogo';
      if (input.kind === 'MAINTENANCE') {
        if (!input.startsAt) errors.startsAt = 'Informe quando a manutenção começa';
        if (!input.endsAt) errors.endsAt = 'Informe quando a manutenção termina';
      }
      if (input.startsAt && input.endsAt && new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) errors.endsAt = 'O fim precisa ser depois do início';
      if (input.endsAt && !errors.endsAt && new Date(input.endsAt).getTime() <= Date.now()) errors.endsAt = 'O fim precisa estar no futuro';
      if (Object.keys(errors).length > 0) throw badRequest('Confira os campos destacados.', 'VALIDATION', errors);

      const record: DbGlobalAnnouncement = {
        id: uid('ga'),
        title: input.title.trim(),
        body: input.body.trim(),
        kind: input.kind,
        audience: input.audience,
        gameId: input.audience === 'GAME' ? (game?.id ?? null) : null,
        startsAt: input.kind === 'NOTIFICATION' ? null : input.startsAt,
        endsAt: input.kind === 'NOTIFICATION' ? null : input.endsAt,
        // Notificação é envio único: não fica "ativa" no topo do site.
        active: input.kind !== 'NOTIFICATION',
        authorNickname: actor.nickname,
        authorId: actor.id,
        createdAt: nowIso(),
      };
      globalAnnouncements().push(record);
      save();
      let recipients = 0;
      if (record.kind === 'NOTIFICATION') {
        const ids = audienceUserIds(record);
        recipients = ids.length;
        notify(ids, 'ANNOUNCEMENT', record.title, record.body, null);
      }
      audit(actor, {
        action: 'ANNOUNCEMENT_SENT',
        entityType: 'GlobalAnnouncement',
        entityId: record.id,
        entityLabel: record.title,
        after: {
          tipo: record.kind,
          publico: game ? `${AUDIENCE_LABEL[record.audience]}: ${game.name}` : AUDIENCE_LABEL[record.audience],
          ...(record.kind === 'NOTIFICATION' ? { destinatarios: recipients } : { inicio: record.startsAt, fim: record.endsAt }),
        },
      });
      return json(toGlobalAnnouncement(record), 201);
    }),
  ),

  http.patch(
    url('/admin/announcements/:id'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const record = globalAnnouncements().find((a) => a.id === param(params, 'id'));
      if (!record) throw notFound('Comunicado');
      const { active } = await body(request, GlobalAnnouncementPatch);
      if (record.kind === 'NOTIFICATION') throw conflict('Notificação já enviada não pode ser ativada nem desativada.', 'NOT_TOGGLEABLE');
      if (record.active !== active) {
        const before = record.active;
        record.active = active;
        save();
        audit(actor, { action: 'ANNOUNCEMENT_TOGGLED', entityType: 'GlobalAnnouncement', entityId: record.id, entityLabel: record.title, before: { active: before }, after: { active } });
      }
      return json(toGlobalAnnouncement(record));
    }),
  ),

  /** Público: o que aparece no topo do site para quem está vendo. */
  http.get(
    url('/site/banner'),
    handle(() => json(activeBanners(currentUser()))),
  ),
];
