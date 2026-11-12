/** Perfil competitivo calculado pela API simulada a partir das fases, dos resultados e dos pódios (PAR-11). */
import { CompetitiveStats, Podium, Standings } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { as, call, mutate, setupMockApi } from '@/mocks/testing';

setupMockApi();

const stats = async (nickname: string) => CompetitiveStats.parse((await call('GET', `/users/${nickname}/stats`)).data);
const registrationOf = (tournamentId: string, userId: string) => db().registrations.find((r) => r.tournamentId === tournamentId && r.userId === userId)?.id as string;

describe('perfil competitivo', () => {
  it('é público e 404 para apelido inexistente', async () => {
    as(null);
    expect((await call('GET', '/users/Bianca/stats')).status).toBe(200);
    expect((await call('GET', '/users/bianca/stats')).status).toBe(200);
    expect((await call('GET', '/users/NaoExiste/stats')).status).toBe(404);
    // A rota do perfil público continua respondendo (as duas convivem).
    expect((await call<{ nickname: string }>('GET', '/users/Bianca')).data.nickname).toBe('Bianca');
  });

  it('as estatísticas da Bianca no Open 8 Ball batem com a tabela e o pódio do seed', async () => {
    const reg = registrationOf('tn_open_8ball', 'u_bianca');
    const row = Standings.parse((await call('GET', '/stages/tn_open_8ball_s1/standings')).data).overall.find((r) => r.registrationId === reg);
    const podium = Podium.parse((await call('GET', '/tournaments/tn_open_8ball/podium')).data);
    const place = podium.places.find((p) => p.registrationId === reg)?.place ?? null;
    expect(row).toBeDefined();

    const s = await stats('Bianca');
    expect(s.userId).toBe('u_bianca');
    const pool = s.perGame.find((g) => g.gameId === 'g_8ball');
    expect(pool).toEqual({ gameId: 'g_8ball', gameName: '8 Ball Pool', gameIcon: expect.any(String), tournaments: 1, titles: place === 1 ? 1 : 0, matches: row?.played, wins: row?.wins, kills: 0, score: row?.scoreFor });
    // Suíço de 3 rodadas com 8 jogadores: 3 partidas; a cabeça de chave 1 vence todas e leva o título.
    expect(pool).toMatchObject({ matches: 3, wins: 3, titles: 1, score: 6 });

    const entry = s.history.find((h) => h.tournamentId === 'tn_open_8ball');
    expect(entry).toMatchObject({ tournamentName: 'Open 8 Ball Pool', tournamentSlug: 'open-8-ball-pool', placement: 1, finishedAt: podium.finishedAt, teamName: null });
    expect(s.achievements.find((a) => a.type === 'CHAMPION')).toMatchObject({ label: 'Campeão', tournamentName: 'Open 8 Ball Pool', awardedAt: podium.finishedAt });
    expect(s.achievements.find((a) => a.type === 'FIRST_TOURNAMENT')).toMatchObject({ tournamentName: 'Open 8 Ball Pool' });
    expect(s.achievements.some((a) => a.type === 'TEN_TOURNAMENTS')).toBe(false);
  });

  it('campeonato em andamento conta partidas e fica no histórico sem colocação', async () => {
    const s = await stats('Bianca');
    // Liga CR: a Bianca venceu as oitavas por 2 a x e está nas quartas.
    expect(s.perGame.find((g) => g.gameId === 'g_clashroyale')).toMatchObject({ tournaments: 1, titles: 0, matches: 1, wins: 1, score: 2 });
    const liga = s.history.find((h) => h.tournamentId === 'tn_liga_cr');
    expect(liga).toMatchObject({ placement: null, finishedAt: null });
    // Em andamento vem antes dos encerrados.
    expect(s.history.map((h) => h.tournamentId)).toEqual(['tn_liga_cr', 'tn_open_8ball']);
  });

  it('pódio: vice e 3º lugar viram conquista; quem não subiu ao pódio fica com a posição da tabela', async () => {
    const podium = Podium.parse((await call('GET', '/tournaments/tn_open_8ball/podium')).data);
    const table = Standings.parse((await call('GET', '/stages/tn_open_8ball_s1/standings')).data).overall;
    const nickOf = (registrationId: string) => db().users.find((u) => u.id === db().registrations.find((r) => r.id === registrationId)?.userId)?.nickname as string;

    const second = await stats(nickOf(podium.places.find((p) => p.place === 2)?.registrationId as string));
    expect(second.achievements.map((a) => a.type)).toEqual(expect.arrayContaining(['RUNNER_UP', 'FIRST_TOURNAMENT']));
    expect(second.perGame[0]).toMatchObject({ titles: 0, tournaments: 1 });
    expect(second.history[0]?.placement).toBe(2);
    const third = await stats(nickOf(podium.places.find((p) => p.place === 3)?.registrationId as string));
    expect(third.achievements.map((a) => a.type)).toContain('THIRD_PLACE');

    const last = table[table.length - 1];
    const loser = await stats(nickOf(last?.registrationId as string));
    expect(loser.history[0]?.placement).toBe(last?.position);
    expect(loser.achievements.map((a) => a.type)).toEqual(['FIRST_TOURNAMENT']);
    expect(loser.perGame[0]).toMatchObject({ matches: last?.played, wins: last?.wins, score: last?.scoreFor });
  });

  it('quem nunca jogou tem tudo vazio; inscrição sem chave confirmada não conta', async () => {
    // Lucas está inscrito (Squad Alfa) em um campeonato que ainda não começou.
    expect(await stats('Lucas')).toEqual({ userId: 'u_lucas', perGame: [], achievements: [], history: [] });
    expect(await stats('Camila')).toEqual({ userId: 'u_camila', perGame: [], achievements: [], history: [] });
  });

  it('campeonato cancelado sai do histórico', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_open_8ball');
      if (t) t.status = 'CANCELLED';
    });
    const s = await stats('Bianca');
    expect(s.perGame.map((g) => g.gameId)).toEqual(['g_clashroyale']);
    expect(s.history.map((h) => h.tournamentId)).toEqual(['tn_liga_cr']);
  });
});
