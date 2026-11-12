/**
 * Regras que atravessam módulos da API simulada: feature flags aplicadas nos handlers,
 * sessão que cai com a sanção e auditoria das ações sensíveis fora do painel Admin.
 */
import { Match } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { auditLogs } from './audit';
import { as, call, setupMockApi } from './testing';

setupMockApi();

const RAFAEL = 'u_rafael'; // super admin
const ANA = 'u_ana'; // admin
const BIANCA = 'u_bianca';
const CAMILA = 'u_camila';

const NEW_ACCOUNT = { email: 'novo@exemplo.com', nickname: 'NovoJogador', password: 'arena1234', birthDate: '2000-01-01', acceptTerms: true };

async function setFlag(key: string, enabled: boolean): Promise<void> {
  as(RAFAEL);
  const res = await call('PUT', `/admin/flags/${key}`, { enabled });
  expect(res.status, res.detail).toBe(200);
}

describe('feature flags valem na API, não só na tela', () => {
  it('com `publicSignup` desligada o cadastro responde 403; ligada, cria a conta', async () => {
    await setFlag('publicSignup', false);
    as(null);
    const closed = await call('POST', '/auth/register', NEW_ACCOUNT);
    expect(closed.status).toBe(403);
    expect(closed.code).toBe('SIGNUP_CLOSED');

    await setFlag('publicSignup', true);
    as(null);
    expect((await call('POST', '/auth/register', NEW_ACCOUNT)).status).toBe(201);
  });

  it('com `resultSubmission` desligada o participante não envia resultado', async () => {
    await setFlag('resultSubmission', false);
    as(BIANCA);
    const mine = (await call<Match[]>('GET', '/tournaments/tn_liga_cr/matches?mine=1')).data.map((m) => Match.parse(m));
    const open = mine.find((m) => m.status === 'CHECK_IN') as Match;
    const [a, b] = open.participants;
    const res = await call('POST', `/matches/${open.id}/submissions`, {
      entries: [
        { registrationId: a?.registrationId, score: 2 },
        { registrationId: b?.registrationId, score: 1 },
      ],
      evidenceUrls: ['data:image/png;base64,AQID'],
    });
    expect(res.status).toBe(403);
  });

  it('só o Super Admin muda flag; a mudança aparece em /site/flags e na auditoria', async () => {
    as(ANA);
    expect((await call('PUT', '/admin/flags/ranking', { enabled: false })).status).toBe(403);
    await setFlag('ranking', false);
    as(null);
    expect((await call<Record<string, boolean>>('GET', '/site/flags')).data.ranking).toBe(false);
    expect(auditLogs().some((l) => l.action === 'FLAG_CHANGED')).toBe(true);
  });
});

describe('sessão e papéis', () => {
  it('CT-09: usuário suspenso ou banido perde a sessão na hora', async () => {
    as(BIANCA);
    expect((await call<{ nickname: string } | null>('GET', '/me')).data?.nickname).toBe('Bianca');

    as(ANA);
    expect((await call('POST', '/admin/users/u_bianca/sanctions', { type: 'SUSPENSION', reason: 'Conduta antidesportiva', days: 3 })).status).toBeLessThan(300);
    as(BIANCA);
    expect((await call('GET', '/me')).data).toBeNull();
    expect((await call('GET', '/me/registrations')).status).toBe(401);
    expect((await call('POST', '/auth/dev-login', { userId: 'u_bianca' })).status).toBe(403);
  });

  it('Admin sem verificação em duas etapas não usa nenhuma rota de administração', async () => {
    as(RAFAEL);
    expect((await call('POST', '/admin/users/u_p10/roles', { role: 'ADMIN' })).status).toBeLessThan(300);
    as('u_p10');
    const res = await call('GET', '/admin/users');
    expect(res.status).toBe(403);
    expect(res.code).toBe('TWO_FACTOR_REQUIRED');
    // O catálogo de jogos do Admin segue a mesma regra.
    expect((await call('PATCH', '/admin/games/g_freefire', { active: false })).code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('aceitar convite e cancelar campeonato ficam na auditoria', async () => {
    as('u_p12');
    expect((await call('POST', '/role-invites/convite-organizador-valido/accept')).status).toBe(200);
    expect(auditLogs().some((l) => l.action === 'INVITE_ACCEPTED' && l.actorId === 'u_p12')).toBe(true);

    as(CAMILA);
    expect((await call('POST', '/tournaments/tn_ff_solo/cancel', { reason: 'Data conflitou com outro evento' })).status).toBe(200);
    expect(auditLogs().some((l) => l.action === 'TOURNAMENT_STATUS_CHANGED' && l.entityId === 'tn_ff_solo' && l.reason === 'Data conflitou com outro evento')).toBe(true);
  });
});
