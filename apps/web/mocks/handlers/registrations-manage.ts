/**
 * Módulo `registrations-manage` da API simulada: gestão de inscrições pelo organizador (issue #30).
 * Aprovar, recusar, remover e substituir; importar e exportar CSV. Permissões do PRD §6:
 * aprovar e recusar também é do moderador; remover, substituir e importar é da organização.
 *
 * RN-18: inscrito avulso (`/registrations/manual`) e elenco sem conta (`/registrations/:id/guests`), espelho de
 * `packages/api/src/modules/registrations/guests.ts`.
 */
import { http, HttpResponse } from 'msw';
import {
  canStaffEditRoster,
  GuestMemberInput,
  guestKey,
  guestRosterProblem,
  ImportRegistrationsInput,
  ManualRegistrationInput,
  ReviewRegistrationInput,
  SLOT_HOLDING_STATUSES,
  UpdateGuestMemberInput,
  type ImportRegistrationsResult,
  type Registration,
  type RegistrationStatus,
  type ReviewRegistrationResult,
  type RosterChangeResult,
  type TournamentStatus,
} from '@nova/schemas';
import { registrationsToCsv } from '@/features/organizer/lib/csv';
import { promoteFromWaitlist, promotionFor, type WaitlistContext, type WaitlistRegistration } from '@/features/organizer/lib/waitlist';
import { audit } from '../audit';
import { collection, db, nowIso, save, uid, type DbRegistration, type DbRegistrationGuest, type DbTournament } from '../db';
import { badRequest, body, conflict, findTournament, forbidden, handle, HttpProblem, json, notFound, param, requireTournamentAccess, url } from '../http';
import { takenSlots, toRegistration, toStaffRegistration } from '../views';
import { notifyConfirmed } from '../roster';
import { settleWaitlist } from '../waitlist';

export const moduleName = 'registrations-manage';

/** Antes de a fase 1 começar: ainda dá para aprovar, recusar, substituir e importar. */
const BEFORE_START: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const STARTED: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED'];
const ACTIVE: RegistrationStatus[] = [...SLOT_HOLDING_STATUSES, 'WAITLIST'];

/** Contato e ID de jogo das inscrições importadas (o registro da inscrição só guarda nome e tag). */
interface ImportedInfo {
  registrationId: string;
  contact: string | null;
  gameId: string | null;
}
const importedInfo = () => collection<ImportedInfo>('registrationImports');

function requiredMembers(t: DbTournament): number {
  return db().games.find((g) => g.id === t.gameId)?.modes.find((m) => m.id === t.gameModeId)?.teamSize ?? 1;
}

function waitlistContext(t: DbTournament): Omit<WaitlistContext, 'maxParticipants'> & { maxParticipants: number } {
  return { maxParticipants: t.maxParticipants, manualApproval: t.manualApproval, requiredMembers: requiredMembers(t), registrationClosesAt: t.registrationClosesAt, now: new Date() };
}

function toWaitlistRegistration(r: DbRegistration): WaitlistRegistration {
  return { id: r.id, status: r.status, createdAt: r.createdAt, isTeam: r.teamId !== null, confirmedMembers: r.members.filter((m) => m.confirmedAt !== null).length };
}

/** RN-12: preenche as vagas livres com a lista de espera, na ordem de entrada. Devolve quem subiu. */
function promoteWaitlist(t: DbTournament): DbRegistration[] {
  if (!BEFORE_START.includes(t.status)) return [];
  const all = db().registrations.filter((r) => r.tournamentId === t.id);
  const promoted: DbRegistration[] = [];
  for (const change of promoteFromWaitlist(all.map(toWaitlistRegistration), waitlistContext(t))) {
    const r = all.find((x) => x.id === change.id);
    if (!r) continue;
    r.status = change.status;
    r.reservedUntil = change.reservedUntil;
    r.statusReason = null;
    promoted.push(r);
  }
  return promoted;
}

function displayName(r: DbRegistration): string {
  return toRegistration(r).displayName;
}

// ── Elenco sem conta (RN-18) ─────────────────────────────────────────
type GuestRow = Omit<DbRegistrationGuest, 'id'>;

function modeSize(t: DbTournament): { teamSize: number; maxSubs: number } {
  const mode = db().games.find((g) => g.id === t.gameId)?.modes.find((m) => m.id === t.gameModeId);
  return { teamSize: mode?.teamSize ?? 1, maxSubs: mode?.maxSubs ?? 0 };
}

function normalizeGuests(members: GuestMemberInput[] | undefined): GuestRow[] {
  return (members ?? []).map((m) => ({ name: m.name.trim(), gameId: m.gameId?.trim() || null, isSub: m.isSub ?? false }));
}

/** Outro squad ativo do campeonato que já tem um destes IDs no jogo. */
function takenGameIdProblem(t: DbTournament, guests: GuestRow[], exceptRegistrationId?: string): string | null {
  const ids = new Set(guests.flatMap((g) => (g.gameId ? [guestKey(g.gameId)] : [])));
  if (ids.size === 0) return null;
  for (const r of db().registrations) {
    if (r.tournamentId !== t.id || r.id === exceptRegistrationId || !ACTIVE.includes(r.status)) continue;
    const taken = (r.guests ?? []).find((g) => g.gameId !== null && ids.has(guestKey(g.gameId)));
    if (taken) return `O ID no jogo "${taken.gameId ?? ''}" já está no elenco do ${displayName(r)} neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.`;
  }
  return null;
}

/** O elenco inteiro de uma inscrição criada pela organização: modo, repetidos e o mesmo ID em outro squad. */
function guestsProblem(t: DbTournament, guests: GuestRow[], exceptRegistrationId?: string): string | null {
  if (guests.length === 0) return null;
  if (t.participantType !== 'TEAM') return 'Este campeonato é individual: o inscrito não tem elenco.';
  return guestRosterProblem(guests, modeSize(t)) ?? takenGameIdProblem(t, guests, exceptRegistrationId);
}

function createStaffRegistration(t: DbTournament, row: { name: string; tag?: string | undefined; contact?: string | undefined; gameId?: string | undefined }, guests: GuestRow[], opts: { status: RegistrationStatus; createdAt: string }): DbRegistration {
  const registration: DbRegistration = {
    id: uid('r'),
    tournamentId: t.id,
    userId: null,
    teamId: null,
    importedName: row.name.trim(),
    importedTag: row.tag?.trim() ? row.tag.trim().toUpperCase() : null,
    status: opts.status,
    seed: null,
    statusReason: null,
    members: [],
    guests: guests.map((g) => ({ id: uid('rg'), ...g })),
    reservedUntil: null,
    createdAt: opts.createdAt,
  };
  db().registrations.push(registration);
  if (row.contact?.trim() || row.gameId?.trim()) {
    importedInfo().push({ registrationId: registration.id, contact: row.contact?.trim() || null, gameId: row.gameId?.trim() || null });
  }
  return registration;
}

/** A inscrição com o elenco que a organização ainda pode mudar (moderador não mexe no elenco). */
function staffRoster(registrationId: string) {
  const r = db().registrations.find((x) => x.id === registrationId);
  if (!r) throw notFound('Inscrição');
  const t = findTournament(r.tournamentId);
  const { user } = requireTournamentAccess(t);
  if (r.userId || r.teamId) throw conflict('Esta inscrição é de quem tem conta na plataforma: o elenco dela é escalado pelo apelido dos jogadores.', 'NOT_STAFF_REGISTRATION');
  if (t.participantType !== 'TEAM') throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
  if (!ACTIVE.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (!canStaffEditRoster(t.status)) throw conflict('Este campeonato já terminou: o elenco não muda mais.', 'ROSTER_CLOSED');
  r.guests ??= [];
  return { r, t, user, guests: r.guests };
}

function rosterChanged(r: DbRegistration, t: DbTournament, status = 200) {
  t.updatedAt = nowIso();
  save();
  const result: RosterChangeResult = { registrations: [toStaffRegistration(r)] };
  return json(result, status);
}

export const handlers = [
  http.patch(
    url('/registrations/:id'),
    handle(async ({ request, params }) => {
      const r = db().registrations.find((x) => x.id === param(params, 'id'));
      if (!r) throw notFound('Inscrição');
      const t = findTournament(r.tournamentId);
      const { access } = requireTournamentAccess(t, { allowModerator: true });
      const input = await body(request, ReviewRegistrationInput);
      // RN-12: reserva vencida volta para a fila antes de qualquer decisão (inclusive as promoções feitas aqui).
      settleWaitlist(t);
      if ((input.action === 'remove' || input.action === 'replace') && access === 'MODERATOR') {
        throw forbidden('Moderadores aprovam e recusam inscrições. Remover ou substituir um inscrito é com a organização.');
      }

      const started = STARTED.includes(t.status);
      if (!started && !BEFORE_START.includes(t.status)) throw conflict('As inscrições deste campeonato não podem mais ser alteradas.', 'REGISTRATIONS_LOCKED');
      // RN-06: com a fase em andamento não há substituição nem remoção simples. A saída é desistência ou
      // desclassificação (`POST /registrations/:id/withdraw`), que também acerta a chave e a tabela.
      if (started) {
        throw conflict(
          input.action === 'replace'
            ? 'Com a fase em andamento não dá mais para substituir um inscrito. A substituição vale até a chave ser confirmada.'
            : input.action === 'remove'
              ? 'Com o campeonato em andamento, registre a desistência ou a desclassificação do inscrito (com motivo).'
              : 'Com o campeonato em andamento as inscrições não são mais aprovadas nem recusadas.',
          'TOURNAMENT_STARTED',
        );
      }

      switch (input.action) {
        case 'approve': {
          if (r.status !== 'PENDING_APPROVAL') throw conflict('Só inscrições aguardando aprovação podem ser aprovadas.', 'INVALID_REGISTRATION_STATUS');
          r.status = 'CONFIRMED';
          r.statusReason = null;
          break;
        }
        case 'reject': {
          if (r.status !== 'PENDING_APPROVAL' && r.status !== 'PENDING_MEMBERS' && r.status !== 'WAITLIST') {
            throw conflict('Esta inscrição já foi decidida. Para tirar um inscrito confirmado, use "Remover".', 'INVALID_REGISTRATION_STATUS');
          }
          r.status = 'REJECTED';
          r.statusReason = input.reason;
          r.reservedUntil = null;
          break;
        }
        case 'remove': {
          if (!ACTIVE.includes(r.status)) throw conflict('Esta inscrição já não está ativa.', 'INVALID_REGISTRATION_STATUS');
          r.status = 'CANCELLED';
          r.statusReason = input.reason;
          r.reservedUntil = null;
          break;
        }
        case 'replace': {
          if (!SLOT_HOLDING_STATUSES.includes(r.status)) throw conflict('Só dá para substituir quem está ocupando uma vaga.', 'INVALID_REGISTRATION_STATUS');
          const substitute = db().registrations.find((x) => x.id === input.withRegistrationId && x.tournamentId === t.id);
          if (!substitute || substitute.status !== 'WAITLIST') throw conflict('O substituto precisa estar na lista de espera deste campeonato.', 'SUBSTITUTE_NOT_IN_WAITLIST');
          // A escolha foi da organização: entra direto. Squad incompleto ganha o prazo para completar,
          // a não ser que as inscrições já tenham fechado (RN-12): aí ele não tem como completar.
          const next = promotionFor(toWaitlistRegistration(substitute), { ...waitlistContext(t), manualApproval: false });
          if (!next) throw conflict('Este squad está incompleto e as inscrições já fecharam: ele não teria como completar o elenco. Escolha outro da lista de espera.', 'SUBSTITUTE_INCOMPLETE');
          substitute.status = next.status;
          substitute.reservedUntil = next.reservedUntil;
          substitute.statusReason = null;
          substitute.seed = r.seed;
          r.status = 'CANCELLED';
          r.statusReason = `Substituída por ${displayName(substitute)}.`;
          r.reservedUntil = null;
          r.seed = null;
          break;
        }
      }

      const promoted = input.action === 'approve' ? [] : promoteWaitlist(t);
      save();
      // Aprovada, substituta que entrou e quem subiu da fila: "Inscrição confirmada" (só quem ficou confirmado).
      const substitute = input.action === 'replace' ? db().registrations.find((x) => x.id === input.withRegistrationId) : undefined;
      notifyConfirmed([...promoted, ...(input.action === 'approve' ? [r] : []), ...(substitute ? [substitute] : [])]);
      const result: ReviewRegistrationResult = { registration: toRegistration(r), promoted: promoted.map(toRegistration) };
      return json(result);
    }),
  ),

  /** Inscritos sem conta na plataforma, vindos de uma planilha. O excedente vai para a lista de espera. */
  http.post(
    url('/tournaments/:id/registrations/import'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      requireTournamentAccess(t);
      const { rows } = await body(request, ImportRegistrationsInput);
      settleWaitlist(t);
      if (!BEFORE_START.includes(t.status)) {
        throw conflict(t.status === 'DRAFT' ? 'Publique o campeonato antes de importar inscritos.' : 'Só dá para importar inscritos antes de o campeonato começar.', 'REGISTRATIONS_LOCKED');
      }

      const names = new Set(
        db().registrations.filter((r) => r.tournamentId === t.id && ACTIVE.includes(r.status)).map((r) => displayName(r).trim().toLowerCase()),
      );
      const result: ImportRegistrationsResult = { created: 0, waitlisted: 0, skipped: [] };
      let taken = takenSlots(t.id);
      const base = Date.now();

      rows.forEach((row, index) => {
        const line = index + 1;
        const name = row.name.trim();
        const key = name.toLowerCase();
        if (name === '') {
          result.skipped.push({ row: line, reason: 'Falta o nome.' });
          return;
        }
        if (names.has(key)) {
          result.skipped.push({ row: line, reason: `Já existe um inscrito chamado "${name}" neste campeonato.` });
          return;
        }
        const hasSlot = taken < t.maxParticipants;
        if (!hasSlot && !t.waitlistEnabled) {
          result.skipped.push({ row: line, reason: 'As vagas acabaram e a lista de espera está desligada.' });
          return;
        }
        // Elenco da linha (RN-18): fora do modo, repetido ou com ID que já joga por outro squad, a linha fica de fora.
        const roster = normalizeGuests(row.members);
        const rosterProblem = guestsProblem(t, roster);
        if (rosterProblem) {
          result.skipped.push({ row: line, reason: rosterProblem });
          return;
        }
        // Um milissegundo por linha preserva a ordem do arquivo na lista de espera.
        createStaffRegistration(t, { ...row, name }, roster, { status: hasSlot ? 'CONFIRMED' : 'WAITLIST', createdAt: new Date(base + index).toISOString() });
        names.add(key);
        if (hasSlot) {
          taken += 1;
          result.created += 1;
        } else {
          result.waitlisted += 1;
        }
      });

      if (result.created + result.waitlisted > 0) t.updatedAt = nowIso();
      save();
      return json(result);
    }),
  ),

  /** Inscrito avulso (RN-18): um jogador ou squad sem conta, com as regras da importação. */
  http.post(
    url('/tournaments/:id/registrations/manual'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user } = requireTournamentAccess(t);
      const input = await body(request, ManualRegistrationInput);
      if (!BEFORE_START.includes(t.status)) {
        throw conflict(t.status === 'DRAFT' ? 'Publique o campeonato antes de adicionar inscritos.' : 'Só dá para adicionar inscritos antes de o campeonato começar.', 'REGISTRATIONS_LOCKED');
      }
      settleWaitlist(t);
      const taken = db().registrations.some((r) => r.tournamentId === t.id && ACTIVE.includes(r.status) && guestKey(displayName(r)) === guestKey(input.name));
      if (taken) {
        const message = `Já existe um inscrito chamado "${input.name}" neste campeonato.`;
        throw new HttpProblem(409, message, 'NAME_TAKEN', { name: message });
      }
      const roster = normalizeGuests(input.members);
      const problem = guestsProblem(t, roster);
      if (problem) throw badRequest(problem, 'INVALID_ROSTER', { members: problem });
      const hasSlot = takenSlots(t.id) < t.maxParticipants;
      if (!hasSlot && !t.waitlistEnabled) throw conflict('As vagas acabaram e a lista de espera está desligada.', 'TOURNAMENT_FULL');
      const status: RegistrationStatus = hasSlot ? 'CONFIRMED' : 'WAITLIST';
      const registration = createStaffRegistration(t, input, roster, { status, createdAt: nowIso() });
      t.updatedAt = nowIso();
      audit(user, { action: 'REGISTRATION_ADDED', entityType: 'Registration', entityId: registration.id, entityLabel: `${t.name} · ${input.name}`, tournamentId: t.id, after: { status, jogadores: roster.length } });
      save();
      return json(toStaffRegistration(registration), 201);
    }),
  ),

  /** Elenco sem conta (RN-18): colocar um jogador. */
  http.post(
    url('/registrations/:id/guests'),
    handle(async ({ request, params }) => {
      const { r, t, user, guests } = staffRoster(param(params, 'id'));
      const [guest] = normalizeGuests([await body(request, GuestMemberInput)]) as [GuestRow];
      const problem = guestRosterProblem([...guests, guest], modeSize(t)) ?? guestsProblem(t, [guest], r.id);
      if (problem) throw new HttpProblem(409, problem, 'INVALID_ROSTER', { name: problem });
      guests.push({ id: uid('rg'), ...guest });
      audit(user, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${displayName(r)}`, tournamentId: t.id, after: { escalou: guest.name, semConta: true } });
      return rosterChanged(r, t, 201);
    }),
  ),

  /** Elenco sem conta (RN-18): corrigir nome, ID no jogo ou titular/reserva. */
  http.patch(
    url('/registrations/:id/guests/:guestId'),
    handle(async ({ request, params }) => {
      const { r, t, user, guests } = staffRoster(param(params, 'id'));
      const input = await body(request, UpdateGuestMemberInput);
      const current = guests.find((g) => g.id === param(params, 'guestId'));
      if (!current) throw notFound('Jogador no elenco');
      const next: GuestRow = {
        name: input.name ?? current.name,
        gameId: input.gameId === undefined ? current.gameId : input.gameId?.trim() || null,
        isSub: input.isSub ?? current.isSub,
      };
      const problem = guestRosterProblem(guests.map((g) => (g.id === current.id ? next : g)), modeSize(t)) ?? guestsProblem(t, [next], r.id);
      if (problem) throw new HttpProblem(409, problem, 'INVALID_ROSTER', { name: problem });
      const before = { nome: current.name, reserva: current.isSub };
      Object.assign(current, next);
      audit(user, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${displayName(r)}`, tournamentId: t.id, before, after: { corrigiu: next.name, reserva: next.isSub, semConta: true } });
      return rosterChanged(r, t);
    }),
  ),

  /** Elenco sem conta (RN-18): tirar um jogador. */
  http.delete(
    url('/registrations/:id/guests/:guestId'),
    handle(({ params }) => {
      const { r, t, user, guests } = staffRoster(param(params, 'id'));
      const index = guests.findIndex((g) => g.id === param(params, 'guestId'));
      const current = guests[index];
      if (!current) throw notFound('Jogador no elenco');
      guests.splice(index, 1);
      audit(user, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${displayName(r)}`, tournamentId: t.id, after: { tirou: current.name, semConta: true } });
      return rosterChanged(r, t);
    }),
  ),

  /** Exportação para planilha: UTF-8 com BOM e `;`, para abrir certo no Excel em pt-BR. */
  http.get(
    url('/tournaments/:id/registrations.csv'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      requireTournamentAccess(t, { allowModerator: true });
      settleWaitlist(t);
      const info = importedInfo();
      const order: RegistrationStatus[] = ['CONFIRMED', 'PENDING_APPROVAL', 'PENDING_MEMBERS', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'];
      const rows = db()
        .registrations.filter((r) => r.tournamentId === t.id)
        .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt))
        .map((r) => {
          const view: Registration = toStaffRegistration(r);
          const extra = info.find((x) => x.registrationId === r.id);
          return { ...view, contact: extra?.contact ?? null, gameAccountId: extra?.gameId ?? null };
        });
      return new HttpResponse(registrationsToCsv(rows), {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="inscritos-${t.slug}.csv"` },
      });
    }),
  ),
];
