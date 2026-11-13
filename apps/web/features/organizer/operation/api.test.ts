/**
 * Regras da operação do campeonato aplicadas pela API simulada (F2.3): equipe do evento,
 * comunicados, pausar/retomar/arquivar, troca de pontuação com a fase em andamento (RN-02)
 * e lista de espera unificada (RN-12). São os cenários que a API real terá de passar em B1/B2.
 */
import { Bracket, Standings, type Match, type OrganizerTournamentDetail, type ReviewRegistrationResult, type TournamentStaff } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { auditLogs } from '@/mocks/audit';
import { db, type DbRegistration } from '@/mocks/db';
import { notifications } from '@/mocks/notify';
import { as, call, mutate, setupMockApi } from '@/mocks/testing';

setupMockApi();

const CAMILA = 'u_camila'; // responsável pela Copa Nova FF e pela Liga CR
const DIEGO = 'u_diego'; // responsável pelo Open 8 Ball e pelo Contra Squad
const BIANCA = 'u_bianca'; // inscrita na Liga CR
const ANA = 'u_ana'; // admin
const MOD_COPA = 'u_p06'; // moderador da Copa Nova FF no seed

const COPA = 'tn_copa_ff';
const COPA_S1 = 'tn_copa_ff_s1';
const LIGA = 'tn_liga_cr';
const LIGA_S1 = 'tn_liga_cr_s1';

const nick = (userId: string) => db().users.find((u) => u.id === userId)?.nickname ?? '';
const notified = (userId: string, title: RegExp) => notifications().some((n) => n.userId === userId && title.test(n.title));

async function startCopa(seed = 'operacao'): Promise<Bracket> {
  as(CAMILA);
  expect((await call('POST', `/tournaments/${COPA}/close-registration`)).status).toBe(200);
  expect((await call('POST', `/stages/${COPA_S1}/generate`, { seeding: 'RANDOM', seed })).status).toBe(200);
  expect((await call('POST', `/stages/${COPA_S1}/confirm`)).status).toBe(200);
  return Bracket.parse((await call('GET', `/stages/${COPA_S1}/bracket`)).data);
}

async function pendingDuel(): Promise<Match> {
  const bracket = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
  const match = bracket.matches.find((m) => m.kind === 'DUEL' && !m.waitingPrevious && m.status !== 'VALIDATED' && m.status !== 'WALKOVER' && m.status !== 'CANCELLED');
  expect(match, 'a Liga CR deveria ter um duelo pronto e sem resultado').toBeDefined();
  return match as Match;
}

describe('equipe do evento (ORG-10)', () => {
  it('só o responsável (ou o Admin) adiciona; co-organizador e quem é de fora recebem 403', async () => {
    as(CAMILA);
    const added = await call<TournamentStaff>('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p41'), role: 'CO_ORGANIZER' });
    expect(added.status, added.detail).toBe(201);
    expect(added.data.role).toBe('CO_ORGANIZER');
    expect(auditLogs().some((l) => l.action === 'STAFF_CHANGED' && l.tournamentId === LIGA)).toBe(true);
    expect(notified('u_p41', /Você entrou na equipe/)).toBe(true);

    as('u_p41'); // co-organizador opera, mas não monta a equipe
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p42'), role: 'MODERATOR' })).status).toBe(403);
    expect((await call('GET', `/tournaments/${LIGA}/staff`)).status).toBe(200);
    as(DIEGO);
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p42'), role: 'MODERATOR' })).status).toBe(403);
    expect((await call('GET', `/tournaments/${LIGA}/staff`)).status).toBe(403);
    as(null);
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p42'), role: 'MODERATOR' })).status).toBe(401);

    as(ANA);
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: `@${nick('u_p42').toUpperCase()}`, role: 'MODERATOR' })).status).toBe(201);
  });

  it('quem está inscrito no campeonato não entra na equipe; apelido desconhecido, repetido ou do dono também não', async () => {
    as(CAMILA);
    const registered = await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick(BIANCA), role: 'MODERATOR' });
    expect(registered.status).toBe(409);
    expect(registered.code).toBe('STAFF_IS_REGISTERED');
    // Membro de um squad inscrito também conta como inscrito.
    const member = db().registrations.find((r) => r.tournamentId === COPA && r.teamId)?.members[1]?.userId as string;
    expect((await call('POST', `/tournaments/${COPA}/staff`, { nickname: nick(member), role: 'MODERATOR' })).code).toBe('STAFF_IS_REGISTERED');

    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: 'ninguem-com-este-apelido', role: 'MODERATOR' })).code).toBe('USER_NOT_FOUND');
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick(CAMILA), role: 'MODERATOR' })).code).toBe('ALREADY_OWNER');
    expect((await call('POST', `/tournaments/${COPA}/staff`, { nickname: nick(MOD_COPA), role: 'MODERATOR' })).code).toBe('ALREADY_STAFF');
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p40'), role: 'DONO' })).status).toBe(400);
  });

  it('troca o papel e remove, com auditoria; depois de removida a pessoa perde o acesso', async () => {
    as(CAMILA);
    await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p40'), role: 'MODERATOR' });
    const changed = await call<TournamentStaff>('PATCH', `/tournaments/${LIGA}/staff/u_p40`, { role: 'CO_ORGANIZER' });
    expect(changed.data.role).toBe('CO_ORGANIZER');
    const list = (await call<TournamentStaff[]>('GET', `/tournaments/${LIGA}/staff`)).data;
    expect(list.map((s) => [s.userId, s.role])).toEqual([['u_p40', 'CO_ORGANIZER']]);

    as('u_p40');
    expect((await call('GET', `/organizer/tournaments/${LIGA}`)).status).toBe(200);
    expect((await call('DELETE', `/tournaments/${LIGA}/staff/u_p40`)).status).toBe(403);
    as(CAMILA);
    expect((await call('DELETE', `/tournaments/${LIGA}/staff/u_p40`)).status).toBe(204);
    expect((await call('DELETE', `/tournaments/${LIGA}/staff/u_p40`)).status).toBe(404);
    as('u_p40');
    expect((await call('GET', `/organizer/tournaments/${LIGA}`)).status).toBe(403);
    expect(auditLogs().filter((l) => l.action === 'STAFF_CHANGED' && l.tournamentId === LIGA)).toHaveLength(3);
  });

  it('moderador agenda e lança resultado (200), mas não gera chave, não cancela e não desclassifica (403)', async () => {
    as(CAMILA);
    expect((await call('POST', `/tournaments/${LIGA}/staff`, { nickname: nick('u_p40'), role: 'MODERATOR' })).status).toBe(201);
    const match = await pendingDuel();
    const [a, b] = match.participants;

    as('u_p40');
    expect((await call<OrganizerTournamentDetail>('GET', `/organizer/tournaments/${LIGA}`)).data.access).toBe('MODERATOR');
    expect((await call('POST', `/stages/${LIGA_S1}/generate`, { seeding: 'RANDOM' })).status).toBe(403);
    expect((await call('POST', `/tournaments/${LIGA}/cancel`, { reason: 'Não pode' })).status).toBe(403);
    expect((await call('POST', `/tournaments/${LIGA}/pause`, { reason: 'Não pode' })).status).toBe(403);
    expect((await call('POST', `/registrations/${a?.registrationId}/withdraw`, { kind: 'DISQUALIFIED', reason: 'Não pode' })).status).toBe(403);
    expect((await call('POST', `/tournaments/${LIGA}/announcements`, { title: 'Aviso', body: 'Não pode', stageId: null, groupId: null })).status).toBe(403);
    expect((await call('PATCH', `/stages/${LIGA_S1}/scoring`, { scoringModelId: 'sm_cr_padrao' })).status).toBe(403);

    const scheduled = await call<Match>('PATCH', `/matches/${match.id}`, { scheduledAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), lobbyCode: 'SALA-1', lobbyPassword: '1234' });
    expect(scheduled.status, scheduled.detail).toBe(200);
    expect(scheduled.data.hasLobby).toBe(true);
    const result = await call('PUT', `/matches/${match.id}/result`, { entries: [{ registrationId: a?.registrationId, score: 2 }, { registrationId: b?.registrationId, score: 1 }] });
    expect(result.status, result.detail).toBe(200);
  });
});

describe('comunicados (ORG-11)', () => {
  it('para todos: cada inscrito é notificado uma vez, quem segue também, e quem enviou não', async () => {
    mutate((d) => d.follows.push({ userId: BIANCA, targetType: 'TOURNAMENT', targetId: COPA }));
    as(CAMILA);
    const res = await call<{ id: string; title: string }>('POST', `/tournaments/${COPA}/announcements`, { title: 'Horário da fase de grupos', body: 'As quedas começam às 20h.', stageId: null, groupId: null });
    expect(res.status, res.detail).toBe(201);

    const members = db().registrations.filter((r) => r.tournamentId === COPA).flatMap((r) => r.members.map((m) => m.userId));
    const received = notifications().filter((n) => n.type === 'ANNOUNCEMENT' && /Horário da fase de grupos/.test(n.title));
    expect(new Set(received.map((n) => n.userId))).toEqual(new Set([...members, BIANCA]));
    expect(received).toHaveLength(members.length + 1);
    expect(received.some((n) => n.userId === CAMILA)).toBe(false);
    expect(received.some((n) => n.userId === 'u_lucas')).toBe(false); // o Squad Alfa não está inscrito

    const list = (await call<{ id: string }[]>('GET', `/tournaments/${COPA}/announcements`)).data;
    expect(list[0]?.id).toBe(res.data.id);
    expect(auditLogs().some((l) => l.action === 'ANNOUNCEMENT_SENT' && l.tournamentId === COPA)).toBe(true);
  });

  it('para um grupo: só os squads daquele grupo recebem; para uma fase: quem está nela', async () => {
    const bracket = await startCopa('comunicados');
    const group = bracket.groups[1];
    expect(group).toBeDefined();
    const usersOf = (registrationIds: string[]) => db().registrations.filter((r) => registrationIds.includes(r.id)).flatMap((r) => r.members.map((m) => m.userId));

    const toGroup = await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Sala do grupo', body: 'A sala abre 15 minutos antes.', stageId: COPA_S1, groupId: group?.id });
    expect(toGroup.status, toGroup.detail).toBe(201);
    const groupReceivers = notifications().filter((n) => /Sala do grupo/.test(n.title)).map((n) => n.userId);
    expect(new Set(groupReceivers)).toEqual(new Set(usersOf(group?.registrationIds ?? [])));
    expect(groupReceivers).toHaveLength(12); // 3 squads de 4 jogadores

    const toStage = await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Aviso da fase', body: 'Boa sorte a todos.', stageId: COPA_S1, groupId: null });
    expect(toStage.status).toBe(201);
    expect(notifications().filter((n) => /Aviso da fase/.test(n.title))).toHaveLength(48);

    expect((await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Grupo sem fase', body: 'x', stageId: null, groupId: group?.id })).status).toBe(400);
    expect((await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Grupo errado', body: 'x', stageId: COPA_S1, groupId: 'nao-existe' })).status).toBe(400);
    expect((await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Fase de outro', body: 'x', stageId: LIGA_S1, groupId: null })).status).toBe(400);
    expect((await call('POST', `/tournaments/${COPA}/announcements`, { title: '', body: '', stageId: null, groupId: null })).status).toBe(400);
  });

  it('moderador e quem é de fora não enviam nem apagam; a organização apaga', async () => {
    as(MOD_COPA);
    expect((await call('POST', `/tournaments/${COPA}/announcements`, { title: 'Aviso', body: 'Texto', stageId: null, groupId: null })).status).toBe(403);
    expect((await call('DELETE', '/announcements/an_1')).status).toBe(403);
    as(DIEGO);
    expect((await call('DELETE', '/announcements/an_1')).status).toBe(403);
    as(CAMILA);
    expect((await call('DELETE', '/announcements/an_1')).status).toBe(204);
    expect((await call('DELETE', '/announcements/an_1')).status).toBe(404);
    expect((await call<{ id: string }[]>('GET', `/tournaments/${COPA}/announcements`)).data.some((a) => a.id === 'an_1')).toBe(false);
  });

  it('rascunho não envia comunicado', async () => {
    as(CAMILA);
    expect((await call('POST', '/tournaments/tn_cr_2v2/announcements', { title: 'Aviso', body: 'Texto', stageId: null, groupId: null })).code).toBe('TOURNAMENT_NOT_PUBLISHED');
  });
});

describe('pausar, retomar e arquivar (PRD §8.3)', () => {
  it('pausa com motivo, bloqueia o lançamento de resultados e retoma', async () => {
    as(CAMILA);
    expect((await call('POST', `/tournaments/${LIGA}/pause`, { reason: '' })).status).toBe(400);
    const paused = await call<OrganizerTournamentDetail>('POST', `/tournaments/${LIGA}/pause`, { reason: 'Queda de energia na arena' });
    expect(paused.status, paused.detail).toBe(200);
    expect(paused.data.status).toBe('PAUSED');
    expect(paused.data.pauseReason).toBe('Queda de energia na arena');
    expect(notified(BIANCA, /foi pausado/)).toBe(true);

    const match = await pendingDuel();
    const [a, b] = match.participants;
    const blocked = await call('PUT', `/matches/${match.id}/result`, { entries: [{ registrationId: a?.registrationId, score: 2 }, { registrationId: b?.registrationId, score: 0 }] });
    expect(blocked.code).toBe('TOURNAMENT_PAUSED');

    const again = await call('POST', `/tournaments/${LIGA}/pause`, { reason: 'De novo' });
    expect(again.status).toBe(409);
    expect(again.code).toBe('INVALID_TRANSITION');

    const resumed = await call<OrganizerTournamentDetail>('POST', `/tournaments/${LIGA}/resume`, {});
    expect(resumed.data.status).toBe('IN_PROGRESS');
    expect(resumed.data.pauseReason ?? null).toBeNull();
    expect((await call('POST', `/tournaments/${LIGA}/resume`, {})).code).toBe('INVALID_TRANSITION');
    expect(auditLogs().filter((l) => l.action === 'TOURNAMENT_STATUS_CHANGED' && l.tournamentId === LIGA).map((l) => l.after?.status)).toEqual(['PAUSED', 'IN_PROGRESS']);
    expect(auditLogs().some((l) => l.action === 'TOURNAMENT_STATUS_CHANGED' && l.reason === 'Queda de energia na arena')).toBe(true);
  });

  it('transições inválidas respondem 409', async () => {
    as(CAMILA);
    expect((await call('POST', `/tournaments/${COPA}/pause`, { reason: 'Ainda nem começou' })).code).toBe('INVALID_TRANSITION'); // inscrições abertas
    expect((await call('POST', `/tournaments/${COPA}/resume`, {})).code).toBe('INVALID_TRANSITION');
    expect((await call('POST', `/tournaments/${COPA}/archive`)).code).toBe('INVALID_TRANSITION');
    expect((await call('POST', `/tournaments/${LIGA}/archive`)).code).toBe('INVALID_TRANSITION'); // em andamento
    expect((await call('POST', '/tournaments/tn_cr_2v2/pause', { reason: 'Rascunho' })).code).toBe('INVALID_TRANSITION');
    as(DIEGO);
    expect((await call('POST', '/tournaments/tn_8ball_verao/archive')).code).toBe('INVALID_TRANSITION'); // cancelado
    expect((await call('POST', '/tournaments/tn_open_8ball/pause', { reason: 'Já terminou' })).code).toBe('INVALID_TRANSITION');
  });

  it('só campeonato finalizado é arquivado; arquivado sai da vitrine', async () => {
    as(BIANCA);
    expect((await call('POST', '/tournaments/tn_open_8ball/archive')).status).toBe(403);
    as(DIEGO);
    const archived = await call<OrganizerTournamentDetail>('POST', '/tournaments/tn_open_8ball/archive');
    expect(archived.status, archived.detail).toBe(200);
    expect(archived.data.status).toBe('ARCHIVED');
    expect((await call('POST', '/tournaments/tn_open_8ball/archive')).code).toBe('INVALID_TRANSITION');
    const list = (await call<{ items: { id: string }[] }>('GET', '/tournaments?status=finished')).data;
    expect(list.items.some((t) => t.id === 'tn_open_8ball')).toBe(false);
  });
});

describe('troca de pontuação com a fase em andamento (RN-02)', () => {
  it('recalcula a tabela inteira pelo modelo novo e registra na auditoria', async () => {
    const bracket = await startCopa('pontuacao');
    const drop = bracket.matches[0] as Match;
    const [alfa, bravo, charlie] = drop.participants.map((p) => p.registrationId as string) as [string, string, string];
    // CT-01: kill 1 + Booyah 3 → 10, 9 e 4.
    await call('PUT', `/matches/${drop.id}/result`, { entries: [{ registrationId: alfa, placement: 1, kills: 7 }, { registrationId: bravo, placement: 2, kills: 9 }, { registrationId: charlie, placement: 3, kills: 4 }] });
    const before = Standings.parse((await call('GET', `/stages/${COPA_S1}/standings`)).data);
    const pointsOf = (s: Standings, id: string) => s.overall.find((r) => r.registrationId === id)?.points;
    expect([pointsOf(before, alfa), pointsOf(before, bravo), pointsOf(before, charlie)]).toEqual([10, 9, 4]);

    const changed = await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_ff_liga' });
    expect(changed.status, changed.detail).toBe(200);
    // Tabela de colocação da liga (12 / 9 / 8) + 1 por kill → 19, 18 e 12.
    const after = Standings.parse(changed.data);
    expect([pointsOf(after, alfa), pointsOf(after, bravo), pointsOf(after, charlie)]).toEqual([19, 18, 12]);
    const fresh = Standings.parse((await call('GET', `/stages/${COPA_S1}/standings`)).data);
    expect(pointsOf(fresh, alfa)).toBe(19);
    const match = Bracket.parse((await call('GET', `/stages/${COPA_S1}/bracket`)).data).matches.find((m) => m.id === drop.id);
    expect(match?.participants.find((p) => p.registrationId === alfa)?.points).toBe(19);

    const log = auditLogs().find((l) => l.action === 'STAGE_SCORING_CHANGED');
    expect(log?.entityId).toBe(COPA_S1);
    expect(log?.before).toEqual({ modelo: 'Free Fire · Padrão (kill 1, Booyah 3)' });
    expect(log?.after).toMatchObject({ modelo: 'Free Fire · Liga (tabela de colocação)', faseEmAndamento: true, partidasRecalculadas: 1 });

    // Repetir o mesmo modelo não gera outro registro.
    expect((await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_ff_liga' })).status).toBe(200);
    expect(auditLogs().filter((l) => l.action === 'STAGE_SCORING_CHANGED')).toHaveLength(1);
  });

  it('recusa modelo de outro tipo de partida, modelo inexistente, moderador e fase concluída', async () => {
    await startCopa('pontuacao-2');
    expect((await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_ff_cs' })).code).toBe('SCORING_MODEL_MISMATCH');
    expect((await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_cr_padrao' })).status).toBe(400);
    as(MOD_COPA);
    expect((await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_ff_liga' })).status).toBe(403);
    as(DIEGO);
    expect((await call('PATCH', '/stages/tn_open_8ball_s1/scoring', { scoringModelId: 'sm_pool_padrao' })).code).toBe('TOURNAMENT_READ_ONLY');
    mutate((d) => {
      const stage = d.tournaments.find((t) => t.id === COPA)?.stages.find((s) => s.id === COPA_S1);
      if (stage) stage.status = 'COMPLETED';
    });
    as(CAMILA);
    expect((await call('PATCH', `/stages/${COPA_S1}/scoring`, { scoringModelId: 'sm_ff_liga' })).code).toBe('STAGE_COMPLETED');
  });
});

describe('editar a configuração de uma fase que ainda não começou (US-ORG-05)', () => {
  const stageInputs = (t: OrganizerTournamentDetail, change: (stage: OrganizerTournamentDetail['stages'][number], index: number) => Partial<OrganizerTournamentDetail['stages'][number]>) =>
    t.stages.map((s, i) => ({ id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding, ...change(s, i) }));

  it('fase pendente muda; a prévia já gerada é refeita com os mesmos participantes; fase em andamento não muda por aqui', async () => {
    const bracket = await startCopa('editar-fases');
    for (const m of bracket.matches) {
      const res = await call('PUT', `/matches/${m.id}/result`, { entries: m.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 3 - i })) });
      expect(res.status, res.detail).toBe(200);
    }
    expect((await call('POST', `/stages/${COPA_S1}/advance`)).status).toBe(200);
    const S2 = 'tn_copa_ff_s2';
    const before = Bracket.parse((await call('GET', `/stages/${S2}/bracket`)).data);
    expect(before.state).toBe('PREVIEW');
    expect(before.matches.every((m) => m.bestOf === 3)).toBe(true);

    const t = (await call<OrganizerTournamentDetail>('GET', `/organizer/tournaments/${COPA}`)).data;
    // Fase 2 ainda não começou: troca a série de MD3 para MD1.
    const edited = await call('PATCH', `/tournaments/${COPA}`, { stages: stageInputs(t, (s, i) => (i === 1 ? { config: { ...s.config, bestOf: 1 } } : {})) });
    expect(edited.status, edited.detail).toBe(200);
    const after = Bracket.parse((await call('GET', `/stages/${S2}/bracket`)).data);
    expect(after.state).toBe('PREVIEW');
    expect(after.matches.length).toBe(before.matches.length);
    expect(after.matches.every((m) => m.bestOf === 1)).toBe(true);
    expect(new Set(after.entrants.map((e) => e.registrationId))).toEqual(new Set(before.entrants.map((e) => e.registrationId)));

    // Fase 1 já foi concluída: mudar a configuração dela é recusado.
    const locked = await call('PATCH', `/tournaments/${COPA}`, { stages: stageInputs(t, (s, i) => (i === 0 ? { config: { ...s.config, drops: 5 } } : {})) });
    expect(locked.status).toBe(409);
    expect(locked.code).toBe('STAGE_LOCKED');
  });
});

describe('lista de espera unificada (RN-12) na gestão de inscrições', () => {
  const CONTRA = 'tn_contra_squad';

  /** Contra Squad lotado (3 vagas ocupadas + 1 aguardando aprovação) e dois squads na fila: o primeiro incompleto, o segundo completo. */
  function fillWaitlist(): { incomplete: string; complete: string; confirmed: string } {
    const ids = { incomplete: 'r_fila_incompleto', complete: 'r_fila_completo', confirmed: '' };
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === CONTRA);
      if (!t) throw new Error('campeonato não encontrado');
      t.maxParticipants = 4;
      const base = Date.now();
      const squad = (id: string, teamId: string, confirmed: number, offset: number): DbRegistration => {
        const team = d.teams.find((x) => x.id === teamId);
        if (!team) throw new Error(`squad ${teamId} não encontrado`);
        return {
          id,
          tournamentId: CONTRA,
          userId: null,
          teamId,
          importedName: null,
          importedTag: null,
          status: 'WAITLIST',
          seed: null,
          statusReason: null,
          members: team.members.map((m, i) => ({ userId: m.userId, isSub: false, confirmedAt: i < confirmed ? new Date(base).toISOString() : null })),
          reservedUntil: null,
          createdAt: new Date(base + offset).toISOString(),
        };
      };
      d.registrations.push(squad(ids.incomplete, 't_2', 2, 1000), squad(ids.complete, 't_3', 4, 2000));
      ids.confirmed = d.registrations.find((r) => r.tournamentId === CONTRA && r.status === 'CONFIRMED')?.id ?? '';
    });
    return ids;
  }

  it('com as inscrições abertas, o squad incompleto sobe "aguardando membros" com a vaga reservada', async () => {
    const ids = fillWaitlist();
    as(DIEGO);
    const res = await call<ReviewRegistrationResult>('PATCH', `/registrations/${ids.confirmed}`, { action: 'remove', reason: 'Desistiu antes do início' });
    expect(res.status, res.detail).toBe(200);
    expect(res.data.promoted.map((p) => [p.id, p.status])).toEqual([[ids.incomplete, 'PENDING_MEMBERS']]);
    expect(res.data.promoted[0]?.reservedUntil).not.toBeNull();
  });

  it('depois do fechamento das inscrições, o squad incompleto é pulado e a vaga vai para o próximo', async () => {
    const ids = fillWaitlist();
    as(DIEGO);
    expect((await call('POST', `/tournaments/${CONTRA}/close-registration`)).status).toBe(200);
    const res = await call<ReviewRegistrationResult>('PATCH', `/registrations/${ids.confirmed}`, { action: 'remove', reason: 'Desistiu antes do início' });
    expect(res.status, res.detail).toBe(200);
    // Aprovação manual ligada: o promovido entra aguardando aprovação.
    expect(res.data.promoted.map((p) => [p.id, p.status])).toEqual([[ids.complete, 'PENDING_APPROVAL']]);
    expect(db().registrations.find((r) => r.id === ids.incomplete)?.status).toBe('WAITLIST');

    // Substituir por um squad incompleto com as inscrições fechadas também é recusado.
    const other = db().registrations.find((r) => r.tournamentId === CONTRA && r.status === 'CONFIRMED')?.id;
    const replace = await call('PATCH', `/registrations/${other}`, { action: 'replace', withRegistrationId: ids.incomplete });
    expect(replace.status).toBe(409);
    expect(replace.code).toBe('SUBSTITUTE_INCOMPLETE');
  });

  it('com a fase em andamento não há substituição nem remoção simples (RN-06)', async () => {
    as(CAMILA);
    const confirmed = db().registrations.filter((r) => r.tournamentId === LIGA && r.status === 'CONFIRMED');
    mutate((d) => {
      const extra = d.registrations.find((r) => r.id === confirmed[15]?.id);
      if (extra) extra.status = 'WAITLIST';
    });
    const replace = await call('PATCH', `/registrations/${confirmed[3]?.id}`, { action: 'replace', withRegistrationId: confirmed[15]?.id });
    expect(replace.status).toBe(409);
    expect(replace.code).toBe('TOURNAMENT_STARTED');
    expect(replace.detail).toMatch(/fase em andamento/);
    const remove = await call('PATCH', `/registrations/${confirmed[3]?.id}`, { action: 'remove', reason: 'Saiu' });
    expect(remove.code).toBe('TOURNAMENT_STARTED');
    expect(db().registrations.find((r) => r.id === confirmed[3]?.id)?.status).toBe('CONFIRMED');
  });
});
