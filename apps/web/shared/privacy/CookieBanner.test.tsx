import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_KEY, reopenConsent } from './consent';
import { CookieBanner } from './CookieBanner';
import { consentInitScript } from './consent-init';

describe('aviso de cookies (issue #115)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('aparece para quem ainda não escolheu, com "só o necessário" primeiro, e some depois da escolha', async () => {
    render(<CookieBanner />);
    const region = screen.getByRole('region', { name: 'Cookies e medição de uso' });
    const buttons = region.querySelectorAll('button');
    expect([...buttons].map((b) => b.textContent)).toEqual(['Só o necessário', 'Aceitar medição']);
    await userEvent.click(screen.getByRole('button', { name: 'Só o necessário' }));
    expect(screen.queryByRole('region', { name: 'Cookies e medição de uso' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}')).toMatchObject({ version: 1, analytics: false });
  });

  it('não aparece de novo para quem já escolheu, mas volta pelo "mudar minha escolha"', async () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 1, analytics: false, decidedAt: '2026-11-21T10:00:00.000Z' }));
    render(<CookieBanner />);
    expect(screen.queryByRole('region', { name: 'Cookies e medição de uso' })).toBeNull();
    act(() => reopenConsent());
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar medição' }));
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}')).toMatchObject({ analytics: true });
  });

  it('o script do <head> marca <html data-consent> só para quem já escolheu (o CSS esconde o aviso do HTML)', () => {
    delete document.documentElement.dataset.consent;
    new Function(consentInitScript)();
    expect(document.documentElement.dataset.consent).toBeUndefined();
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 1, analytics: true, decidedAt: '2026-11-21T10:00:00.000Z' }));
    new Function(consentInitScript)();
    expect(document.documentElement.dataset.consent).toBe('1');
    act(() => reopenConsent());
    expect(document.documentElement.dataset.consent).toBeUndefined();
  });
});
