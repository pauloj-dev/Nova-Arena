/**
 * Login com verificação em duas etapas na API simulada (issue #95): o protótipo segue a API real — a senha leva
 * ao passo do código e a sessão só abre em `/auth/2fa/verify`.
 */
import { LoginResult, Me, TwoFactorDevCode, TwoFactorEnabled, TwoFactorSetup } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { getSessionUserId } from '@/mocks/db';
import { DEMO_PASSWORD } from '@/mocks/seed';
import { as, call, setupMockApi } from '@/mocks/testing';
import { totp } from '@/features/profile/security/totp';

setupMockApi();

describe('login com 2FA (API simulada)', () => {
  it('Admin com 2FA: senha → passo do código (sem sessão) → código certo abre a sessão', async () => {
    as(null);
    const first = await call('POST', '/auth/login', { email: 'ana@novaarena.gg', password: DEMO_PASSWORD });
    expect(first.status).toBe(202);
    expect(LoginResult.parse(first.data)).toEqual({ twoFactorRequired: true });
    expect(getSessionUserId()).toBeNull();

    const wrong = await call('POST', '/auth/2fa/verify', { code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.code).toBe('INVALID_CODE');

    // O atalho do protótipo mostra o código também neste passo (ainda sem sessão).
    const dev = TwoFactorDevCode.parse((await call('GET', '/me/2fa/dev-code')).data);
    const ok = await call('POST', '/auth/2fa/verify', { code: dev.code });
    expect(ok.status).toBe(200);
    expect(Me.parse(ok.data).id).toBe('u_ana');
    expect(getSessionUserId()).toBe('u_ana');

    // O passo foi usado: repetir não abre outra sessão.
    as(null);
    expect((await call('POST', '/auth/2fa/verify', { code: dev.code })).code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('código de recuperação entra uma única vez', async () => {
    as('u_bianca');
    const setup = TwoFactorSetup.parse((await call('POST', '/me/2fa/setup')).data);
    const { recoveryCodes } = TwoFactorEnabled.parse((await call('POST', '/me/2fa/enable', { code: await totp(setup.secret) })).data);
    const recovery = recoveryCodes[0] ?? '';

    as(null);
    expect((await call('POST', '/auth/login', { email: 'bianca@novaarena.gg', password: DEMO_PASSWORD })).status).toBe(202);
    expect((await call('POST', '/auth/2fa/verify', { code: recovery })).status).toBe(200);

    as(null);
    expect((await call('POST', '/auth/login', { email: 'bianca@novaarena.gg', password: DEMO_PASSWORD })).status).toBe(202);
    expect((await call('POST', '/auth/2fa/verify', { code: recovery })).code).toBe('INVALID_CODE');
  });

  it('sem 2FA, a senha basta (como antes)', async () => {
    as(null);
    const res = await call('POST', '/auth/login', { email: 'lucas@novaarena.gg', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(Me.parse(res.data).id).toBe('u_lucas');
  });
});
