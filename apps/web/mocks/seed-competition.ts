/**
 * Dados de competição do protótipo, gerados pelo próprio motor:
 * - Liga Semanal Clash Royale: mata-mata MD3 em andamento (oitavas jogadas, quartas em curso);
 * - Open 8 Ball Pool: suíço de 3 rodadas concluído, com pódio.
 * Opera direto sobre o objeto do seed (não chama `db()`), para não criar dependência circular.
 */
import { applyResult, computeStandings, createStageState, generateStage, generateSwissRound, type Rule, type StageState, type StageStructure } from '@nova/engine';
import type { Db } from './db';

const MIN = 60_000;
const HOUR = 60 * MIN;

interface Run {
  stageId: string;
  tournamentId: string;
  structure: StageStructure;
  state: StageState;
  confirmed: boolean;
  unlocked: boolean;
  updatedAt: string;
}
interface Meta {
  id: string;
  scheduledAt: string | null;
  lobbyCode: string | null;
  lobbyPassword: string | null;
  checkIns: { registrationId: string; userId: string; at: string }[];
  evidenceUrls: string[];
  playerKills: Record<string, Record<string, number>>;
  statusOverride: null;
  updatedAt: string | null;
}

function entrantsOf(d: Db, tournamentId: string) {
  return d.registrations
    .filter((r) => r.tournamentId === tournamentId && r.status === 'CONFIRMED')
    .map((r, i) => ({ id: r.id, name: d.users.find((u) => u.id === r.userId)?.nickname ?? 'Inscrito', seed: i + 1 }));
}

function meta(stageId: string, nodeId: string, patch: Partial<Meta>): Meta {
  return { id: `${stageId}~${nodeId}`, scheduledAt: null, lobbyCode: null, lobbyPassword: null, checkIns: [], evidenceUrls: [], playerKills: {}, statusOverride: null, updatedAt: null, ...patch };
}

export function seedCompetition(d: Db, base: number): void {
  const runs: Run[] = [];
  const metas: Meta[] = [];
  const iso = (offset: number) => new Date(base + offset).toISOString();

  // ── Liga Semanal Clash Royale (em andamento) ───────────────────────
  {
    const tournamentId = 'tn_liga_cr';
    const stageId = 'tn_liga_cr_s1';
    const bianca = d.registrations.find((r) => r.tournamentId === tournamentId && r.userId === 'u_bianca')?.id;
    let structure = generateStage({ format: 'SINGLE_ELIM', entrants: entrantsOf(d, tournamentId), config: { bestOf: 3, thirdPlace: true }, seeding: 'RANDOM', seed: 'liga-cr-2026' });
    let state = createStageState();
    const play = (nodeId: string, winnerSlot: 0 | 1, loserGames: 0 | 1) => {
      const node = structure.matches.find((m) => m.id === nodeId);
      const a = node?.slots[0]?.entrantId;
      const b = node?.slots[1]?.entrantId;
      if (!a || !b) return;
      const snapshot = applyResult(structure, state, {
        matchId: nodeId,
        entries: [
          { entrantId: a, score: winnerSlot === 0 ? 2 : loserGames },
          { entrantId: b, score: winnerSlot === 1 ? 2 : loserGames },
        ],
      });
      structure = snapshot.structure;
      state = snapshot.state;
    };

    // Oitavas: todas jogadas ontem. A Bianca vence a dela.
    structure.matches
      .filter((m) => m.round === 1)
      .forEach((m, i) => {
        const biancaSlot = m.slots.findIndex((s) => s.entrantId === bianca);
        play(m.id, biancaSlot === 1 ? 1 : 0, i % 2 === 0 ? 0 : 1);
        metas.push(meta(stageId, m.id, { scheduledAt: iso(-26 * HOUR + i * 20 * MIN), updatedAt: iso(-25 * HOUR) }));
      });

    // Quartas: duas já jogadas; a da Bianca com check-in aberto agora; a outra mais tarde.
    const quarters = structure.matches.filter((m) => m.round === 2 && m.bracket === 'WINNERS');
    const others = quarters.filter((m) => !m.slots.some((s) => s.entrantId === bianca));
    const hers = quarters.find((m) => m.slots.some((s) => s.entrantId === bianca));
    others.slice(0, 2).forEach((m, i) => {
      play(m.id, i === 0 ? 0 : 1, 1);
      metas.push(meta(stageId, m.id, { scheduledAt: iso(-2 * HOUR + i * 30 * MIN), updatedAt: iso(-HOUR) }));
    });
    if (hers) metas.push(meta(stageId, hers.id, { scheduledAt: iso(20 * MIN), lobbyCode: 'NOVA-7Q2', lobbyPassword: '4821', updatedAt: iso(-3 * HOUR) }));
    const later = others[2];
    if (later) metas.push(meta(stageId, later.id, { scheduledAt: iso(2 * HOUR), lobbyCode: 'NOVA-9K4', lobbyPassword: '1177', updatedAt: iso(-3 * HOUR) }));

    runs.push({ stageId, tournamentId, structure, state, confirmed: true, unlocked: false, updatedAt: iso(-HOUR) });
  }

  // ── Open 8 Ball Pool (finalizado) ──────────────────────────────────
  {
    const tournamentId = 'tn_open_8ball';
    const stageId = 'tn_open_8ball_s1';
    let structure = generateStage({ format: 'SWISS', entrants: entrantsOf(d, tournamentId), config: { bestOf: 3, rounds: 3 }, seeding: 'RANKED', seed: 'open-8ball-2026' });
    let state = createStageState();
    const seedOf = new Map(structure.entrants.map((e) => [e.id, e.seed ?? 99]));
    for (let round = 1; round <= 3; round += 1) {
      if (round > 1) structure = generateSwissRound(structure, state);
      for (const m of structure.matches.filter((x) => x.round === round && x.slots.length === 2)) {
        const a = m.slots[0]?.entrantId;
        const b = m.slots[1]?.entrantId;
        if (!a || !b) continue;
        // O melhor cabeça de chave vence; o placar varia para a tabela ter saldo diferente.
        const aWins = (seedOf.get(a) ?? 99) < (seedOf.get(b) ?? 99);
        const loser = (m.position + round) % 2 === 0 ? 1 : 0;
        const snapshot = applyResult(structure, state, { matchId: m.id, entries: [{ entrantId: a, score: aWins ? 2 : loser }, { entrantId: b, score: aWins ? loser : 2 }] });
        structure = snapshot.structure;
        state = snapshot.state;
        metas.push(meta(stageId, m.id, { scheduledAt: iso(-21 * 24 * HOUR + round * HOUR), updatedAt: iso(-21 * 24 * HOUR + round * HOUR + 40 * MIN) }));
      }
    }
    runs.push({ stageId, tournamentId, structure, state, confirmed: true, unlocked: false, updatedAt: iso(-20 * 24 * HOUR) });

    const game = d.games.find((g) => g.id === 'g_8ball');
    const rules = (game?.scoringModels.find((m) => m.id === 'sm_pool_padrao')?.rules ?? []) as Rule[];
    const table = computeStandings(structure, state, { rules, tiebreakers: ['points', 'scoreDiff', 'headToHead', 'draw'], scoreStat: 'score' }).overall;
    d.extra.podiums = [{ tournamentId, places: table.slice(0, 3).map((row, i) => ({ place: i + 1, registrationId: row.entrantId })), finishedAt: iso(-20 * 24 * HOUR) }];
  }

  d.extra.stageRuns = runs;
  d.extra.matchMeta = metas;
}
