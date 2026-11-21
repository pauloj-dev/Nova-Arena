/**
 * Módulo `calendar` da API simulada: calendário .ics (issue 125). Mesmas rotas e contrato de
 * `packages/api/src/modules/calendar`, com o mesmo gerador (`buildIcs`).
 *
 * No protótipo a assinatura do endereço pessoal é um hash determinístico, sem segredo (não há servidor): serve só para
 * reproduzir o formato e o 404 de assinatura errada. O endereço também só funciona dentro do navegador (o MSW
 * responde); um aplicativo de calendário de verdade só consegue assinar com a API real.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { ACTIVE_REGISTRATION_STATUSES, buildIcs, matchToIcsEvent, type CalendarFeed, type IcsEvent } from '@nova/schemas';
import { listMatches } from '../competition';
import { db, type DbTournament } from '../db';
import { handle, json, notFound, param, requireUser, tournamentAccess, currentUser, url } from '../http';

export const moduleName = 'calendar';

const HIDDEN = ['DRAFT', 'CANCELLED'];

/** Hash FNV-1a de 64 bits em base 36: "assinatura" do protótipo (não é segredo). */
export function mockCalendarSignature(userId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of `calendar:${userId}`) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(36);
}

function siteUrl(request: Request): string {
  return new URL(request.url).origin;
}

function feed(request: Request, path: string, filename: string, events: number): CalendarFeed {
  const full = `${siteUrl(request)}/api/v1${path}`;
  return { url: full, webcalUrl: full.replace(/^https?:\/\//, 'webcal://'), filename, events };
}

function icsResponse(ics: string, filename: string, visibility: 'private' | 'public') {
  return new HttpResponse(ics, {
    status: 200,
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': `${visibility}, max-age=300` },
  });
}

function myEvents(request: Request, userId: string): IcsEvent[] {
  const active = ACTIVE_REGISTRATION_STATUSES as readonly string[];
  const regs = db().registrations.filter((r) => active.includes(r.status) && (r.userId === userId || r.members.some((m) => m.userId === userId)));
  const events: IcsEvent[] = [];
  for (const reg of regs) {
    const t = db().tournaments.find((x) => x.id === reg.tournamentId);
    if (!t || HIDDEN.includes(t.status)) continue;
    for (const m of listMatches(t.id)) {
      if (!m.participants.some((p) => p.registrationId === reg.id)) continue;
      const event = matchToIcsEvent(m, t, { siteUrl: siteUrl(request) });
      if (event) events.push(event);
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function tournamentEvents(request: Request, t: DbTournament): IcsEvent[] {
  return listMatches(t.id)
    .map((m) => matchToIcsEvent(m, t, { siteUrl: siteUrl(request) }))
    .filter((e): e is IcsEvent => e !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const handlers: HttpHandler[] = [
  http.get(
    url('/me/calendar'),
    handle(({ request }) => {
      const user = requireUser();
      const events = myEvents(request, user.id);
      return json(feed(request, `/calendar/u/${user.id}.${mockCalendarSignature(user.id)}.ics`, 'minhas-partidas-nova-arena.ics', events.length));
    }),
  ),

  http.get(
    url('/calendar/u/:file'),
    handle(({ params, request }) => {
      const match = /^(.+)\.([a-z0-9]+)\.ics$/i.exec(param(params, 'file'));
      const userId = match?.[1];
      const signature = match?.[2];
      if (!userId || !signature || signature !== mockCalendarSignature(userId)) throw notFound('Calendário');
      const user = db().users.find((u) => u.id === userId);
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Calendário');
      const ics = buildIcs({ name: 'Minhas partidas · Nova Arena', description: 'Suas partidas marcadas na Nova Arena.', timeZone: user.timezone, events: myEvents(request, user.id), now: new Date() });
      return icsResponse(ics, 'minhas-partidas-nova-arena.ics', 'private');
    }),
  ),

  http.get(
    url('/tournaments/:id/calendar'),
    handle(({ params, request }) => {
      const id = param(params, 'id');
      const t = db().tournaments.find((x) => x.id === id || x.slug === id);
      if (!t || (t.status === 'DRAFT' && !tournamentAccess(currentUser(), t))) throw notFound('Campeonato');
      return json(feed(request, `/calendar/t/${t.slug}.ics`, `${t.slug}.ics`, tournamentEvents(request, t).length));
    }),
  ),

  http.get(
    url('/calendar/t/:file'),
    handle(({ params, request }) => {
      const slug = param(params, 'file').replace(/\.ics$/i, '');
      const t = db().tournaments.find((x) => x.slug === slug);
      if (!t || t.status === 'DRAFT') throw notFound('Calendário');
      const ics = buildIcs({ name: `${t.name} · Nova Arena`, description: `Partidas de ${t.name} na Nova Arena.`, events: tournamentEvents(request, t), now: new Date() });
      return icsResponse(ics, `${t.slug}.ics`, 'public');
    }),
  ),
];
