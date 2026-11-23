/**
 * LGPD (#115) e antifraude (#114) na API simulada: os mesmos cenários dos testes de integração da API real
 * (`packages/api/test/privacy.integration.test.ts` e `fraud.integration.test.ts`).
 */
import { DataExportResponse, DeletionCheck, FraudAlert, FraudAlertPage, isDeletedNickname } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { auditLogs } from '../audit';
import { db } from '../db';
import { notifications } from '../notify';
import { DEMO_PASSWORD } from '../seed';
import { as, call, mutate, setupMockApi } from '../testing';

setupMockApi();

const RAFAEL = 'u_rafael';
const ANA = 'u_ana';
const BIANCA = 'u_bianca';
const PHRASE = 'EXCLUIR MINHA CONTA';
const user = (id: string) => db().users.find((u) => u.id === id);

describe('LGPD na API simulada', () => {
  it('exporta os dados da própria conta, sem a senha', async () => {
    as(BIANCA);
    const res = await call('POST', '/me/export');
    expect(res.status).toBe(200);
    const data = DataExportResponse.parse(res.data);
    if (!('format' in data)) throw new Error('esperava o arquivo na hora');
    expect(data.account).toMatchObject({ id: BIANCA, email: 'bianca@novaarena.gg' });
    expect(JSON.stringify(data)).not.toContain(DEMO_PASSWORD);
    as(null);
    expect((await call('POST', '/me/export')).status).toBe(401);
  });

  it('organizador com campeonato em andamento não exclui a conta', async () => {
    as('u_camila');
    const check = DeletionCheck.parse((await call('GET', '/me/deletion')).data);
    expect(check.canDelete).toBe(false);
    expect(check.blockers.map((b) => b.code)).toContain('OWNS_ACTIVE_TOURNAMENTS');
    expect((await call('DELETE', '/me', { password: DEMO_PASSWORD, confirmation: PHRASE })).code).toBe('OWNS_ACTIVE_TOURNAMENTS');
  });

  it('exclusão pede senha e frase, anonimiza a conta e encerra a sessão', async () => {
    // Bianca sem inscrição aberta: tira as inscrições dela de campeonatos ativos para o cenário.
    mutate((d) => {
      d.registrations = d.registrations.filter((r) => r.userId !== BIANCA && !r.members.some((m) => m.userId === BIANCA));
    });
    as(BIANCA);
    expect(DeletionCheck.parse((await call('GET', '/me/deletion')).data).canDelete).toBe(true);
    expect((await call('DELETE', '/me', { password: DEMO_PASSWORD, confirmation: 'sim' })).code).toBe('VALIDATION');
    expect((await call('DELETE', '/me', { password: 'errada', confirmation: PHRASE })).code).toBe('INVALID_PASSWORD');
    const res = await call('DELETE', '/me', { password: DEMO_PASSWORD, confirmation: PHRASE.toLowerCase() });
    expect(res.status).toBe(204);
    const after = user(BIANCA);
    expect(after?.status).toBe('DELETED');
    expect(isDeletedNickname(after?.nickname ?? '')).toBe(true);
    expect(after?.gameAccounts).toEqual([]);
    expect(notifications().filter((n) => n.userId === BIANCA)).toEqual([]);
    expect(auditLogs().some((l) => l.action === 'ACCOUNT_DELETED' && l.entityId === BIANCA)).toBe(true);
    // Sem sessão e sem perfil público.
    expect((await call('GET', '/me')).data).toBeNull();
    expect((await call('GET', '/users/Bianca')).status).toBe(404);
  });
});

describe('antifraude na API simulada', () => {
  it('lista os alertas de exemplo para o Admin; participante não acessa', async () => {
    as(ANA);
    const page = FraudAlertPage.parse((await call('GET', '/admin/fraud-alerts?status=OPEN')).data);
    expect(page.items.map((a) => a.kind).sort()).toEqual(['MULTI_ACCOUNT_DEVICE', 'MULTI_ACCOUNT_IP']);
    expect(page.openCount).toBe(2);
    as(BIANCA);
    expect((await call('GET', '/admin/fraud-alerts')).status).toBe(403);
  });

  it('dez banimentos em um minuto pelo mesmo Admin geram alerta só para o Super Admin e o avisam', async () => {
    as(ANA);
    for (let i = 1; i <= 10; i += 1) {
      const res = await call('POST', `/admin/users/u_p${String(i).padStart(2, '0')}/sanctions`, { type: 'BAN', reason: 'Contas usadas para manipular resultado' });
      expect(res.status, res.detail).toBe(201);
    }
    expect(FraudAlertPage.parse((await call('GET', '/admin/fraud-alerts?kind=MASS_ADMIN_ACTION')).data).total).toBe(0);
    as(RAFAEL);
    const page = FraudAlertPage.parse((await call('GET', '/admin/fraud-alerts?kind=MASS_ADMIN_ACTION')).data);
    expect(page.items[0]).toMatchObject({ kind: 'MASS_ADMIN_ACTION', summary: 'Ana fez 10 banimentos em 60 s.', actor: { id: ANA } });
    expect(notifications().some((n) => n.userId === RAFAEL && n.title === 'Alerta: ações administrativas em massa')).toBe(true);
    const review = await call('PATCH', `/admin/fraud-alerts/${page.items[0]?.id}`, { status: 'ACTIONED', resolution: 'Banimentos conferidos com a Ana.' });
    expect(FraudAlert.parse(review.data).status).toBe('ACTIONED');
    expect((await call('PATCH', `/admin/fraud-alerts/${page.items[0]?.id}`, { status: 'DISMISSED', resolution: 'De novo, sem efeito' })).code).toBe('ALERT_CLOSED');
  });

  it('o mesmo ID de jogo em duas contas vira alerta', async () => {
    mutate((d) => {
      const lucas = d.users.find((u) => u.id === 'u_lucas');
      const p01 = d.users.find((u) => u.id === 'u_p01');
      const id = p01?.gameAccounts.find((g) => g.gameId === 'g_freefire')?.fields.playerId ?? '';
      const ff = lucas?.gameAccounts.find((g) => g.gameId === 'g_freefire');
      if (ff) ff.fields.playerId = ` ${id} `;
    });
    as(ANA);
    const page = FraudAlertPage.parse((await call('GET', '/admin/fraud-alerts?kind=DUPLICATE_GAME_ID')).data);
    expect(page.items[0]?.users.map((u) => u.id).sort()).toEqual(['u_lucas', 'u_p01']);
  });
});
