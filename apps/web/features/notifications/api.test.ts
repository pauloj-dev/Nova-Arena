/** Regras de notificações aplicadas pela API simulada (PAR-10, RN-15). */
import { Notification, NotificationPreference, NOTIFICATION_TYPE_LABELS, page } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { followersOf } from '@/mocks/handlers/notifications';
import { notifications, notify } from '@/mocks/notify';
import { as, call, mutate, setupMockApi } from '@/mocks/testing';

setupMockApi();

const BIANCA = 'u_bianca';
const LUCAS = 'u_lucas';
const Page = page(Notification);
const Preferences = z.array(NotificationPreference);

const unread = async () => (await call<{ count: number }>('GET', '/notifications/unread-count')).data.count;
const list = async (qs = '') => Page.parse((await call('GET', `/notifications${qs}`)).data);

describe('notificações: lista, contador e leitura', () => {
  it('exige login', async () => {
    as(null);
    expect((await call('GET', '/notifications')).status).toBe(401);
    expect((await call('GET', '/notifications/unread-count')).status).toBe(401);
    expect((await call('POST', '/notifications/read-all')).status).toBe(401);
    expect((await call('GET', '/me/notification-preferences')).status).toBe(401);
  });

  it('semeia a demonstração uma única vez e conta as não lidas', async () => {
    as(BIANCA);
    expect(await unread()).toBe(3);
    const first = await list();
    expect(first.items).toHaveLength(6);
    expect(first.items.map((n) => n.createdAt)).toEqual([...first.items.map((n) => n.createdAt)].sort().reverse());
    // Ler de novo não duplica a demonstração.
    expect((await list()).total).toBe(6);
    expect(await unread()).toBe(3);
  });

  it('contador acompanha: nova notificação soma, ler uma subtrai, ler todas zera', async () => {
    as(BIANCA);
    const before = await unread();
    notify([BIANCA], 'RESULT_POSTED', 'Resultado lançado', 'Quartas · Liga CR', '/c/liga-semanal-clash-royale?aba=partidas');
    expect(await unread()).toBe(before + 1);

    const newest = (await list()).items[0] as Notification;
    expect(newest.title).toBe('Resultado lançado');
    expect(newest.readAt).toBeNull();
    const read = await call('POST', `/notifications/${newest.id}/read`);
    expect(read.status).toBe(200);
    expect(Notification.parse(read.data).readAt).not.toBeNull();
    expect(await unread()).toBe(before);

    expect((await call<{ count: number }>('POST', '/notifications/read-all')).data.count).toBe(0);
    expect(await unread()).toBe(0);
    expect((await list('?unread=1')).items).toEqual([]);
  });

  it('filtro "não lidas" e paginação por cursor, mais recentes primeiro', async () => {
    as(BIANCA);
    await list(); // garante a demonstração antes das novas
    for (let i = 1; i <= 12; i += 1) notify([BIANCA], 'ANNOUNCEMENT', `Comunicado ${i}`, 'Texto', null);
    const first = await list();
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(18);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`?cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(8);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((n) => n.id);
    expect(new Set(ids).size).toBe(18);

    const onlyUnread = await list('?unread=1&limit=50');
    expect(onlyUnread.items).toHaveLength(15);
    expect(onlyUnread.items.every((n) => n.readAt === null)).toBe(true);
  });

  it('só o dono vê e lê as próprias notificações', async () => {
    as(BIANCA);
    const hers = (await list()).items.map((n) => n.id);
    as(LUCAS);
    const his = (await list()).items.map((n) => n.id);
    expect(his.length).toBeGreaterThan(0);
    expect(his.some((id) => hers.includes(id))).toBe(false);

    const res = await call('POST', `/notifications/${hers[0]}/read`);
    expect(res.status).toBe(404);
    // "Marcar todas" do Lucas não toca nas da Bianca.
    await call('POST', '/notifications/read-all');
    as(BIANCA);
    expect(await unread()).toBe(3);
  });
});

describe('preferências', () => {
  it('uma linha por tipo, tudo ligado por padrão', async () => {
    as(BIANCA);
    const prefs = Preferences.parse((await call('GET', '/me/notification-preferences')).data);
    expect(prefs.map((p) => p.type)).toEqual(Object.keys(NOTIFICATION_TYPE_LABELS));
    expect(prefs.every((p) => p.inApp && p.email)).toBe(true);
  });

  it('preferência desligada não gera notificação no site', async () => {
    as(BIANCA);
    const before = await unread();
    const total = (await list()).total;
    const saved = await call('PUT', '/me/notification-preferences', {
      preferences: [
        { type: 'RESULT_POSTED', inApp: false, email: true },
        { type: 'ANNOUNCEMENT', inApp: false, email: false },
      ],
    });
    expect(saved.status).toBe(200);
    const prefs = Preferences.parse(saved.data);
    expect(prefs.find((p) => p.type === 'RESULT_POSTED')).toEqual({ type: 'RESULT_POSTED', inApp: false, email: true });
    expect(prefs.find((p) => p.type === 'ANNOUNCEMENT')).toEqual({ type: 'ANNOUNCEMENT', inApp: false, email: false });

    notify([BIANCA], 'RESULT_POSTED', 'Resultado lançado', 'Só por e-mail', null);
    notify([BIANCA], 'ANNOUNCEMENT', 'Comunicado', 'Nenhum canal', null);
    expect(await unread()).toBe(before);
    const after = await list();
    expect(after.total).toBe(total);
    expect(after.items.some((n) => n.title === 'Resultado lançado' || n.title === 'Comunicado')).toBe(false);
    // O e-mail continua registrado para o tipo que só desligou "no site".
    expect(notifications().filter((n) => n.userId === BIANCA && n.title === 'Resultado lançado' && n.emailQueued)).toHaveLength(1);
    expect(notifications().some((n) => n.userId === BIANCA && n.title === 'Comunicado')).toBe(false);

    // Outro tipo continua chegando; e religar volta a notificar.
    notify([BIANCA], 'CHECKIN_OPEN', 'Check-in aberto', 'Sua partida', null);
    expect(await unread()).toBe(before + 1);
    await call('PUT', '/me/notification-preferences', { preferences: [{ type: 'RESULT_POSTED', inApp: true, email: true }] });
    notify([BIANCA], 'RESULT_POSTED', 'Resultado corrigido', 'No site de novo', null);
    expect(await unread()).toBe(before + 2);
  });

  it('SANCTION não pode ser desligado', async () => {
    as(BIANCA);
    const before = await unread();
    for (const pref of [
      { type: 'SANCTION', inApp: false, email: true },
      { type: 'SANCTION', inApp: true, email: false },
    ]) {
      const res = await call('PUT', '/me/notification-preferences', { preferences: [pref] });
      expect(res.status).toBe(400);
      expect(res.code).toBe('SANCTION_ALWAYS_ON');
    }
    const prefs = Preferences.parse((await call('GET', '/me/notification-preferences')).data);
    expect(prefs.find((p) => p.type === 'SANCTION')).toEqual({ type: 'SANCTION', inApp: true, email: true });
    notify([BIANCA], 'SANCTION', 'Advertência', 'Linguagem ofensiva no chat.', null);
    expect(await unread()).toBe(before + 1);
  });

  it('valida o corpo', async () => {
    as(BIANCA);
    expect((await call('PUT', '/me/notification-preferences', { preferences: [{ type: 'NAO_EXISTE', inApp: true, email: true }] })).code).toBe('VALIDATION');
  });
});

describe('seguir (RN-15)', () => {
  it('followersOf devolve quem segue o campeonato ou o jogo, sem repetir', async () => {
    expect(followersOf('GAME', 'g_8ball')).toEqual([BIANCA]);
    expect(followersOf('TOURNAMENT', 'tn_copa_ff')).toEqual([]);
    as(LUCAS);
    expect((await call('PUT', '/me/follows/tournament/tn_copa_ff')).status).toBe(200);
    mutate((d) => d.follows.push({ userId: LUCAS, targetType: 'TOURNAMENT', targetId: 'tn_copa_ff' }, { userId: BIANCA, targetType: 'TOURNAMENT', targetId: 'tn_copa_ff' }));
    expect(followersOf('TOURNAMENT', 'tn_copa_ff').sort()).toEqual([BIANCA, LUCAS].sort());
    expect(followersOf('TOURNAMENT', 'tn_liga_cr')).toEqual([]);
  });
});
