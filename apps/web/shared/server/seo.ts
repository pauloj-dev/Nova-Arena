/**
 * SEO das páginas públicas (issue #77): textos de descrição, URL canônica e dados estruturados (schema.org).
 */
import type { Tournament } from '@nova/schemas';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** HTML do organizador → texto curto para `description` (sem tags, sem espaços repetidos). */
export function plainText(html: string, max = 160): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });

export function tournamentDescription(t: Tournament): string {
  const when = t.startsAt ? `Começa em ${dateFmt.format(new Date(t.startsAt))} (horário de Brasília).` : '';
  const base = `${t.gameName} · ${t.modeName} · ${t.maxParticipants} vagas. ${when}`.trim();
  const about = plainText(t.description, 120);
  return about ? `${base} ${about}` : base;
}

const EVENT_STATUS: Partial<Record<Tournament['status'], string>> = {
  CANCELLED: 'https://schema.org/EventCancelled',
  PAUSED: 'https://schema.org/EventPostponed',
};

/** Dados estruturados de evento (Google): nome, datas, organizador, local online e status. */
export function tournamentJsonLd(t: Tournament): Record<string, unknown> {
  const url = `${SITE_URL}/c/${t.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: t.name,
    url,
    description: tournamentDescription(t),
    ...(t.startsAt ? { startDate: t.startsAt } : {}),
    eventStatus: EVENT_STATUS[t.status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    image: [`${url}/opengraph-image`],
    organizer: { '@type': 'Person', name: t.organizer.nickname, url: `${SITE_URL}/u/${encodeURIComponent(t.organizer.nickname)}` },
    sport: t.gameName,
    ...(t.free ? { isAccessibleForFree: true } : {}),
  };
}

/** JSON seguro dentro de `<script>`: o `<` vira escape para ninguém fechar a tag pelo texto. */
export function jsonLdScript(data: unknown): string {
  const backslash = String.fromCharCode(92);
  return JSON.stringify(data).replace(/</g, `${backslash}u003c`);
}
