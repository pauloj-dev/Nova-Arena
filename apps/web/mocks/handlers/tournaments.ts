/** Módulo `tournaments` da API simulada: leitura pública (lista, detalhe, inscritos, comunicados). */
import { http } from 'msw';
import { TournamentListQuery, type TournamentStatus } from '@nova/schemas';
import { db, type DbTournament } from '../db';
import { badRequest, currentUser, findTournament, handle, json, notFound, paginate, param, query, tournamentAccess, url } from '../http';
import { takenSlots, toRegistration, toTournament, toTournamentSummary } from '../views';

export const moduleName = 'tournaments';

const HIDDEN: TournamentStatus[] = ['DRAFT', 'ARCHIVED'];
const STATUS_GROUPS: Record<string, TournamentStatus[]> = {
  open: ['REGISTRATION_OPEN'],
  upcoming: ['PUBLISHED', 'REGISTRATION_CLOSED', 'CHECK_IN'],
  live: ['IN_PROGRESS', 'PAUSED'],
  finished: ['FINISHED'],
};
// Ordem da vitrine: o que dá para se inscrever agora vem primeiro.
const ORDER: TournamentStatus[] = ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CHECK_IN', 'PUBLISHED', 'REGISTRATION_CLOSED', 'PAUSED', 'FINISHED', 'CANCELLED'];

/** Rascunho só é visível para a organização do campeonato e para o Admin. */
function canSee(t: DbTournament): boolean {
  if (t.status !== 'DRAFT') return true;
  return tournamentAccess(currentUser(), t) !== null;
}

export const handlers = [
  http.get(
    url('/tournaments'),
    handle(({ request }) => {
      const parsed = TournamentListQuery.safeParse(Object.fromEntries(query(request)));
      if (!parsed.success) throw badRequest('Filtros inválidos.', 'VALIDATION');
      const f = parsed.data;
      const d = db();
      const text = f.q?.trim().toLowerCase();

      const items = d.tournaments
        .filter((t) => !HIDDEN.includes(t.status))
        .filter((t) => (f.status ? (STATUS_GROUPS[f.status] ?? []).includes(t.status) : t.status !== 'CANCELLED'))
        .filter((t) => !text || t.name.toLowerCase().includes(text))
        .filter((t) => !f.game || d.games.find((g) => g.id === t.gameId)?.slug === f.game)
        .filter((t) => !f.mode || t.participantType === f.mode)
        .filter((t) => !f.from || (t.startsAt !== null && t.startsAt.slice(0, 10) >= f.from))
        .filter((t) => !f.slots || (t.status === 'REGISTRATION_OPEN' && takenSlots(t.id) < t.maxParticipants))
        .filter((t) => !f.verified || d.users.find((u) => u.id === t.ownerId)?.verifiedOrganizer === true)
        .filter((t) => !f.featured || t.featured)
        .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(b.featured) - Number(a.featured) || (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
        .map(toTournamentSummary);

      return json(paginate(items, f.cursor ?? null, f.limit));
    }),
  ),

  http.get(
    url('/tournaments/:slug'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'slug'));
      if (!canSee(t)) throw notFound('Campeonato');
      return json(toTournament(t));
    }),
  ),

  /** Inscritos visíveis ao público: confirmados e aguardando. Lista de espera e recusados só para a organização. */
  http.get(
    url('/tournaments/:id/registrations'),
    handle(({ params, request }) => {
      const t = findTournament(param(params, 'id'));
      if (!canSee(t)) throw notFound('Campeonato');
      const staff = tournamentAccess(currentUser(), t) !== null;
      const scope = query(request).get('scope');
      const list = db()
        .registrations.filter((r) => r.tournamentId === t.id)
        .filter((r) => (staff && scope === 'all' ? true : ['CONFIRMED', 'PENDING_MEMBERS', 'PENDING_APPROVAL'].includes(r.status)))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toRegistration);
      return json(list);
    }),
  ),

  http.get(
    url('/tournaments/:id/announcements'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      if (!canSee(t)) throw notFound('Campeonato');
      const list = db()
        .announcements.filter((a) => a.tournamentId === t.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(list);
    }),
  ),

  /** Papel de quem está vendo neste campeonato (dono, co-organizador, moderador, admin) ou nulo. Usado para o link "Gerenciar campeonato". */
  http.get(
    url('/tournaments/:id/access'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      if (!canSee(t)) throw notFound('Campeonato');
      return json({ access: tournamentAccess(currentUser(), t) });
    }),
  ),
];
