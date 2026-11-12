/**
 * Módulo `competition` da API simulada: chave, partidas, agenda, check-in, resultados,
 * classificação, avanço de fase, desistência e encerramento.
 */
import { http } from 'msw';
import {
  advanceStage,
  applyResult,
  applyWalkover,
  computePoints,
  EngineError,
  generateStage,
  generateSwissRound,
  isStageComplete,
  swapEntrants,
  withdrawEntrant,
  type MatchNode,
  type MatchResultInput,
} from '@nova/engine';
import {
  FinishTournamentInput,
  GenerateBracketInput,
  ImportResultsInput,
  ReasonInput,
  ScheduleMatchInput,
  ScheduleRoundInput,
  SubmitResultInput,
  SwapSeedingInput,
  WalkoverInput,
  WithdrawInput,
  type AdvancePreview,
  type Match,
  type Podium,
  type ResultEvent,
  type Stage,
} from '@nova/schemas';
import { audit } from '../audit';
import { publish } from '../bus';
import {
  buildBracket,
  buildMatch,
  buildStandings,
  checkInRequired,
  checkInWindow,
  confirmedRegistrations,
  entrantsFrom,
  findStage,
  getMeta,
  getRun,
  isLocked,
  listMatches,
  matchId as globalMatchId,
  newRun,
  podiums,
  putRun,
  registrationOfUser,
  removeRun,
  scoringOf,
  splitMatchId,
  toEngineConfig,
  toEngineQualification,
  usersOfRegistration,
  type DbStageRun,
} from '../competition';
import { collection, db, nowIso, save, uid, type DbTournament, type DbUser } from '../db';
import {
  badRequest,
  body,
  conflict,
  currentUser,
  findTournament,
  forbidden,
  handle,
  HttpProblem,
  json,
  notFound,
  param,
  query,
  requireAdmin,
  requireTournamentAccess,
  requireUser,
  tournamentAccess,
  url,
} from '../http';
import { notify } from '../notify';
import { toRegistration } from '../views';

export const moduleName = 'competition';

interface DbResultEvent extends ResultEvent {
  stageId: string;
}
const resultEvents = () => collection<DbResultEvent>('resultEvents');

/** Erros de regra do motor viram 400/409 com a mensagem em pt-BR que ele já traz. */
function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof EngineError) {
      const status = ['RESULT_LOCKED', 'STAGE_STARTED', 'STAGE_INCOMPLETE'].includes(error.code) ? 409 : 400;
      throw new HttpProblem(status, error.message, error.code);
    }
    throw error;
  }
}

function isStaff(user: DbUser | null, tournament: DbTournament): boolean {
  return tournamentAccess(user, tournament) !== null;
}

function requireRun(stageId: string, opts: { confirmed?: boolean } = {}): DbStageRun {
  const run = getRun(stageId);
  if (!run || (opts.confirmed && !run.confirmed)) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  return run;
}

function findNode(run: DbStageRun, nodeId: string): MatchNode {
  const node = run.structure.matches.find((m) => m.id === nodeId);
  if (!node) throw notFound('Partida');
  return node;
}

function previousStage(tournament: DbTournament, stage: Stage): Stage | undefined {
  return tournament.stages.find((s) => s.order === stage.order - 1);
}

function publishStage(tournament: DbTournament, stageId: string): void {
  publish(`tournament:${tournament.id}`, { type: 'bracket.updated', stageId });
  publish(`tournament:${tournament.id}`, { type: 'standings.updated', stageId });
}

function matchLabel(match: Match): string {
  const names = match.participants.map((p) => p.name);
  return match.kind === 'LOBBY' ? `${match.stageName} · ${match.groupName ? `${match.groupName} · ` : ''}${match.roundLabel}` : `${match.roundLabel}: ${names.join(' x ')}`;
}

/**
 * Simula o job de fechamento do check-in (QStash + Cron na API real): em duelo com horário,
 * depois que a janela fecha, quem não fez check-in leva W.O. se o adversário fez (RN-04).
 * Roda antes de cada leitura — o efeito é idempotente.
 */
function applyDueWalkovers(tournament: DbTournament): void {
  if (!tournament.checkIn.enabled || tournament.status !== 'IN_PROGRESS') return;
  const now = Date.now();
  for (const stage of tournament.stages) {
    let run = getRun(stage.id);
    if (!run?.confirmed) continue;
    let changed = false;
    for (const node of run.structure.matches) {
      if (node.kind !== 'DUEL' || node.slots.length !== 2 || run.state.results[node.id]) continue;
      const [a, b] = node.slots;
      if (!a?.entrantId || !b?.entrantId) continue;
      const id = globalMatchId(stage.id, node.id);
      const meta = getMeta(id);
      const window = checkInWindow(tournament, meta.scheduledAt);
      if (!window || now < new Date(window.closesAt).getTime()) continue;
      const regs = db().registrations;
      const done = (registrationId: string) => {
        const reg = regs.find((r) => r.id === registrationId);
        if (!reg) return false;
        const required = checkInRequired(tournament, reg);
        return required.length > 0 && required.every((u) => meta.checkIns.some((c) => c.registrationId === registrationId && c.userId === u));
      };
      const aIn = done(a.entrantId);
      const bIn = done(b.entrantId);
      if (aIn === bIn) continue; // os dois presentes: joga-se; os dois ausentes: a organização decide.
      const winnerId = aIn ? a.entrantId : b.entrantId;
      const loserId = aIn ? b.entrantId : a.entrantId;
      const snapshot = applyWalkover(run.structure, run.state, { matchId: node.id, winnerId });
      run = { ...run, structure: snapshot.structure, state: snapshot.state };
      meta.updatedAt = nowIso();
      changed = true;
      resultEvents().push({ id: uid('re'), stageId: stage.id, matchId: id, type: 'WALKOVER', actorNickname: 'Sistema', summary: 'W.O. automático: adversário não fez check-in', reason: 'Check-in não realizado até o fechamento da janela', createdAt: nowIso() });
      audit(null, { action: 'WALKOVER_APPLIED', entityType: 'Match', entityId: id, entityLabel: `${stage.name} · ${node.roundLabel}`, tournamentId: tournament.id, reason: 'Check-in não realizado (automático)' });
      notify(usersOfRegistration(loserId), 'RESULT_POSTED', 'Você levou W.O.', `O check-in de ${node.roundLabel} não foi feito a tempo em ${tournament.name}.`, `/c/${tournament.slug}?aba=partidas`);
      notify(usersOfRegistration(winnerId), 'RESULT_POSTED', 'Vitória por W.O.', `Seu adversário não fez check-in em ${node.roundLabel} de ${tournament.name}.`, `/c/${tournament.slug}?aba=partidas`);
    }
    if (changed) {
      putRun(run);
      publishStage(tournament, stage.id);
    }
  }
}

/** Aplica um resultado (lançamento ou correção) e devolve a partida com os pontos calculados. */
function applyMatchResult(actor: DbUser, id: string, input: SubmitResultInput, opts: { source: 'STAFF' | 'SUBMISSION' | 'DISPUTE' | 'IMPORT' } = { source: 'STAFF' }) {
  const { stageId, nodeId } = splitMatchId(id);
  const { tournament, stage } = findStage(stageId);
  const run = requireRun(stageId, { confirmed: true });
  if (tournament.status === 'PAUSED') throw conflict('O campeonato está pausado. Retome para lançar resultados.', 'TOURNAMENT_PAUSED');
  if (!['IN_PROGRESS', 'FINISHED'].includes(tournament.status)) throw conflict('O campeonato não está em andamento.', 'TOURNAMENT_NOT_RUNNING');
  const node = findNode(run, nodeId);
  const previous = run.state.results[nodeId];
  if (previous && !input.correctionReason) throw badRequest('Informe o motivo da correção.', 'CORRECTION_REASON_REQUIRED', { correctionReason: 'Informe o motivo da correção' });

  const slotIds = new Set(node.slots.map((s) => s.entrantId).filter((x): x is string => x !== null));
  for (const e of input.entries) if (!slotIds.has(e.registrationId)) throw badRequest('Há um participante que não é desta partida.', 'INVALID_RESULT');

  // RN-14: empate em mata-mata só com o campo de desempate do jogo ou o vencedor informado.
  const game = db().games.find((g) => g.id === tournament.gameId);
  let winnerId = input.winnerRegistrationId;
  if (node.kind === 'DUEL' && winnerId === undefined && input.entries.length === 2) {
    const [a, b] = input.entries;
    if (a && b && (a.score ?? 0) === (b.score ?? 0)) {
      const tiebreak = game?.extraStatFields.find((f) => f.when === 'tiebreak');
      if (tiebreak) {
        const av = a.stats?.[tiebreak.key] ?? 0;
        const bv = b.stats?.[tiebreak.key] ?? 0;
        if (av !== bv) winnerId = av > bv ? a.registrationId : b.registrationId;
      }
    }
  }

  const engineInput: MatchResultInput = {
    matchId: nodeId,
    entries: input.entries.map((e) => ({
      entrantId: e.registrationId,
      ...(e.score !== undefined ? { score: e.score } : {}),
      ...(e.placement !== undefined ? { placement: e.placement } : {}),
      ...(e.kills !== undefined ? { kills: e.kills } : {}),
      ...(e.absent ? { absent: true } : {}),
      ...(e.stats ? { stats: e.stats } : {}),
    })),
    ...(winnerId !== undefined ? { winnerId } : {}),
  };
  const snapshot = engine(() => applyResult(run.structure, run.state, engineInput));

  const meta = getMeta(id);
  if (input.evidenceUrls.length > 0) meta.evidenceUrls = input.evidenceUrls;
  meta.playerKills = {};
  for (const e of input.entries) {
    if (!e.playerKills) continue;
    // Kills por jogador (RN-03): a soma precisa bater com as kills da equipe.
    const sum = Object.values(e.playerKills).reduce((s, k) => s + k, 0);
    if (e.kills !== undefined && sum !== e.kills) throw badRequest('A soma das kills por jogador precisa ser igual às kills da equipe.', 'PLAYER_KILLS_MISMATCH');
    meta.playerKills[e.registrationId] = e.playerKills;
  }
  meta.statusOverride = null;
  meta.updatedAt = nowIso();

  const next: DbStageRun = { ...run, structure: snapshot.structure, state: snapshot.state };
  putRun(next);

  const match = buildMatch(next, findNode(next, nodeId));
  const summary = match.kind === 'LOBBY' ? `${match.participants.filter((p) => p.placement === 1).map((p) => p.name)[0] ?? '—'} levou o Booyah` : match.participants.map((p) => `${p.name} ${p.score ?? 0}`).join(' x ');
  resultEvents().push({
    id: uid('re'),
    stageId,
    matchId: id,
    type: previous ? 'CORRECTED' : 'ENTERED',
    actorNickname: actor.nickname,
    summary,
    reason: input.correctionReason ?? null,
    createdAt: nowIso(),
  });
  audit(actor, {
    action: previous ? 'RESULT_CORRECTED' : 'RESULT_ENTERED',
    entityType: 'Match',
    entityId: id,
    entityLabel: matchLabel(match),
    tournamentId: tournament.id,
    before: previous ? { entries: previous.entries, winnerId: previous.winnerId } : null,
    after: { entries: snapshot.state.results[nodeId]?.entries, winnerId: snapshot.state.results[nodeId]?.winnerId, origem: opts.source },
    reason: input.correctionReason ?? null,
  });
  save();

  const everyone = match.participants.flatMap((p) => (p.registrationId ? usersOfRegistration(p.registrationId) : []));
  notify(everyone, 'RESULT_POSTED', previous ? 'Resultado corrigido' : 'Resultado lançado', `${matchLabel(match)} · ${tournament.name}`, `/c/${tournament.slug}?aba=partidas`);
  publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: id, stageId, status: match.status });
  publishStage(tournament, stageId);

  // Detalhamento dos pontos de cada participação, sempre calculado aqui.
  const { rules } = scoringOf(tournament, stage);
  const drops = next.structure.matches.filter((m) => m.kind === 'LOBBY' && m.groupId === node.groupId).length;
  const result = next.state.results[nodeId];
  const results = match.participants
    .filter((p) => p.registrationId)
    .map((p) => {
      const entry = result?.entries.find((e) => e.entrantId === p.registrationId);
      const computed =
        !entry || entry.absent
          ? { breakdown: [] as { label: string; points: number }[] }
          : node.kind === 'LOBBY'
            ? computePoints({ kills: entry.kills ?? 0, placement: entry.placement, ...entry.stats }, rules, { matchIndex: node.dropIndex ?? 1, matchCount: drops, multiplier: node.multiplier ?? 1 })
            : computePoints({ score: entry.score ?? 0, outcome: result?.draw ? 'draw' : result?.winnerId === entry.entrantId ? 'win' : 'loss', ...entry.stats }, rules);
      return { registrationId: p.registrationId as string, name: p.name, points: p.points ?? 0, breakdown: computed.breakdown.map((b) => ({ label: b.label, points: b.points })) };
    });
  return { match, results };
}

export { applyMatchResult };

export const handlers = [
  // ── Chave ──────────────────────────────────────────────────────────
  http.get(
    url('/stages/:id/bracket'),
    handle(({ params }) => {
      const stageId = param(params, 'id');
      const { tournament } = findStage(stageId);
      applyDueWalkovers(tournament);
      // A prévia (antes de confirmar) só aparece para a organização.
      return json(buildBracket(stageId, { includePreview: isStaff(currentUser(), tournament) }));
    }),
  ),

  http.post(
    url('/stages/:id/generate'),
    handle(async ({ params, request }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const input = await body(request, GenerateBracketInput);
      const existing = getRun(stageId);
      // RN-07: depois da primeira partida concluída a chave trava (só Admin destrava).
      if (existing && isLocked(existing)) throw conflict('A chave está travada porque a fase já tem partida concluída. Só um administrador pode destravar.', 'BRACKET_LOCKED');

      const prev = previousStage(tournament, stage);
      let entrants;
      if (prev) {
        if (!existing) throw conflict(`Conclua e avance a fase "${prev.name}" para preencher esta.`, 'PREVIOUS_STAGE_PENDING');
        entrants = existing.structure.entrants;
      } else {
        if (!['REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS'].includes(tournament.status)) throw conflict('Feche as inscrições antes de gerar a chave.', 'REGISTRATION_STILL_OPEN');
        entrants = entrantsFrom(confirmedRegistrations(tournament.id));
      }
      if (entrants.length < 2) throw conflict('São necessários pelo menos 2 participantes confirmados.', 'NOT_ENOUGH_ENTRANTS');

      let ordered = entrants;
      if (input.seeding === 'MANUAL') {
        if (!input.order || new Set(input.order).size !== entrants.length || !input.order.every((id) => entrants.some((e) => e.id === id))) {
          throw badRequest('A ordem manual precisa conter cada participante exatamente uma vez.', 'INVALID_ORDER');
        }
        ordered = input.order.map((id, i) => ({ ...(entrants.find((e) => e.id === id) as (typeof entrants)[number]), seed: i + 1 }));
      }

      const structure = engine(() => generateStage({ format: stage.format, entrants: ordered, config: toEngineConfig(stage), seeding: input.seeding, ...(input.seed ? { seed: input.seed } : {}) }));
      removeRun(stageId);
      putRun(newRun(stageId, tournament.id, structure, false));
      stage.seeding = input.seeding;
      stage.randomSeed = structure.seedUsed;
      save();
      audit(user, { action: 'BRACKET_GENERATED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, before: existing ? { seed: existing.structure.seedUsed } : null, after: { seed: structure.seedUsed, seeding: input.seeding, participantes: ordered.length } });
      return json(buildBracket(stageId, { includePreview: true }));
    }),
  ),

  http.patch(
    url('/stages/:id/seeding'),
    handle(async ({ params, request }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const input = await body(request, SwapSeedingInput);
      const run = requireRun(stageId);
      if (isLocked(run)) throw conflict('A chave está travada porque a fase já tem partida concluída. Só um administrador pode destravar.', 'BRACKET_LOCKED');
      const structure = engine(() => swapEntrants(run.structure, input.a, input.b, run.unlocked ? undefined : run.state));
      putRun({ ...run, structure });
      const name = (id: string) => structure.entrants.find((e) => e.id === id)?.name ?? id;
      audit(user, { action: 'BRACKET_SEEDING_CHANGED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, after: { trocou: [name(input.a), name(input.b)] } });
      if (run.confirmed) publishStage(tournament, stageId);
      return json(buildBracket(stageId, { includePreview: true }));
    }),
  ),

  http.post(
    url('/stages/:id/confirm'),
    handle(({ params }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const run = requireRun(stageId);
      if (run.confirmed) throw conflict('Esta chave já foi confirmada.', 'ALREADY_CONFIRMED');
      const prev = previousStage(tournament, stage);
      if (prev && prev.status !== 'COMPLETED') throw conflict(`A fase "${prev.name}" ainda não terminou.`, 'PREVIOUS_STAGE_PENDING');
      putRun({ ...run, confirmed: true });
      stage.status = 'ACTIVE';
      if (!prev && tournament.status !== 'IN_PROGRESS') tournament.status = 'IN_PROGRESS';
      tournament.updatedAt = nowIso();
      save();
      audit(user, { action: 'BRACKET_CONFIRMED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, after: { seed: run.structure.seedUsed } });
      const users = run.structure.entrants.flatMap((e) => usersOfRegistration(e.id));
      notify(users, 'QUALIFIED', prev ? `Você está na fase "${stage.name}"` : 'A chave saiu!', `${tournament.name}: confira seus confrontos.`, `/c/${tournament.slug}?aba=chave`);
      publishStage(tournament, stageId);
      publish(`tournament:${tournament.id}`, { type: 'tournament.updated', tournamentId: tournament.id });
      return json(buildBracket(stageId, { includePreview: true }));
    }),
  ),

  /** Só o Admin destrava uma chave que já tem partida concluída (RN-07). */
  http.post(
    url('/stages/:id/unlock'),
    handle(async ({ params, request }) => {
      const stageId = param(params, 'id');
      const admin = requireAdmin();
      const { reason } = await body(request, ReasonInput);
      const { tournament, stage } = findStage(stageId);
      const run = requireRun(stageId, { confirmed: true });
      putRun({ ...run, unlocked: true });
      audit(admin, { action: 'BRACKET_UNLOCKED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, reason });
      return json(buildBracket(stageId, { includePreview: true }));
    }),
  ),

  /** Suíço: gera a próxima rodada depois que a atual termina. */
  http.post(
    url('/stages/:id/next-round'),
    handle(({ params }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const run = requireRun(stageId, { confirmed: true });
      if (stage.format !== 'SWISS') throw badRequest('Só o sistema suíço gera rodadas uma a uma.');
      const structure = engine(() => generateSwissRound(run.structure, run.state));
      putRun({ ...run, structure });
      audit(user, { action: 'BRACKET_GENERATED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, after: { rodada: Math.max(...structure.matches.map((m) => m.round)) } });
      publishStage(tournament, stageId);
      return json(buildBracket(stageId, { includePreview: true }));
    }),
  ),

  // ── Classificação ──────────────────────────────────────────────────
  http.get(
    url('/stages/:id/standings'),
    handle(({ params }) => {
      const stageId = param(params, 'id');
      applyDueWalkovers(findStage(stageId).tournament);
      return json(buildStandings(stageId));
    }),
  ),

  // ── Avanço de fase ─────────────────────────────────────────────────
  http.get(
    url('/stages/:id/advance'),
    handle(({ params }) => json(advancePreview(param(params, 'id')))),
  ),
  http.post(
    url('/stages/:id/advance'),
    handle(({ params }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament);
      const preview = advancePreview(stageId, { persist: true });
      stage.status = 'COMPLETED';
      tournament.updatedAt = nowIso();
      save();
      audit(user, { action: 'STAGE_ADVANCED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name}`, tournamentId: tournament.id, after: { classificados: preview.qualified.map((q) => q.name), eliminados: preview.eliminated.length } });
      notify(preview.eliminated.flatMap((e) => usersOfRegistration(e.registrationId)), 'ELIMINATED', 'Fim da linha neste campeonato', `Você não avançou da fase "${stage.name}" em ${tournament.name}. Valeu pela participação!`, `/c/${tournament.slug}?aba=tabela`);
      publish(`tournament:${tournament.id}`, { type: 'stage.advanced', fromStageId: stageId, toStageId: preview.toStageId });
      return json(preview);
    }),
  ),

  // ── Partidas ───────────────────────────────────────────────────────
  http.get(
    url('/tournaments/:id/matches'),
    handle(({ params, request }) => {
      const tournament = findTournament(param(params, 'id'));
      applyDueWalkovers(tournament);
      const q = query(request);
      let matches = listMatches(tournament.id, q.get('stageId'));
      if (q.get('mine') === '1') {
        const user = currentUser();
        const reg = user ? registrationOfUser(tournament.id, user.id) : null;
        matches = reg ? matches.filter((m) => m.participants.some((p) => p.registrationId === reg.id)) : [];
      }
      return json(matches);
    }),
  ),

  http.get(
    url('/matches/:id'),
    handle(({ params }) => {
      const { stageId, nodeId } = splitMatchId(param(params, 'id'));
      applyDueWalkovers(findStage(stageId).tournament);
      const run = requireRun(stageId, { confirmed: true });
      return json(buildMatch(run, findNode(run, nodeId)));
    }),
  ),

  /** Agenda e sala. Moderador também pode (matriz RBAC). */
  http.patch(
    url('/matches/:id'),
    handle(async ({ params, request }) => {
      const id = param(params, 'id');
      const { stageId, nodeId } = splitMatchId(id);
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, ScheduleMatchInput);
      const run = requireRun(stageId, { confirmed: true });
      const node = findNode(run, nodeId);
      const meta = getMeta(id);
      const before = { scheduledAt: meta.scheduledAt, sala: meta.lobbyCode ? 'definida' : null };
      if (input.scheduledAt !== undefined) {
        // Reagendar zera os check-ins: na API real, as mensagens da partida são canceladas e recriadas.
        if (input.scheduledAt !== meta.scheduledAt) meta.checkIns = [];
        meta.scheduledAt = input.scheduledAt;
      }
      if (input.lobbyCode !== undefined) meta.lobbyCode = input.lobbyCode || null;
      if (input.lobbyPassword !== undefined) meta.lobbyPassword = input.lobbyPassword || null;
      meta.updatedAt = nowIso();
      save();
      // O código da sala nunca entra na auditoria nem em evento: só o fato de existir.
      audit(user, { action: 'MATCH_SCHEDULED', entityType: 'Match', entityId: id, entityLabel: `${stage.name} · ${node.roundLabel}`, tournamentId: tournament.id, before, after: { scheduledAt: meta.scheduledAt, sala: meta.lobbyCode ? 'definida' : null } });
      const match = buildMatch(run, node);
      if (input.scheduledAt) {
        notify(match.participants.flatMap((p) => (p.registrationId ? usersOfRegistration(p.registrationId) : [])), 'MATCH_SOON', 'Partida agendada', `${matchLabel(match)} · ${tournament.name}`, `/c/${tournament.slug}?aba=partidas`);
      }
      publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: id, stageId, status: match.status });
      return json(match);
    }),
  ),

  http.post(
    url('/stages/:id/schedule-round'),
    handle(async ({ params, request }) => {
      const stageId = param(params, 'id');
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, ScheduleRoundInput);
      const run = requireRun(stageId, { confirmed: true });
      const nodes = run.structure.matches
        .filter((m) => m.round === input.round && !(m.kind === 'DUEL' && m.slots.length === 1) && !run.state.results[m.id])
        .filter((m) => input.groupId === undefined || m.groupId === input.groupId)
        .filter((m) => input.bracket === undefined || m.bracket === input.bracket)
        .sort((a, b) => (a.groupId ?? '').localeCompare(b.groupId ?? '') || a.position - b.position);
      if (nodes.length === 0) throw badRequest('Não há partidas pendentes nessa rodada.', 'EMPTY_ROUND');
      const start = new Date(input.startsAt).getTime();
      nodes.forEach((node, i) => {
        const meta = getMeta(globalMatchId(stageId, node.id));
        meta.scheduledAt = new Date(start + i * input.intervalMinutes * 60_000).toISOString();
        meta.checkIns = [];
        meta.updatedAt = nowIso();
      });
      save();
      audit(user, { action: 'MATCH_SCHEDULED', entityType: 'Stage', entityId: stageId, entityLabel: `${tournament.name} · ${stage.name} · rodada ${input.round}`, tournamentId: tournament.id, after: { partidas: nodes.length, inicio: input.startsAt, intervaloMin: input.intervalMinutes } });
      publish(`tournament:${tournament.id}`, { type: 'bracket.updated', stageId });
      return json(listMatches(tournament.id, stageId));
    }),
  ),

  /** Código da sala: só para quem está na partida (e já no horário) ou para a organização (PRD §16.5). */
  http.get(
    url('/matches/:id/lobby'),
    handle(({ params }) => {
      const id = param(params, 'id');
      const { stageId, nodeId } = splitMatchId(id);
      const { tournament } = findStage(stageId);
      const user = requireUser();
      const run = requireRun(stageId, { confirmed: true });
      const node = findNode(run, nodeId);
      const meta = getMeta(id);
      const staff = isStaff(user, tournament);
      const reg = registrationOfUser(tournament.id, user.id);
      const inMatch = reg !== null && node.slots.some((s) => s.entrantId === reg.id);
      if (!staff && !inMatch) throw forbidden('A sala só é mostrada para quem está nesta partida.');
      if (!meta.lobbyCode) throw new HttpProblem(404, 'A organização ainda não informou a sala.', 'LOBBY_NOT_SET');
      if (!staff) {
        const window = checkInWindow(tournament, meta.scheduledAt);
        const revealAt = window ? new Date(window.opensAt).getTime() : meta.scheduledAt ? new Date(meta.scheduledAt).getTime() - 15 * 60_000 : 0;
        if (Date.now() < revealAt) throw new HttpProblem(403, 'A sala será liberada perto do horário da partida.', 'LOBBY_NOT_REVEALED');
      }
      return json({ code: meta.lobbyCode, password: meta.lobbyPassword, revealedAt: nowIso() });
    }),
  ),

  http.post(
    url('/matches/:id/check-in'),
    handle(({ params }) => {
      const id = param(params, 'id');
      const { stageId, nodeId } = splitMatchId(id);
      const { tournament } = findStage(stageId);
      const user = requireUser();
      const run = requireRun(stageId, { confirmed: true });
      const node = findNode(run, nodeId);
      const reg = registrationOfUser(tournament.id, user.id);
      if (!reg || !node.slots.some((s) => s.entrantId === reg.id)) throw forbidden('Você não está nesta partida.');
      if (run.state.results[nodeId]) throw conflict('Esta partida já foi concluída.', 'MATCH_FINISHED');
      const meta = getMeta(id);
      const window = checkInWindow(tournament, meta.scheduledAt);
      const now = Date.now();
      if (!window) throw conflict('Esta partida não tem check-in.', 'CHECKIN_DISABLED');
      if (now < new Date(window.opensAt).getTime()) throw conflict('O check-in ainda não abriu.', 'CHECKIN_NOT_OPEN');
      if (now >= new Date(window.closesAt).getTime()) throw conflict('A janela de check-in já fechou.', 'CHECKIN_CLOSED');
      const required = checkInRequired(tournament, reg);
      if (!required.includes(user.id)) throw forbidden(tournament.checkIn.requireAllMembers ? 'Só titulares confirmados fazem check-in.' : 'Neste campeonato, quem faz o check-in do squad é o capitão.');
      if (!meta.checkIns.some((c) => c.registrationId === reg.id && c.userId === user.id)) {
        meta.checkIns.push({ registrationId: reg.id, userId: user.id, at: nowIso() });
        meta.updatedAt = nowIso();
        save();
      }
      const match = buildMatch(run, node);
      publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: id, stageId, status: match.status });
      return json(match);
    }),
  ),

  /** O staff inicia a partida manualmente, ou devolve para "agendada" (RN-08). */
  http.post(
    url('/matches/:id/start'),
    handle(async ({ params, request }) => {
      const id = param(params, 'id');
      const { stageId, nodeId } = splitMatchId(id);
      const { tournament } = findStage(stageId);
      requireTournamentAccess(tournament, { allowModerator: true });
      const { live } = (await request.json().catch(() => ({ live: true }))) as { live?: boolean };
      const run = requireRun(stageId, { confirmed: true });
      const node = findNode(run, nodeId);
      if (run.state.results[nodeId]) throw conflict('Esta partida já foi concluída.', 'MATCH_FINISHED');
      if (node.slots.some((s) => s.entrantId === null)) throw conflict('A partida ainda espera o resultado de partidas anteriores.', 'MATCH_NOT_READY');
      const meta = getMeta(id);
      meta.statusOverride = live === false ? null : 'LIVE';
      meta.updatedAt = nowIso();
      save();
      const match = buildMatch(run, node);
      publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: id, stageId, status: match.status });
      return json(match);
    }),
  ),

  // ── Resultados ─────────────────────────────────────────────────────
  http.put(
    url('/matches/:id/result'),
    handle(async ({ params, request }) => {
      const id = param(params, 'id');
      const { tournament } = findStage(splitMatchId(id).stageId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, SubmitResultInput);

      // Idempotência: a mesma chave devolve a resposta já gravada, sem lançar de novo.
      const key = request.headers.get('Idempotency-Key');
      const cache = collection<{ key: string; response: unknown; at: string }>('idempotency');
      if (key) {
        const hit = cache.find((c) => c.key === `${user.id}:${id}:${key}`);
        if (hit) return json(hit.response);
      }
      const response = applyMatchResult(user, id, input);
      if (key) {
        cache.push({ key: `${user.id}:${id}:${key}`, response, at: nowIso() });
        save();
      }
      return json(response);
    }),
  ),

  http.post(
    url('/matches/:id/walkover'),
    handle(async ({ params, request }) => {
      const id = param(params, 'id');
      const { stageId, nodeId } = splitMatchId(id);
      const { tournament, stage } = findStage(stageId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, WalkoverInput);
      const run = requireRun(stageId, { confirmed: true });
      const node = findNode(run, nodeId);
      const snapshot = engine(() => applyWalkover(run.structure, run.state, { matchId: nodeId, winnerId: input.winnerRegistrationId }));
      const next = { ...run, structure: snapshot.structure, state: snapshot.state };
      putRun(next);
      const meta = getMeta(id);
      meta.statusOverride = null;
      meta.updatedAt = nowIso();
      resultEvents().push({ id: uid('re'), stageId, matchId: id, type: 'WALKOVER', actorNickname: user.nickname, summary: 'W.O. aplicado pela organização', reason: input.reason, createdAt: nowIso() });
      audit(user, { action: 'WALKOVER_APPLIED', entityType: 'Match', entityId: id, entityLabel: `${stage.name} · ${node.roundLabel}`, tournamentId: tournament.id, reason: input.reason });
      save();
      const match = buildMatch(next, findNode(next, nodeId));
      notify(match.participants.flatMap((p) => (p.registrationId ? usersOfRegistration(p.registrationId) : [])), 'RESULT_POSTED', 'W.O. aplicado', `${matchLabel(match)} · ${tournament.name}`, `/c/${tournament.slug}?aba=partidas`);
      publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: id, stageId, status: match.status });
      publishStage(tournament, stageId);
      return json(match);
    }),
  ),

  http.get(
    url('/matches/:id/events'),
    handle(({ params }) => {
      const id = param(params, 'id');
      splitMatchId(id);
      const list = resultEvents()
        .filter((e) => e.matchId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((e): ResultEvent => ({ id: e.id, matchId: e.matchId, type: e.type, actorNickname: e.actorNickname, summary: e.summary, reason: e.reason, createdAt: e.createdAt }));
      return json(list);
    }),
  ),

  /** Importação de resultados (CSV lido no navegador e enviado em lotes). */
  http.post(
    url('/tournaments/:id/results/import'),
    handle(async ({ params, request }) => {
      const tournament = findTournament(param(params, 'id'));
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, ImportResultsInput);
      let applied = 0;
      const errors: { matchId: string; message: string }[] = [];
      for (const item of input.results) {
        try {
          if (findStage(splitMatchId(item.matchId).stageId).tournament.id !== tournament.id) throw notFound('Partida');
          applyMatchResult(user, item.matchId, { entries: item.entries, evidenceUrls: [] }, { source: 'IMPORT' });
          applied += 1;
        } catch (error) {
          errors.push({ matchId: item.matchId, message: error instanceof HttpProblem ? error.title : 'Não foi possível lançar este resultado.' });
        }
      }
      return json({ applied, errors });
    }),
  ),

  // ── Desistência e desclassificação (RN-06) ─────────────────────────
  http.post(
    url('/registrations/:id/withdraw'),
    handle(async ({ params, request }) => {
      const registrationId = param(params, 'id');
      const reg = db().registrations.find((r) => r.id === registrationId);
      if (!reg) throw notFound('Inscrição');
      const tournament = findTournament(reg.tournamentId);
      const user = requireUser();
      const input = await body(request, WithdrawInput);
      const access = tournamentAccess(user, tournament);
      const team = reg.teamId ? db().teams.find((t) => t.id === reg.teamId) : undefined;
      const isOwnerOfRegistration = reg.userId === user.id || team?.captainId === user.id;
      // Desclassificar: dono, co-organizador ou Admin (moderador não). Desistir: o próprio inscrito/capitão.
      if (input.kind === 'DISQUALIFIED') {
        if (!access || access === 'MODERATOR') throw forbidden('Só a organização pode desclassificar.');
      } else if (!isOwnerOfRegistration && (!access || access === 'MODERATOR')) {
        throw forbidden('Só o próprio inscrito (ou o capitão) pode desistir.');
      }
      if (reg.status !== 'CONFIRMED') throw conflict('Esta inscrição não está ativa.', 'REGISTRATION_NOT_ACTIVE');

      reg.status = input.kind;
      reg.statusReason = input.reason;
      for (const stage of tournament.stages) {
        const run = getRun(stage.id);
        if (!run?.confirmed || stage.status !== 'ACTIVE' || !run.structure.entrants.some((e) => e.id === reg.id)) continue;
        const snapshot = engine(() => withdrawEntrant(run.structure, run.state, { entrantId: reg.id, kind: input.kind }));
        putRun({ ...run, structure: snapshot.structure, state: snapshot.state });
        publishStage(tournament, stage.id);
      }
      save();
      const view = toRegistration(reg);
      audit(user, { action: input.kind === 'DISQUALIFIED' ? 'ENTRANT_DISQUALIFIED' : 'ENTRANT_WITHDRAWN', entityType: 'Registration', entityId: reg.id, entityLabel: `${view.displayName} · ${tournament.name}`, tournamentId: tournament.id, reason: input.reason });
      if (input.kind === 'DISQUALIFIED') notify(usersOfRegistration(reg.id), 'ELIMINATED', 'Você foi desclassificado', `${tournament.name}: ${input.reason}`, `/c/${tournament.slug}`);
      return json(view);
    }),
  ),

  // ── Encerramento e pódio ───────────────────────────────────────────
  http.get(
    url('/tournaments/:id/podium'),
    handle(({ params }) => {
      const tournament = findTournament(param(params, 'id'));
      const podium = podiums().find((p) => p.tournamentId === tournament.id);
      return json(podium ? toPodium(podium) : null);
    }),
  ),

  /** Sugestão de pódio a partir da classificação da última fase. */
  http.get(
    url('/tournaments/:id/podium-suggestion'),
    handle(({ params }) => {
      const tournament = findTournament(param(params, 'id'));
      requireTournamentAccess(tournament);
      const last = [...tournament.stages].sort((a, b) => b.order - a.order)[0];
      const rows = last ? buildStandings(last.id).overall : [];
      const run = last ? getRun(last.id) : undefined;
      return json({ complete: Boolean(run?.confirmed && isStageComplete(run.structure, run.state)), ranking: rows.slice(0, 8).map((r) => ({ registrationId: r.registrationId, name: r.name, position: r.position })) });
    }),
  ),

  http.post(
    url('/tournaments/:id/finish'),
    handle(async ({ params, request }) => {
      const tournament = findTournament(param(params, 'id'));
      const { user } = requireTournamentAccess(tournament);
      const input = await body(request, FinishTournamentInput);
      if (tournament.status !== 'IN_PROGRESS') throw conflict('Só um campeonato em andamento pode ser encerrado.', 'INVALID_TRANSITION');
      const last = [...tournament.stages].sort((a, b) => b.order - a.order)[0];
      const run = last ? getRun(last.id) : undefined;
      if (!last || !run?.confirmed || !isStageComplete(run.structure, run.state)) throw conflict('Conclua todas as partidas da última fase antes de encerrar.', 'STAGE_INCOMPLETE');
      const ids = [input.first, input.second, input.third].filter((x): x is string => Boolean(x));
      if (new Set(ids).size !== ids.length) throw badRequest('O mesmo participante não pode ocupar duas posições do pódio.', 'DUPLICATE_PODIUM');
      if (!ids.every((id) => db().registrations.some((r) => r.id === id && r.tournamentId === tournament.id))) throw badRequest('Participante inválido no pódio.');

      const places = ids.map((registrationId, i) => ({ place: i + 1, registrationId }));
      const list = podiums();
      const existing = list.findIndex((p) => p.tournamentId === tournament.id);
      const record = { tournamentId: tournament.id, places, finishedAt: nowIso() };
      if (existing >= 0) list[existing] = record;
      else list.push(record);
      last.status = 'COMPLETED';
      tournament.status = 'FINISHED';
      tournament.updatedAt = nowIso();
      save();
      const podium = toPodium(record);
      audit(user, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: tournament.id, entityLabel: tournament.name, tournamentId: tournament.id, before: { status: 'IN_PROGRESS' }, after: { status: 'FINISHED', podio: podium.places.map((p) => `${p.place}º ${p.name}`) } });
      const everyone = db().registrations.filter((r) => r.tournamentId === tournament.id && r.status === 'CONFIRMED').flatMap((r) => usersOfRegistration(r.id));
      notify(everyone, 'ELIMINATED', `${tournament.name} terminou`, `Campeão: ${podium.places[0]?.name ?? '—'}. Veja o resultado final.`, `/c/${tournament.slug}`);
      publish(`tournament:${tournament.id}`, { type: 'tournament.updated', tournamentId: tournament.id });
      return json(podium);
    }),
  ),
];

function toPodium(p: { tournamentId: string; places: { place: number; registrationId: string }[]; finishedAt: string }): Podium {
  return {
    tournamentId: p.tournamentId,
    finishedAt: p.finishedAt,
    places: p.places.map((place) => {
      const reg = db().registrations.find((r) => r.id === place.registrationId);
      const view = reg ? toRegistration(reg) : null;
      return { place: place.place, registrationId: place.registrationId, name: view?.displayName ?? 'Inscrito', tag: view?.tag ?? null, logoUrl: view?.logoUrl ?? null };
    }),
  };
}

/** Prévia do avanço: classificados, eliminados e a chave da próxima fase. Com `persist`, grava a prévia da próxima fase. */
function advancePreview(stageId: string, opts: { persist?: boolean } = {}): AdvancePreview {
  const { tournament, stage } = findStage(stageId);
  requireTournamentAccess(tournament);
  const run = requireRun(stageId, { confirmed: true });
  const next = tournament.stages.find((s) => s.order === stage.order + 1);
  const qualification = toEngineQualification(stage);
  if (!next || !qualification) throw conflict('Esta é a última fase. Use "Encerrar campeonato".', 'LAST_STAGE');
  if (stage.status === 'COMPLETED') throw conflict('Esta fase já foi avançada.', 'ALREADY_ADVANCED');
  if (!isStageComplete(run.structure, run.state)) throw conflict('Ainda há partidas sem resultado nesta fase.', 'STAGE_INCOMPLETE');

  const { rules } = scoringOf(tournament, stage);
  const preview = engine(() =>
    advanceStage({
      structure: run.structure,
      state: run.state,
      standings: { rules, tiebreakers: stage.tiebreakers, scoreStat: 'score' },
      qualification,
      next: { format: next.format, config: toEngineConfig(next), seeding: next.seeding === 'RANDOM' ? 'RANDOM' : 'RANKED', seed: `${run.structure.seedUsed}-${next.order}` },
    }),
  );

  const existingNext = getRun(next.id);
  if (existingNext?.confirmed) throw conflict('A próxima fase já começou.', 'ALREADY_ADVANCED');
  // A prévia da próxima fase fica guardada como chave não confirmada: o organizador ainda pode ajustar e confirmar.
  if (opts.persist) {
    removeRun(next.id);
    putRun(newRun(next.id, tournament.id, preview.next, false));
    next.randomSeed = preview.next.seedUsed;
    save();
  }

  const groupName = (groupId: string | null) => run.structure.groups.find((g) => g.id === groupId)?.name ?? null;
  const name = (id: string) => run.structure.entrants.find((e) => e.id === id)?.name ?? 'Inscrito';
  const tmpRun = newRun(next.id, tournament.id, preview.next, false);
  const nextBracket = opts.persist
    ? buildBracket(next.id, { includePreview: true })
    : {
        ...buildBracket(next.id, { includePreview: false }),
        state: 'PREVIEW' as const,
        seeding: preview.next.seeding,
        seedUsed: preview.next.seedUsed,
        rounds: preview.next.rounds,
        groups: preview.next.groups.map((g) => ({ id: g.id, name: g.name, registrationIds: g.entrantIds })),
        entrants: preview.next.entrants.map((e, i) => ({ registrationId: e.id, name: name(e.id), tag: null, seed: e.seed ?? i + 1 })),
        matches: preview.next.matches.filter((m) => !(m.kind === 'DUEL' && m.slots.length === 1)).map((node) => buildMatch(tmpRun, node, { tournament, stage: next, names: new Map(run.structure.entrants.map((e) => [e.id, { name: e.name ?? 'Inscrito', tag: null, logoUrl: null }])), rules: scoringOf(tournament, next).rules })),
      };

  return {
    fromStageId: stageId,
    toStageId: next.id,
    qualified: preview.qualified.map((q) => ({ registrationId: q.entrantId, name: q.name || name(q.entrantId), groupName: groupName(q.groupId), groupPosition: q.groupPosition, via: q.via, seed: q.seed })),
    eliminated: preview.eliminated.map((id) => ({ registrationId: id, name: name(id) })),
    next: nextBracket,
  };
}

export { applyDueWalkovers };
