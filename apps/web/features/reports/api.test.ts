/** Regras de denúncia aplicadas pela API simulada (PAR-12). */
import { Bracket, Report, type Match } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '@/mocks/db';
import { MAX_OPEN_REPORTS_PER_TARGET, reports } from '@/mocks/handlers/reports';
import { as, call, mutate, setupMockApi } from '@/mocks/testing';

setupMockApi();

const BIANCA = 'u_bianca';
const LUCAS = 'u_lucas';
const Reports = z.array(Report);
const base = { reason: 'HARASSMENT', description: 'Xingou meu squad inteiro no chat da partida.' };

describe('denúncias', () => {
  it('sem login = 401', async () => {
    as(null);
    expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS })).status).toBe(401);
    expect((await call('GET', '/me/reports')).status).toBe(401);
  });

  it('a si mesmo = 400; o próprio squad (capitão) = 400', async () => {
    as(BIANCA);
    const self = await call('POST', '/reports', { ...base, targetType: 'USER', targetId: BIANCA });
    expect(self.status).toBe(400);
    expect(self.code).toBe('REPORT_SELF');
    as(LUCAS);
    expect((await call('POST', '/reports', { ...base, targetType: 'TEAM', targetId: 't_alfa' })).code).toBe('REPORT_SELF');
  });

  it('denúncia de usuário grava alvo, autor e dono do alvo; aparece só em "minhas"', async () => {
    as(BIANCA);
    const before = Reports.parse((await call('GET', '/me/reports')).data).length;
    const res = await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS, evidenceUrls: ['data:image/jpeg;base64,AAAA'] });
    expect(res.status).toBe(201);
    const report = Report.parse(res.data);
    expect(report).toMatchObject({ targetType: 'USER', targetId: LUCAS, targetLabel: 'Lucas', targetLink: '/u/Lucas', reporterNickname: 'Bianca', status: 'OPEN', resolution: null, handledByNickname: null, evidenceUrls: ['data:image/jpeg;base64,AAAA'] });
    // A resposta pública não leva os campos internos; a coleção (lida pela moderação) leva.
    expect(res.data).not.toHaveProperty('reporterId');
    expect(reports().find((r) => r.id === report.id)).toMatchObject({ reporterId: BIANCA, targetOwnerUserId: LUCAS });

    const mine = Reports.parse((await call('GET', '/me/reports')).data);
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]?.id).toBe(report.id);
    as(LUCAS);
    expect(Reports.parse((await call('GET', '/me/reports')).data).some((r) => r.id === report.id)).toBe(false);
  });

  it('resolve o nome e o link de squad, partida e resultado', async () => {
    as(BIANCA);
    const team = Report.parse((await call('POST', '/reports', { ...base, reason: 'OFFENSIVE_NAME', targetType: 'TEAM', targetId: 't_alfa' })).data);
    expect(team).toMatchObject({ targetLabel: 'Squad Alfa [ALFA]', targetLink: '/minha-conta/squads/t_alfa' });
    expect(reports().find((r) => r.id === team.id)?.targetOwnerUserId).toBe(LUCAS);

    const bracket = Bracket.parse((await call('GET', '/stages/tn_liga_cr_s1/bracket')).data);
    const match = bracket.matches.find((m) => m.status === 'VALIDATED') as Match;
    const names = match.participants.map((p) => p.name).join(' x ');
    const onMatch = Report.parse((await call('POST', '/reports', { ...base, reason: 'CHEATING', targetType: 'MATCH', targetId: match.id })).data);
    expect(onMatch.targetLabel).toBe(`${match.roundLabel}: ${names} · Liga Semanal Clash Royale 1v1`);
    expect(onMatch.targetLink).toBe('/c/liga-semanal-clash-royale?aba=partidas');
    const onResult = Report.parse((await call('POST', '/reports', { ...base, reason: 'FAKE_RESULT', targetType: 'RESULT', targetId: match.id })).data);
    expect(onResult.targetLabel).toBe(`Resultado de ${match.roundLabel}: ${names} · Liga Semanal Clash Royale 1v1`);
  });

  it('alvo inexistente = 404; descrição curta = 400 com erro no campo', async () => {
    as(BIANCA);
    expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: 'u_nao_existe' })).status).toBe(404);
    expect((await call('POST', '/reports', { ...base, targetType: 'TEAM', targetId: 't_nao_existe' })).status).toBe(404);
    expect((await call('POST', '/reports', { ...base, targetType: 'MATCH', targetId: 'tn_liga_cr_s1~nao-existe' })).status).toBe(404);
    const short = await call<{ errors?: Record<string, string> }>('POST', '/reports', { ...base, description: 'curta', targetType: 'USER', targetId: LUCAS });
    expect(short.status).toBe(400);
    expect(short.data.errors?.description).toMatch(/pelo menos 10/);
  });

  it(`limite: no máximo ${MAX_OPEN_REPORTS_PER_TARGET} denúncias abertas do mesmo autor para o mesmo alvo`, async () => {
    as(BIANCA);
    for (let i = 0; i < MAX_OPEN_REPORTS_PER_TARGET; i += 1) {
      expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS })).status).toBe(201);
    }
    const blocked = await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS });
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('REPORT_LIMIT');
    // Outro alvo e outro autor não são afetados.
    expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: 'u_p01' })).status).toBe(201);
    as('u_p01');
    expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS })).status).toBe(201);
    // Quando a moderação trata uma delas, o autor pode denunciar de novo.
    mutate(() => {
      const one = reports().find((r) => r.reporterId === BIANCA && r.targetId === LUCAS && r.status === 'OPEN');
      if (one) one.status = 'DISMISSED';
    });
    as(BIANCA);
    expect((await call('POST', '/reports', { ...base, targetType: 'USER', targetId: LUCAS })).status).toBe(201);
  });

  it('a demonstração traz uma denúncia já respondida para a Bianca', async () => {
    as(BIANCA);
    const mine = Reports.parse((await call('GET', '/me/reports')).data);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'ACTIONED', handledByNickname: 'Ana' });
    expect(mine[0]?.resolution).toBeTruthy();
    expect(db().extra.reports).toHaveLength(3);
  });
});
