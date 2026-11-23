/**
 * Calendário .ics (issue 125) contra um Postgres de verdade (`TEST_DATABASE_URL`): rotas × papéis, assinatura do
 * endereço pessoal, rascunho escondido do público e o arquivo no formato RFC 5545.
 */
import { CalendarFeed, Match } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { calendarSignature } from '../src/modules/calendar';
import { createHarness, SECRET, SERIES_RULES, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('calendário .ics (Postgres)', () => {
  let h: Harness;
  let slug = '';
  let tournamentId = '';
  let draftId = '';
  let draftSlug = '';
  let scheduled: Match;
  const at = new Date('2030-05-10T22:30:00.000Z');

  /** Busca o .ics como o aplicativo de calendário: sem cookie. */
  async function fetchIcs(path: string) {
    const res = await h.app.request(`/api/v1${path}`);
    return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', text: await res.text() };
  }
  const pathOf = (feed: CalendarFeed) => new URL(feed.url).pathname.replace(/^\/api\/v1/, '');

  beforeAll(async () => {
    h = await createHarness(url as string, 'cal');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('mod');
    await h.user('a');
    await h.user('b');
    await h.user('c');
    await h.user('d');
    await h.user('fora');
    await h.db.user.update({ where: { id: h.id('a') }, data: { timezone: 'America/Sao_Paulo' } });
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: cr, name: 'Liga do Calendário; edição, especial', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, seeding: 'RANKED' }] });
    tournamentId = t.id;
    slug = t.slug;
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    await h.register(t.id, [{ user: 'a' }, { user: 'b' }, { user: 'c' }, { user: 'd' }]);
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    const matches = z.array(Match).parse((await h.call('dono', `/tournaments/${t.id}/matches`)).data);
    const mine = matches.find((m) => m.round === 1 && m.participants.some((p) => p.name.startsWith('cala')));
    if (!mine) throw new Error('sem partida da jogadora a');
    expect((await h.call('dono', `/matches/${mine.id}`, { method: 'PATCH', body: { scheduledAt: at.toISOString() } })).status).toBe(200);
    scheduled = Match.parse((await h.call('dono', `/matches/${mine.id}`)).data);

    const draft = await h.tournament({ owner: 'dono', game: cr, status: 'DRAFT', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas' }] });
    draftId = draft.id;
    draftSlug = draft.slug;
  });

  afterAll(async () => {
    await h?.db.$disconnect();
  });

  it('GET /me/calendar: visitante 401; participante recebe endereço assinado (https e webcal)', async () => {
    expect((await h.call(null, '/me/calendar')).status).toBe(401);
    const res = await h.call('a', '/me/calendar');
    expect(res.status).toBe(200);
    const feed = CalendarFeed.parse(res.data);
    expect(feed.url).toContain(`/api/v1/calendar/u/${h.id('a')}.${calendarSignature(SECRET, h.id('a'))}.ics`);
    expect(feed.webcalUrl.startsWith('webcal://')).toBe(true);
    expect(feed.events).toBe(1);
    // Quem não está inscrito tem um calendário vazio, mas válido.
    expect(CalendarFeed.parse((await h.call('fora', '/me/calendar')).data).events).toBe(0);
  });

  it('o .ics pessoal tem a partida em UTC, com CRLF, dobra de linha e UID estável', async () => {
    const feed = CalendarFeed.parse((await h.call('a', '/me/calendar')).data);
    const first = await fetchIcs(pathOf(feed));
    expect(first.status).toBe(200);
    expect(first.type).toContain('text/calendar');
    expect(first.cache).toContain('private');
    const ics = first.text;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(ics).toContain('DTSTART:20300510T223000Z');
    // MD3 = 3 jogos de 10 min.
    expect(ics).toContain('DTEND:20300510T230000Z');
    expect(ics).toContain('X-WR-TIMEZONE:America/Sao_Paulo');
    expect(ics).toContain(`UID:partida-${scheduled.id}@novaarena.gg`);
    // Vírgula e ponto e vírgula do nome do campeonato saem escapados (a linha pode estar dobrada).
    expect(ics.replace(/\r\n /g, '')).toContain('Liga do Calendário\\; edição\\, especial');
    expect(ics).toContain('BEGIN:VALARM');
    // Reagendar mantém o UID: o aplicativo atualiza o evento em vez de duplicar.
    const later = new Date(at.getTime() + 3600_000);
    await h.call('dono', `/matches/${scheduled.id}`, { method: 'PATCH', body: { scheduledAt: later.toISOString() } });
    const second = (await fetchIcs(pathOf(feed))).text;
    expect(second).toContain(`UID:partida-${scheduled.id}@novaarena.gg`);
    expect(second).toContain('DTSTART:20300510T233000Z');
    await h.call('dono', `/matches/${scheduled.id}`, { method: 'PATCH', body: { scheduledAt: at.toISOString() } });
  });

  it('assinatura errada ou de outra pessoa: 404', async () => {
    const sig = calendarSignature(SECRET, h.id('a'));
    expect((await fetchIcs(`/calendar/u/${h.id('a')}.${sig}x.ics`)).status).toBe(404);
    expect((await fetchIcs(`/calendar/u/${h.id('b')}.${sig}.ics`)).status).toBe(404);
    expect((await fetchIcs(`/calendar/u/qualquer-coisa.ics`)).status).toBe(404);
  });

  it('GET /tournaments/:id/calendar: público para campeonato publicado (por id ou slug)', async () => {
    for (const who of [null, 'a', 'dono']) {
      const res = await h.call(who, `/tournaments/${tournamentId}/calendar`);
      expect(res.status, String(who)).toBe(200);
    }
    const feed = CalendarFeed.parse((await h.call(null, `/tournaments/${slug}/calendar`)).data);
    expect(feed.url).toContain(`/api/v1/calendar/t/${slug}.ics`);
    expect(feed.events).toBe(1);
    const ics = await fetchIcs(pathOf(feed));
    expect(ics.status).toBe(200);
    expect(ics.cache).toContain('public');
    expect(ics.text).toContain('DTSTART:20300510T223000Z');
  });

  it('rascunho: escondido do público; a organização vê o endereço, mas o arquivo público não existe', async () => {
    expect((await h.call(null, `/tournaments/${draftId}/calendar`)).status).toBe(404);
    expect((await h.call('a', `/tournaments/${draftId}/calendar`)).status).toBe(404);
    expect((await h.call('dono', `/tournaments/${draftId}/calendar`)).status).toBe(200);
    expect((await fetchIcs(`/calendar/t/${draftSlug}.ics`)).status).toBe(404);
    expect((await fetchIcs(`/calendar/t/nao-existe-${Date.now()}.ics`)).status).toBe(404);
  });
});
