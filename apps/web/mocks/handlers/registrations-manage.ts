/**
 * Módulo `registrations-manage` da API simulada: gestão de inscrições pelo organizador (issue #30).
 * Aprovar, recusar, remover e substituir; importar e exportar CSV. Permissões do PRD §6:
 * aprovar e recusar também é do moderador; remover, substituir e importar é da organização.
 */
import { http, HttpResponse } from 'msw';
import { ImportRegistrationsInput, ReviewRegistrationInput, SLOT_HOLDING_STATUSES, type ImportRegistrationsResult, type Registration, type RegistrationStatus, type ReviewRegistrationResult, type TournamentStatus } from '@nova/schemas';
import { registrationsToCsv } from '@/features/organizer/lib/csv';
import { promoteFromWaitlist, promotionFor, type WaitlistContext, type WaitlistRegistration } from '@/features/organizer/lib/waitlist';
import { collection, db, nowIso, save, uid, type DbRegistration, type DbTournament } from '../db';
import { body, conflict, findTournament, forbidden, handle, json, notFound, param, requireTournamentAccess, url } from '../http';
import { takenSlots, toRegistration } from '../views';

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

export const handlers = [
  http.patch(
    url('/registrations/:id'),
    handle(async ({ request, params }) => {
      const r = db().registrations.find((x) => x.id === param(params, 'id'));
      if (!r) throw notFound('Inscrição');
      const t = findTournament(r.tournamentId);
      const { access } = requireTournamentAccess(t, { allowModerator: true });
      const input = await body(request, ReviewRegistrationInput);
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
      if (!BEFORE_START.includes(t.status)) {
        throw conflict(t.status === 'DRAFT' ? 'Publique o campeonato antes de importar inscritos.' : 'Só dá para importar inscritos antes de o campeonato começar.', 'REGISTRATIONS_LOCKED');
      }

      const d = db();
      const names = new Set(
        d.registrations.filter((r) => r.tournamentId === t.id && ACTIVE.includes(r.status)).map((r) => displayName(r).trim().toLowerCase()),
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
        const registration: DbRegistration = {
          id: uid('r'),
          tournamentId: t.id,
          userId: null,
          teamId: null,
          importedName: name,
          importedTag: row.tag?.trim() ? row.tag.trim().toUpperCase() : null,
          status: hasSlot ? 'CONFIRMED' : 'WAITLIST',
          seed: null,
          statusReason: null,
          members: [],
          reservedUntil: null,
          // Um milissegundo por linha preserva a ordem do arquivo na lista de espera.
          createdAt: new Date(base + index).toISOString(),
        };
        d.registrations.push(registration);
        names.add(key);
        if (row.contact?.trim() || row.gameId?.trim()) {
          importedInfo().push({ registrationId: registration.id, contact: row.contact?.trim() || null, gameId: row.gameId?.trim() || null });
        }
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

  /** Exportação para planilha: UTF-8 com BOM e `;`, para abrir certo no Excel em pt-BR. */
  http.get(
    url('/tournaments/:id/registrations.csv'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      requireTournamentAccess(t, { allowModerator: true });
      const info = importedInfo();
      const order: RegistrationStatus[] = ['CONFIRMED', 'PENDING_APPROVAL', 'PENDING_MEMBERS', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'];
      const rows = db()
        .registrations.filter((r) => r.tournamentId === t.id)
        .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt))
        .map((r) => {
          const view: Registration = toRegistration(r);
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
