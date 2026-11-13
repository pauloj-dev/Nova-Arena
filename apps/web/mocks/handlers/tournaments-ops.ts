/**
 * Módulo `tournaments-ops` da API simulada: operação do campeonato pelo organizador (F2.3).
 * Equipe do evento (ORG-10), comunicados (ORG-11), pausar/retomar/arquivar (PRD §8.3) e troca do
 * modelo de pontuação de uma fase (RN-02). Permissões do PRD §6: a equipe do evento é montada só
 * pelo responsável (ou Admin); o resto é de dono, co-organizador ou Admin — moderador não.
 */
import { http } from 'msw';
import {
  ACTIVE_REGISTRATION_STATUSES,
  AnnouncementInput,
  canTransition,
  PauseTournamentInput,
  ResumeTournamentInput,
  StaffInput,
  StaffRoleInput,
  StageScoringInput,
  type Announcement,
  type StaffRole,
  type TournamentStaff,
  type TournamentStatus,
} from '@nova/schemas';
import { audit } from '../audit';
import { publish } from '../bus';
import { buildStandings, findStage, getRun, scoringOf, usersOfRegistration } from '../competition';
import { db, nowIso, save, uid, type DbStaff, type DbTournament, type DbUser } from '../db';
import { badRequest, body, conflict, findTournament, forbidden, handle, HttpProblem, json, noContent, notFound, param, requireTournamentAccess, url, type TournamentAccess } from '../http';
import { notify } from '../notify';
import { findUser } from '../views';
import { toOrganizerDetail, tournamentPauses } from './tournaments-manage';

export const moduleName = 'tournaments-ops';

const ROLE_LABEL: Record<StaffRole, string> = { CO_ORGANIZER: 'co-organizador', MODERATOR: 'moderador' };
const CLOSED: TournamentStatus[] = ['CANCELLED', 'ARCHIVED'];

function toStaff(s: DbStaff): TournamentStaff {
  const user = findUser(s.userId);
  return { userId: s.userId, nickname: user?.nickname ?? 'Usuário', avatarUrl: user?.avatarUrl ?? null, role: s.role, addedAt: s.addedAt };
}

/** A equipe do evento é montada pelo responsável pelo campeonato (ou pelo Admin). Co-organizador não convida. */
function requireOwner(t: DbTournament): { user: DbUser; access: TournamentAccess } {
  const result = requireTournamentAccess(t);
  if (result.access === 'CO_ORGANIZER') throw forbidden('Só quem é responsável pelo campeonato pode mudar a equipe do evento.');
  return result;
}

function staffOf(t: DbTournament, userId: string): DbStaff {
  const entry = db().staff.find((s) => s.tournamentId === t.id && s.userId === userId);
  if (!entry) throw notFound('Membro da equipe');
  return entry;
}

/** A pessoa joga este campeonato (inscrição valendo, solo ou em squad)? PRD §6, nota ³. */
function isRegistered(t: DbTournament, userId: string): boolean {
  return db().registrations.some(
    (r) => r.tournamentId === t.id && ACTIVE_REGISTRATION_STATUSES.includes(r.status) && (r.userId === userId || r.members.some((m) => m.userId === userId)),
  );
}

/** Usuários das inscrições confirmadas do campeonato. */
function confirmedUsers(t: DbTournament): string[] {
  return db()
    .registrations.filter((r) => r.tournamentId === t.id && r.status === 'CONFIRMED')
    .flatMap((r) => usersOfRegistration(r.id));
}

/** Quem recebe um comunicado: todos os inscritos (e quem segue), uma fase ou um grupo. */
function audienceOf(t: DbTournament, stageId: string | null, groupId: string | null): { users: string[]; label: string } {
  const d = db();
  if (stageId === null) {
    if (groupId !== null) throw badRequest('Para enviar a um grupo, escolha também a fase.', 'VALIDATION', { groupId: 'Escolha a fase do grupo' });
    const registered = d.registrations.filter((r) => r.tournamentId === t.id && ACTIVE_REGISTRATION_STATUSES.includes(r.status)).flatMap((r) => usersOfRegistration(r.id));
    // RN-15: quem segue o campeonato recebe os comunicados públicos.
    const followers = d.follows.filter((f) => f.targetType === 'TOURNAMENT' && f.targetId === t.id).map((f) => f.userId);
    return { users: [...registered, ...followers], label: 'Todos os inscritos' };
  }
  const stage = t.stages.find((s) => s.id === stageId);
  if (!stage) throw badRequest('Esta fase não é deste campeonato.', 'VALIDATION', { stageId: 'Fase inválida' });
  const run = getRun(stage.id);
  if (groupId === null) {
    // Fase ainda sem chave: quem vai jogá-la são os inscritos confirmados.
    const ids = run ? run.structure.entrants.map((e) => e.id) : null;
    return { users: ids ? ids.flatMap(usersOfRegistration) : confirmedUsers(t), label: stage.name };
  }
  const group = run?.structure.groups.find((g) => g.id === groupId);
  if (!group) throw badRequest('Este grupo não existe na fase escolhida. Gere a chave da fase antes de escrever para um grupo.', 'VALIDATION', { groupId: 'Grupo inválido' });
  return { users: group.entrantIds.flatMap(usersOfRegistration), label: `${stage.name} · ${group.name}` };
}

function changeStatus(t: DbTournament, user: DbUser, to: TournamentStatus, reason: string | null): void {
  const before = t.status;
  t.status = to;
  t.updatedAt = nowIso();
  save();
  audit(user, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: before }, after: { status: to }, reason });
  publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
}

export const handlers = [
  // ── Equipe do evento (ORG-10) ──────────────────────────────────────
  http.get(
    url('/tournaments/:id/staff'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      requireTournamentAccess(t, { allowModerator: true });
      const list = db()
        .staff.filter((s) => s.tournamentId === t.id)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
        .map(toStaff);
      return json(list);
    }),
  ),

  http.post(
    url('/tournaments/:id/staff'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user } = requireOwner(t);
      const input = await body(request, StaffInput);
      if (CLOSED.includes(t.status)) throw conflict('Este campeonato já foi encerrado: a equipe do evento não muda mais.', 'TOURNAMENT_READ_ONLY');

      const d = db();
      const nickname = input.nickname.replace(/^@/, '').toLowerCase();
      const target = d.users.find((u) => u.nickname.toLowerCase() === nickname && u.status !== 'DELETED' && u.status !== 'MERGED');
      if (!target) throw new HttpProblem(404, 'Não encontramos ninguém com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não encontramos ninguém com este apelido' });
      if (target.status !== 'ACTIVE') throw conflict(`${target.nickname} está com a conta suspensa ou banida e não pode entrar na equipe.`, 'USER_NOT_ACTIVE');
      if (target.id === t.ownerId) throw conflict(`${target.nickname} já é responsável por este campeonato.`, 'ALREADY_OWNER');
      if (d.staff.some((s) => s.tournamentId === t.id && s.userId === target.id)) throw conflict(`${target.nickname} já faz parte da equipe do evento.`, 'ALREADY_STAFF');
      // PRD §6, nota ³: quem organiza não joga o próprio campeonato — e quem joga não organiza.
      if (isRegistered(t, target.id)) {
        throw conflict(`${target.nickname} está inscrito neste campeonato. Quem joga não pode fazer parte da equipe do evento.`, 'STAFF_IS_REGISTERED');
      }

      const entry: DbStaff = { tournamentId: t.id, userId: target.id, role: input.role, addedAt: nowIso() };
      d.staff.push(entry);
      save();
      audit(user, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, after: { adicionou: target.nickname, papel: ROLE_LABEL[input.role] } });
      notify([target.id], 'ANNOUNCEMENT', `Você entrou na equipe de ${t.name}`, `${user.nickname} adicionou você como ${ROLE_LABEL[input.role]}.`, `/organizador/campeonatos/${t.id}`);
      return json(toStaff(entry), 201);
    }),
  ),

  http.patch(
    url('/tournaments/:id/staff/:userId'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user } = requireOwner(t);
      const input = await body(request, StaffRoleInput);
      const entry = staffOf(t, param(params, 'userId'));
      const before = entry.role;
      if (before !== input.role) {
        entry.role = input.role;
        save();
        const nickname = findUser(entry.userId)?.nickname ?? 'Usuário';
        audit(user, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { membro: nickname, papel: ROLE_LABEL[before] }, after: { membro: nickname, papel: ROLE_LABEL[input.role] } });
        notify([entry.userId], 'ANNOUNCEMENT', `Seu papel em ${t.name} mudou`, `Agora você é ${ROLE_LABEL[input.role]} deste campeonato.`, `/organizador/campeonatos/${t.id}`);
      }
      return json(toStaff(entry));
    }),
  ),

  http.delete(
    url('/tournaments/:id/staff/:userId'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { user } = requireOwner(t);
      const entry = staffOf(t, param(params, 'userId'));
      const d = db();
      d.staff = d.staff.filter((s) => s !== entry);
      save();
      const nickname = findUser(entry.userId)?.nickname ?? 'Usuário';
      audit(user, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { membro: nickname, papel: ROLE_LABEL[entry.role] }, after: { removeu: nickname } });
      notify([entry.userId], 'ANNOUNCEMENT', `Você saiu da equipe de ${t.name}`, `${user.nickname} removeu você da equipe do evento.`, `/c/${t.slug}`);
      return noContent();
    }),
  ),

  // ── Comunicados (ORG-11) ───────────────────────────────────────────
  http.post(
    url('/tournaments/:id/announcements'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user } = requireTournamentAccess(t);
      const input = await body(request, AnnouncementInput);
      if (t.status === 'DRAFT') throw conflict('Publique o campeonato antes de enviar comunicados.', 'TOURNAMENT_NOT_PUBLISHED');

      const audience = audienceOf(t, input.stageId, input.groupId);
      const announcement: Announcement = { id: uid('an'), tournamentId: t.id, stageId: input.stageId, groupId: input.groupId, authorNickname: user.nickname, title: input.title.trim(), body: input.body.trim(), createdAt: nowIso() };
      db().announcements.push(announcement);
      save();

      const recipients = new Set(audience.users);
      recipients.delete(user.id);
      audit(user, { action: 'ANNOUNCEMENT_SENT', entityType: 'Announcement', entityId: announcement.id, entityLabel: `${t.name} · ${announcement.title}`, tournamentId: t.id, after: { publico: audience.label, destinatarios: recipients.size } });
      notify(recipients, 'ANNOUNCEMENT', `${t.name}: ${announcement.title}`, announcement.body.length > 200 ? `${announcement.body.slice(0, 197)}…` : announcement.body, `/c/${t.slug}`);
      publish(`tournament:${t.id}`, { type: 'announcement.created', tournamentId: t.id, title: announcement.title });
      return json(announcement, 201);
    }),
  ),

  http.delete(
    url('/announcements/:id'),
    handle(({ params }) => {
      const d = db();
      const announcement = d.announcements.find((a) => a.id === param(params, 'id'));
      // Comunicado global (sem campeonato) é do painel Admin, não daqui.
      if (!announcement || announcement.tournamentId === null) throw notFound('Comunicado');
      const t = findTournament(announcement.tournamentId);
      const { user } = requireTournamentAccess(t);
      d.announcements = d.announcements.filter((a) => a.id !== announcement.id);
      save();
      audit(user, { action: 'ANNOUNCEMENT_DELETED', entityType: 'Announcement', entityId: announcement.id, entityLabel: `${t.name} · ${announcement.title}`, tournamentId: t.id, before: { titulo: announcement.title } });
      publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
      return noContent();
    }),
  ),

  // ── Pausar, retomar e arquivar (PRD §8.3) ──────────────────────────
  http.post(
    url('/tournaments/:id/pause'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user, access } = requireTournamentAccess(t);
      const { reason } = await body(request, PauseTournamentInput);
      if (!canTransition(t.status, 'PAUSED')) {
        throw conflict(t.status === 'PAUSED' ? 'Este campeonato já está pausado.' : 'Só um campeonato em andamento pode ser pausado.', 'INVALID_TRANSITION');
      }
      tournamentPauses().push({ tournamentId: t.id, reason, byUserId: user.id, at: nowIso(), resumedAt: null });
      changeStatus(t, user, 'PAUSED', reason);
      notify(confirmedUsers(t), 'ANNOUNCEMENT', `${t.name} foi pausado`, reason, `/c/${t.slug}`);
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/resume'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user, access } = requireTournamentAccess(t);
      const { reason } = await body(request, ResumeTournamentInput);
      if (t.status !== 'PAUSED' || !canTransition(t.status, 'IN_PROGRESS')) throw conflict('Só um campeonato pausado pode ser retomado.', 'INVALID_TRANSITION');
      for (const pause of tournamentPauses()) if (pause.tournamentId === t.id && pause.resumedAt === null) pause.resumedAt = nowIso();
      changeStatus(t, user, 'IN_PROGRESS', reason || null);
      notify(confirmedUsers(t), 'ANNOUNCEMENT', `${t.name} foi retomado`, reason || 'O campeonato voltou. Confira os horários das suas partidas.', `/c/${t.slug}`);
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/archive'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { user, access } = requireTournamentAccess(t);
      if (!canTransition(t.status, 'ARCHIVED')) {
        throw conflict(t.status === 'ARCHIVED' ? 'Este campeonato já está arquivado.' : 'Só um campeonato finalizado pode ser arquivado.', 'INVALID_TRANSITION');
      }
      changeStatus(t, user, 'ARCHIVED', null);
      return json(toOrganizerDetail(t, access));
    }),
  ),

  // ── Pontuação da fase (RN-02) ──────────────────────────────────────
  /**
   * Troca o modelo de pontuação da fase. Com a fase em andamento, os pontos de todas as partidas
   * já lançadas passam a ser calculados pelo modelo novo (a tabela é sempre derivada das
   * estatísticas brutas — RN-01), e a troca fica na auditoria.
   */
  http.patch(
    url('/stages/:id/scoring'),
    handle(async ({ request, params }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const input = await body(request, StageScoringInput);
      if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(tournament.status)) throw conflict('Este campeonato já foi encerrado e não pode mais ser alterado.', 'TOURNAMENT_READ_ONLY');
      if (stage.status === 'COMPLETED') throw conflict(`A fase "${stage.name}" já foi concluída: a pontuação dela não muda mais.`, 'STAGE_COMPLETED');

      const game = db().games.find((g) => g.id === tournament.gameId);
      const model = game?.scoringModels.find((m) => m.id === input.scoringModelId);
      if (!game || !model) throw badRequest('Este modelo de pontuação não existe para o jogo do campeonato.', 'VALIDATION', { scoringModelId: 'Modelo de pontuação inválido' });
      // Modelo personalizado só vale para quem o criou (o responsável pelo campeonato ou quem está editando).
      if (model.ownerId !== null && model.ownerId !== tournament.ownerId && model.ownerId !== user.id) throw forbidden('Este modelo de pontuação é de outro organizador.');
      const current = scoringOf(tournament, stage);
      if (model.matchType !== current.matchType) {
        throw badRequest('Este modelo é de outro tipo de partida e não serve para o formato desta fase.', 'SCORING_MODEL_MISMATCH', { scoringModelId: 'Modelo incompatível com o formato da fase' });
      }

      const previous = game.scoringModels.find((m) => m.id === stage.scoringModelId);
      if (previous?.id !== model.id) {
        const run = getRun(stageId);
        const played = run ? Object.values(run.state.results).filter((r) => !r.voided).length : 0;
        stage.scoringModelId = model.id;
        tournament.updatedAt = nowIso();
        save();
        audit(user, {
          action: 'STAGE_SCORING_CHANGED',
          entityType: 'Stage',
          entityId: stageId,
          entityLabel: `${tournament.name} · ${stage.name}`,
          tournamentId: tournament.id,
          before: { modelo: previous?.name ?? stage.scoringModelId },
          after: { modelo: model.name, faseEmAndamento: stage.status === 'ACTIVE', partidasRecalculadas: played },
        });
        publish(`tournament:${tournament.id}`, { type: 'standings.updated', stageId });
        publish(`tournament:${tournament.id}`, { type: 'bracket.updated', stageId });
        publish(`tournament:${tournament.id}`, { type: 'tournament.updated', tournamentId: tournament.id });
      }
      return json(buildStandings(stageId));
    }),
  ),
];
