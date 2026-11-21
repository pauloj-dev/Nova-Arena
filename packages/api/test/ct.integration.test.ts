/**
 * Cenários de referência do plano §9 que ainda não tinham teste próprio contra a API real (issue #102, Marco M2):
 *
 * - **CT-04**: 5 participantes em eliminação simples → byes para os seeds 1, 2 e 3; 4 partidas no total.
 * - **CT-06 (completo)**: Free Fire com 48 squads — grupos BR → mata-mata MD3 → final BR (5 quedas, a última vale
 *   dobrado) — jogado **inteiro pela API**, com os números da planilha de referência do motor
 *   (`packages/engine/test/fixtures/ct06-ff-48-squads.ts`): tabelas dos grupos, classificados, confrontos, finalistas,
 *   repescagem, tabela final e campeão.
 *
 * Os demais cenários estão em: CT-01, CT-05 e CT-08 (`results.integration.test.ts`), CT-02
 * (`registrations.integration.test.ts`), CT-03 e CT-09 (`admin-users.integration.test.ts`), CT-06 reduzido e CT-08 na
 * chave (`advance.integration.test.ts`), CT-07 (`check-in.integration.test.ts`); CT-10 é de tela
 * (`apps/web/e2e/competicao-participante.spec.ts`, nos dois modos).
 */
import { AdvancePreview, Bracket, Podium, Standings } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXPECTED_CHAMPION,
  EXPECTED_FINAL_TABLE,
  EXPECTED_FINALISTS,
  EXPECTED_GROUP_TABLES,
  EXPECTED_PHASE2_SEEDS,
  EXPECTED_REPECHAGE,
  FINAL_DROPS,
  GROUP_NAMES,
  GROUPS,
  PHASE1_DROPS,
  QUARTERFINALS,
  SEMIFINALS,
  SQUADS,
  findSeries,
  type DropRow,
} from '../../engine/test/fixtures/ct06-ff-48-squads';
import { BR_RULES, BR_TB, DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('cenários de referência CT-04 e CT-06 (Postgres)', { timeout: 120_000 }, () => {
  let h: Harness;
  const bracketOf = async (stageId: string) => Bracket.parse((await h.call('dono', `/stages/${stageId}/bracket`)).data);

  beforeAll(async () => {
    h = await createHarness(url as string, 'ct');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
  }, 60_000);
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('CT-04: 5 participantes em eliminação simples → byes para os seeds 1, 2 e 3; 4 partidas', async () => {
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 1 }, seeding: 'RANKED', tiebreakers: DUEL_TB }] });
    const sid = t.stageIds[0] as string;
    const regs = await h.register(t.id, [1, 2, 3, 4, 5].map((i) => ({ name: `Seed ${i}` })));
    const generated = await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'MANUAL', order: regs } });
    expect(generated.status, generated.detail).toBe(200);
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);

    const bracket = await bracketOf(sid);
    expect(bracket.matches).toHaveLength(4);
    expect(bracket.matches.map((m) => m.nodeId)).toEqual(['w-r1-m2', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1']);
    const [s1, s2, s3, s4, s5] = regs;
    // A única partida da 1ª rodada é 4 × 5; os seeds 1, 2 e 3 entram direto na 2ª.
    expect(bracket.matches.find((m) => m.nodeId === 'w-r1-m2')?.participants.map((p) => p.registrationId)).toEqual([s4, s5]);
    expect(bracket.matches.find((m) => m.nodeId === 'w-r2-m1')?.participants.map((p) => p.registrationId)).toContain(s1);
    expect(bracket.matches.find((m) => m.nodeId === 'w-r2-m2')?.participants.map((p) => p.registrationId).sort()).toEqual([s2, s3].sort());
    // Ninguém dos seeds 1 a 3 joga a 1ª rodada.
    const firstRound = bracket.matches.filter((m) => m.round === 1).flatMap((m) => m.participants.map((p) => p.registrationId));
    expect(firstRound.some((id) => [s1, s2, s3].includes(id as string))).toBe(false);
  });

  it('CT-06: 48 squads FF — grupos BR → mata-mata MD3 → final BR, campeão igual ao da planilha de referência', async () => {
    const ff = await h.game('BATTLE_ROYALE', [
      { name: 'padrao', rules: BR_RULES },
      { name: 'cs', matchType: 'TEAM_VS_TEAM', rules: [{ type: 'OUTCOME', win: 3, draw: 0, loss: 0 }] },
    ]);
    const t = await h.tournament({
      owner: 'dono',
      game: ff,
      name: 'Copa Nova FF — CT-06',
      stages: [
        { name: 'Fase de grupos', format: 'GROUPS', model: 'padrao', config: { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }, qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, tiebreakers: BR_TB, seeding: 'MANUAL' },
        { name: 'Mata-mata 4v4', format: 'TEAM_VS_TEAM', model: 'cs', config: { bestOf: 3 }, qualification: { type: 'WINNERS', n: 2, repechage: 2 }, tiebreakers: DUEL_TB, seeding: 'RANKED' },
        { name: 'Grande Final', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 5, lobbySize: 4, lastDropMultiplier: 2 }, tiebreakers: BR_TB, seeding: 'RANKED' },
      ],
    });
    const [s1, s2, s3] = t.stageIds as [string, string, string];
    const regIds = await h.register(t.id, SQUADS.map((s) => ({ name: s.name })));
    const reg = new Map(SQUADS.map((s, i) => [s.id, regIds[i] as string]));
    const squad = new Map(SQUADS.map((s, i) => [regIds[i] as string, s.id]));
    const toSquads = (rows: { registrationId: string | null }[]) => rows.map((r) => squad.get(r.registrationId as string));

    // ── Fase 1: serpentina sobre a ordem da planilha ──
    const gen = await h.call('dono', `/stages/${s1}/generate`, { method: 'POST', body: { seeding: 'MANUAL', order: regIds } });
    expect(gen.status, gen.detail).toBe(200);
    expect((await h.call('dono', `/stages/${s1}/confirm`, { method: 'POST' })).status).toBe(200);
    const b1 = await bracketOf(s1);
    expect(b1.matches).toHaveLength(12);
    const drop = async (nodeId: string, rows: DropRow[], bracket: Bracket) => {
      const m = bracket.matches.find((x) => x.nodeId === nodeId);
      if (!m) throw new Error(`queda ${nodeId} não existe`);
      const res = await h.call('dono', `/matches/${m.id}/result`, { method: 'PUT', body: { entries: rows.map(([sq, placement, kills]) => ({ registrationId: reg.get(sq), placement, kills })) } });
      expect(res.status, `${nodeId}: ${res.detail}`).toBe(200);
    };
    for (const [g, name] of GROUP_NAMES.entries()) {
      // Cada grupo tem os mesmos 12 squads da planilha.
      expect(toSquads(b1.matches.find((m) => m.nodeId === `g${g + 1}-q1`)?.participants ?? []).sort()).toEqual(GROUPS[name].slice().sort());
      for (const [d, rows] of PHASE1_DROPS[name].entries()) await drop(`g${g + 1}-q${d + 1}`, rows, b1);
    }
    const t1 = Standings.parse((await h.call(null, `/stages/${s1}/standings`)).data);
    GROUP_NAMES.forEach((name, g) => {
      expect(t1.groups[g]?.rows.map((r) => [squad.get(r.registrationId), r.points, r.booyahs, r.kills]), `Grupo ${name}`).toEqual(EXPECTED_GROUP_TABLES[name]);
    });
    // CT-05 dentro do CT-06: 2º e 3º do Grupo A empatam em 18 pontos; decide o Booyah.
    const [, second, third] = t1.groups[0]?.rows ?? [];
    expect([squad.get(second?.registrationId as string), second?.points, squad.get(third?.registrationId as string), third?.points]).toEqual(['sq09', 18, 'sq01', 18]);

    // ── Fase 1 → 2: top 2 de cada grupo, seeds pela classificação ──
    const toKnockout = await h.call('dono', `/stages/${s1}/advance`, { method: 'POST' });
    expect(toKnockout.status, toKnockout.detail).toBe(200);
    expect(AdvancePreview.parse(toKnockout.data).qualified.map((q) => squad.get(q.registrationId))).toEqual(EXPECTED_PHASE2_SEEDS);
    expect((await h.call('dono', `/stages/${s2}/confirm`, { method: 'POST' })).status).toBe(200);

    // ── Fase 2: cada confronto que a chave montar é procurado na planilha ──
    let b2 = await bracketOf(s2);
    expect(b2.matches.filter((m) => m.round === 1).map((m) => toSquads(m.participants))).toEqual(QUARTERFINALS.map((s) => [s.a, s.b]));
    for (let guard = 0; guard < 10; guard += 1) {
      const ready = b2.matches.filter((m) => m.participants.length === 2 && m.participants.every((p) => p.registrationId) && !['VALIDATED', 'WALKOVER'].includes(m.status));
      if (ready.length === 0) break;
      for (const m of ready) {
        const [x, y] = toSquads(m.participants) as [string, string];
        const series = findSeries([...QUARTERFINALS, ...SEMIFINALS], x, y);
        if (!series) throw new Error(`A planilha não tem a série ${x} × ${y}`);
        const res = await h.call('dono', `/matches/${m.id}/result`, { method: 'PUT', body: { entries: [{ registrationId: reg.get(series.a), score: series.scoreA }, { registrationId: reg.get(series.b), score: series.scoreB }] } });
        expect(res.status, res.detail).toBe(200);
      }
      b2 = await bracketOf(s2);
    }
    expect(b2.complete).toBe(true);
    expect(b2.matches.filter((m) => m.round === 2).map((m) => toSquads(m.participants))).toEqual(SEMIFINALS.map((s) => [s.a, s.b]));

    // ── Fase 2 → 3: os 2 finalistas + 2 da repescagem ──
    const toFinal = AdvancePreview.parse((await h.call('dono', `/stages/${s2}/advance`, { method: 'POST' })).data);
    const via = (kind: string) => toFinal.qualified.filter((q) => q.via === kind).map((q) => squad.get(q.registrationId) as string).sort();
    expect(via('DIRECT')).toEqual(EXPECTED_FINALISTS.slice().sort());
    expect(via('REPECHAGE')).toEqual(EXPECTED_REPECHAGE.slice().sort());
    expect((await h.call('dono', `/stages/${s3}/confirm`, { method: 'POST' })).status).toBe(200);
    const b3 = await bracketOf(s3);
    expect(b3.matches.map((m) => m.nodeId)).toEqual(['br-s1-q1', 'br-s1-q2', 'br-s1-q3', 'br-s1-q4', 'br-s1-q5']);
    for (const [d, rows] of FINAL_DROPS.entries()) await drop(`br-s1-q${d + 1}`, rows, b3);

    // ── Tabela final e campeão iguais aos da planilha; pódio pela API ──
    const final = Standings.parse((await h.call(null, `/stages/${s3}/standings`)).data).overall;
    expect(final.map((r) => [squad.get(r.registrationId), r.points])).toEqual(EXPECTED_FINAL_TABLE);
    expect(squad.get(final[0]?.registrationId as string)).toBe(EXPECTED_CHAMPION);
    const finish = await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { first: final[0]?.registrationId, second: final[1]?.registrationId, third: final[2]?.registrationId } });
    expect(finish.status, finish.detail).toBe(200);
    const podium = Podium.parse((await h.call(null, `/tournaments/${t.slug}/podium`)).data);
    expect(squad.get(podium.places[0]?.registrationId as string)).toBe(EXPECTED_CHAMPION);
    expect(podium.places[0]?.name).toBe('Esquadrão Capital');
  });
});
