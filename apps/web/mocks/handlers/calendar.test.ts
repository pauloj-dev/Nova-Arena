import { CalendarFeed } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { as, call, setupMockApi } from '../testing';
import { mockCalendarSignature } from './calendar';

setupMockApi();

const BIANCA = 'u_bianca';
const CAMILA = 'u_camila';
const LIGA = 'liga-semanal-clash-royale';
const DRAFT = 'torneio-relampago-cr-2v2';

async function ics(path: string) {
  const res = await fetch(`http://localhost:3000/api/v1${path}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}
const pathOf = (feed: CalendarFeed) => new URL(feed.url).pathname.replace(/^\/api\/v1/, '');

describe('calendário .ics na API simulada (mesmo contrato da real)', () => {
  it('minhas partidas: visitante 401; participante recebe o endereço assinado e o arquivo', async () => {
    as(null);
    expect((await call('GET', '/me/calendar')).status).toBe(401);
    as(BIANCA);
    const feed = CalendarFeed.parse((await call('GET', '/me/calendar')).data);
    expect(feed.url).toContain(`/calendar/u/${BIANCA}.${mockCalendarSignature(BIANCA)}.ics`);
    expect(feed.webcalUrl.startsWith('webcal://')).toBe(true);
    expect(feed.events).toBeGreaterThan(0);
    // O aplicativo de calendário busca sem sessão.
    as(null);
    const file = await ics(pathOf(feed));
    expect(file.status).toBe(200);
    expect(file.type).toContain('text/calendar');
    expect(file.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(file.text.match(/BEGIN:VEVENT/g)?.length).toBe(feed.events);
    expect(file.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it('assinatura errada: 404', async () => {
    expect((await ics(`/calendar/u/${BIANCA}.errada.ics`)).status).toBe(404);
    expect((await ics(`/calendar/u/${CAMILA}.${mockCalendarSignature(BIANCA)}.ics`)).status).toBe(404);
  });

  it('campeonato publicado é público; rascunho só para a organização e sem arquivo público', async () => {
    as(null);
    const feed = CalendarFeed.parse((await call('GET', `/tournaments/${LIGA}/calendar`)).data);
    expect(feed.url).toContain(`/calendar/t/${LIGA}.ics`);
    const file = await ics(pathOf(feed));
    expect(file.status).toBe(200);
    expect(file.text.match(/BEGIN:VEVENT/g)?.length ?? 0).toBe(feed.events);

    expect((await call('GET', `/tournaments/${DRAFT}/calendar`)).status).toBe(404);
    as(BIANCA);
    expect((await call('GET', `/tournaments/${DRAFT}/calendar`)).status).toBe(404);
    as(CAMILA);
    expect((await call('GET', `/tournaments/${DRAFT}/calendar`)).status).toBe(200);
    expect((await ics(`/calendar/t/${DRAFT}.ics`)).status).toBe(404);
  });
});
