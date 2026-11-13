/** Ranking por jogo (ADR-0001): números vindos dos resultados das partidas, iguais aos do perfil competitivo. */
import { CompetitiveStats, GameRanking } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { as, call, setupMockApi } from '../testing';

setupMockApi();

async function ranking(slug: string): Promise<GameRanking> {
  as(null);
  const res = await call('GET', `/games/${slug}/ranking`);
  expect(res.status, res.detail).toBe(200);
  return GameRanking.parse(res.data);
}

describe('GET /games/:slug/ranking', () => {
  it('conta títulos, vitórias e placar a partir dos resultados (8 Ball, suíço finalizado com pódio)', async () => {
    const r = await ranking('8-ball-pool');
    expect(r.resultsAvailable).toBe(true);
    expect(r.highlight).toBe('SCORE');
    expect(r.entries).toHaveLength(8);
    // Só um campeão: o 1º do ranking tem 1 título, o resto nenhum.
    expect(r.entries[0]?.titles).toBe(1);
    expect(r.entries.slice(1).every((e) => e.titles === 0)).toBe(true);
    // Suíço de 3 rodadas: todo mundo jogou 3 partidas.
    expect(r.entries.every((e) => e.matches === 3)).toBe(true);
  });

  it('ordena por títulos, depois vitórias, depois placar; empate total divide a posição', async () => {
    const { entries } = await ranking('8-ball-pool');
    for (let i = 1; i < entries.length; i++) {
      const a = entries[i - 1];
      const b = entries[i];
      if (!a || !b) continue;
      const ka = [a.titles ?? 0, a.wins ?? 0, a.score ?? 0];
      const kb = [b.titles ?? 0, b.wins ?? 0, b.score ?? 0];
      const firstDiff = ka.findIndex((v, j) => v !== kb[j]);
      if (firstDiff === -1) expect(b.position).toBe(a.position);
      else {
        expect(ka[firstDiff]).toBeGreaterThan(kb[firstDiff] ?? 0);
        expect(b.position).toBe(i + 1);
      }
    }
  });

  it('usa a mesma conta do perfil competitivo', async () => {
    const { entries } = await ranking('8-ball-pool');
    for (const entry of entries.slice(0, 3)) {
      const res = await call('GET', `/users/${encodeURIComponent(entry.nickname)}/stats`);
      const game = CompetitiveStats.parse(res.data).perGame.find((g) => g.gameName === '8 Ball Pool');
      expect(game).toMatchObject({ titles: entry.titles, wins: entry.wins, score: entry.score, matches: entry.matches });
    }
  });

  it('campeonato em andamento: quem venceu mais partidas fica na frente (Clash Royale)', async () => {
    const { entries, highlight } = await ranking('clash-royale');
    expect(highlight).toBe('SCORE');
    expect(entries.length).toBe(16);
    const maxWins = Math.max(...entries.map((e) => e.wins ?? 0));
    expect(entries[0]?.wins).toBe(maxWins);
    expect(maxWins).toBeGreaterThan(0);
  });

  it('jogo de Battle Royale destaca kills; jogo inexistente = 404', async () => {
    expect((await ranking('free-fire')).highlight).toBe('KILLS');
    expect((await call('GET', '/games/jogo-que-nao-existe/ranking')).status).toBe(404);
  });
});
