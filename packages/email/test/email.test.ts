import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createMailer, EMAIL_THEME, renderEmail, THEME_SOURCE, type EmailMessage } from '../src';

describe('cores da identidade Nova Green', () => {
  it('são as mesmas do tema claro do design system (tokens.css)', () => {
    const css = readFileSync(fileURLToPath(new URL('../../ui/src/styles/tokens.css', import.meta.url)), 'utf8');
    for (const [key, variable] of Object.entries(THEME_SOURCE)) {
      // Primeira ocorrência = tema claro (o escuro vem depois, em outro seletor).
      const match = new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(match?.[1]?.toLowerCase(), `${key} (${variable})`).toBe(EMAIL_THEME[key as keyof typeof EMAIL_THEME]);
    }
  });
});

const LINK = 'https://novaarena.gg/verificar-email?token=abc123';
const cases: [EmailMessage, string, string][] = [
  [{ template: 'VERIFY_EMAIL', data: { nickname: 'Bianca', link: LINK } }, 'Confirme seu e-mail na Nova Arena', 'Bem-vindo à Nova Arena, Bianca!'],
  [{ template: 'RESET_PASSWORD', data: { nickname: 'Bianca', link: LINK } }, 'Redefinir sua senha da Nova Arena', 'Oi, Bianca'],
  [{ template: 'ROLE_INVITE', data: { role: 'ORGANIZER', inviter: 'Ana', link: LINK, expiresAt: '20/11/2026' } }, 'Você foi convidado para ser Organizador na Nova Arena', 'Convite para Organizador'],
  [{ template: 'TEAM_INVITE', data: { team: 'Squad Alfa', captain: 'Lucas', link: LINK } }, 'Convite para o squad Squad Alfa', 'Você foi chamado para o Squad Alfa'],
  [{ template: 'CONFIRM_EMAIL_CHANGE', data: { nickname: 'Bianca', link: LINK } }, 'Confirme seu novo e-mail na Nova Arena', 'Oi, Bianca'],
  [{ template: 'EMAIL_CHANGED', data: { nickname: 'Bianca', newEmail: 'nova@exemplo.com', link: LINK } }, 'O e-mail da sua conta na Nova Arena mudou', 'Oi, Bianca'],
  [{ template: 'PASSWORD_CHANGED', data: { nickname: 'Bianca', link: LINK } }, 'Sua senha da Nova Arena foi trocada', 'Oi, Bianca'],
];

describe('templates', () => {
  it.each(cases)('%# %s: assunto, título e o link no HTML e no texto puro', async (message, subject, heading) => {
    const email = await renderEmail(message);
    expect(email.subject).toBe(subject);
    expect(email.html).toContain('lang="pt-BR"');
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.text).toContain(LINK);
    expect(email.text).toContain('NOVA ARENA');
    expect(email.text.toUpperCase()).toContain(heading.toUpperCase());
    // Botão com a cor da marca, em estilo em linha (cliente de e-mail não lê CSS externo).
    expect(email.html).toContain(EMAIL_THEME.primary);
  });
});

const message: EmailMessage = { template: 'VERIFY_EMAIL', data: { nickname: 'Bianca', link: LINK } };
const okFetch = () => vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));

describe('envio', () => {
  it('produção sem RESEND_API_KEY ou EMAIL_FROM: erro de configuração', () => {
    expect(() => createMailer({ production: true, log: () => {} })).toThrow(/RESEND_API_KEY e EMAIL_FROM/);
  });

  it('produção: envia pelo Resend para o destinatário, com chave de idempotência', async () => {
    const fetch = okFetch();
    const mailer = createMailer({ production: true, apiKey: 're_123', from: 'Nova Arena <nao-responda@novaarena.gg>', fetch, log: () => {} });
    expect(mailer.mode).toBe('resend');
    await mailer.send('bianca@exemplo.com', message, { idempotencyKey: 'notif-42' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_123', 'Idempotency-Key': 'notif-42' });
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'Nova Arena <nao-responda@novaarena.gg>', to: ['bianca@exemplo.com'], subject: 'Confirme seu e-mail na Nova Arena' });
  });

  it('Resend recusou: erro com o status (o job tenta de novo)', async () => {
    const mailer = createMailer({ production: true, apiKey: 're_123', from: 'x@novaarena.gg', fetch: vi.fn(async () => new Response('', { status: 422 })), log: () => {} });
    await expect(mailer.send('a@b.com', message)).rejects.toMatchObject({ name: 'EmailError', status: 422 });
  });

  it('preview com caixa de teste: tudo vai para ela, com o destinatário original no assunto', async () => {
    const fetch = okFetch();
    const mailer = createMailer({ production: false, apiKey: 're_123', testInbox: 'testes@novaarena.gg', fetch, log: () => {} });
    expect(mailer.mode).toBe('test-inbox');
    await mailer.send('bianca@exemplo.com', message);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { to: string[]; subject: string };
    expect(body.to).toEqual(['testes@novaarena.gg']);
    expect(body.subject).toBe('[teste para bianca@exemplo.com] Confirme seu e-mail na Nova Arena');
  });

  it('sem Resend fora de produção: só registra no log, sem o link', async () => {
    const log = vi.fn();
    const mailer = createMailer({ production: false, log });
    expect(mailer.mode).toBe('log');
    await mailer.send('bianca@exemplo.com', message);
    expect(log).toHaveBeenCalledWith(expect.any(String), { template: 'VERIFY_EMAIL', toDomain: 'exemplo.com' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('abc123');
  });
});

describe('avisos por e-mail (notificações, issue #98)', () => {
  const TYPES = ['REGISTRATION_CONFIRMED', 'TEAM_INVITE', 'CHECKIN_OPEN', 'MATCH_SOON', 'RESULT_POSTED', 'QUALIFIED', 'ELIMINATED', 'ANNOUNCEMENT', 'ORGANIZER_REQUEST_RESULT', 'DISPUTE_UPDATE', 'SANCTION'];
  const PREFS = 'https://novaarena.gg/minha-conta/notificacoes';

  it.each(TYPES)('%s: assunto com o tipo e o título, texto, botão para o link e como parar de receber', async (type) => {
    const email = await renderEmail({ template: 'NOTIFICATION', data: { type, nickname: 'Bianca', title: 'Check-in aberto', body: 'Sua partida começa em breve.', link: LINK, preferencesLink: PREFS } });
    expect(email.subject).toMatch(/: Check-in aberto$/);
    expect(email.subject).not.toMatch(/^Aviso:/);
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.html).toContain(`href="${PREFS}"`);
    expect(email.text).toContain('Sua partida começa em breve.');
    expect(email.text).toContain('Oi, Bianca!');
    // O "se não foi você" é para e-mails de conta; aviso diz como parar de receber.
    expect(email.text).not.toContain('Se não foi você');
  });

  it('aviso da moderação diz que não pode ser desligado', async () => {
    const email = await renderEmail({ template: 'NOTIFICATION', data: { type: 'SANCTION', nickname: 'Bianca', title: 'Advertência', body: 'Linguagem ofensiva.', link: LINK, preferencesLink: PREFS } });
    expect(email.subject).toBe('Aviso da moderação: Advertência');
    expect(email.text).toContain('Avisos da moderação são sempre enviados.');
  });
});
