/**
 * Núcleo das inscrições (issue #79): leitura em formato de contrato, trava do campeonato e lista de espera.
 *
 * **Concorrência:** toda mudança que mexe em vagas roda numa transação que começa com
 * `SELECT … FOR UPDATE` na linha do campeonato. Duas inscrições ao mesmo tempo esperam uma pela outra, então
 * a contagem de vagas é sempre a verdadeira — a última vaga nunca é dada duas vezes (CT-02).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { isReservationExpired, planPromotions, SLOT_HOLDING_STATUSES, type Registration, type RegistrationStatus, type TournamentStatus } from '@nova/schemas';

export type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

/** Opções da transação com trava: várias inscrições disputando a mesma linha esperam na fila. */
export const LOCKED_TX = { maxWait: 20_000, timeout: 20_000 } as const;

export const tournamentForRegistration = {
  gameMode: { select: { name: true, teamSize: true, maxSubs: true } },
  game: { select: { id: true, name: true, requiredAccountFields: true } },
} satisfies Prisma.TournamentInclude;
export type TournamentForRegistration = Prisma.TournamentGetPayload<{ include: typeof tournamentForRegistration }>;

/** Trava a linha do campeonato até o fim da transação e devolve o campeonato atualizado. */
export async function lockTournament(tx: Tx, id: string): Promise<TournamentForRegistration> {
  await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.tournament.findUniqueOrThrow({ where: { id }, include: tournamentForRegistration });
}

export const registrationInclude = {
  members: { include: { user: { select: { nickname: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } },
  team: { select: { name: true, tag: true, logoUrl: true, captainId: true } },
  user: { select: { nickname: true, avatarUrl: true } },
} satisfies Prisma.RegistrationInclude;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

const confirmed = (r: { members: { confirmedAt: Date | null }[] }) => r.members.filter((m) => m.confirmedAt !== null).length;
const needsAccount = (t: TournamentForRegistration) => Array.isArray(t.game.requiredAccountFields) && t.game.requiredAccountFields.length > 0;

/** Converte inscrições de um mesmo campeonato (com posição na fila e se cada jogador tem o ID do jogo). */
export async function toRegistrations(db: Db, t: TournamentForRegistration, rows: RegistrationRow[]): Promise<Registration[]> {
  const waitlist = await db.registration.findMany({ where: { tournamentId: t.id, status: 'WAITLIST' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  const position = new Map(waitlist.map((w, i) => [w.id, i + 1]));
  const userIds = [...new Set(rows.flatMap((r) => [...r.members.map((m) => m.userId), ...(r.userId ? [r.userId] : [])]))];
  const withAccount = needsAccount(t)
    ? new Set((await db.gameAccount.findMany({ where: { gameId: t.game.id, userId: { in: userIds } }, select: { userId: true } })).map((a) => a.userId))
    : null;
  const hasAccount = (userId: string) => withAccount === null || withAccount.has(userId);

  return rows.map((r) => {
    const members = r.team
      ? r.members.map((m) => ({ userId: m.userId, nickname: m.user.nickname, avatarUrl: m.user.avatarUrl, isCaptain: r.team?.captainId === m.userId, isSub: m.isSub, confirmedAt: m.confirmedAt?.toISOString() ?? null, hasGameAccount: hasAccount(m.userId) }))
      : r.user && r.userId
        ? [{ userId: r.userId, nickname: r.user.nickname, avatarUrl: r.user.avatarUrl, isCaptain: false, isSub: false, confirmedAt: r.createdAt.toISOString(), hasGameAccount: hasAccount(r.userId) }]
        : [];
    return {
      id: r.id,
      tournamentId: r.tournamentId,
      // Squad excluído: o nome e a tag ficam guardados na própria inscrição.
      displayName: r.displayName ?? r.team?.name ?? r.user?.nickname ?? 'Inscrito',
      tag: r.tag ?? r.team?.tag ?? null,
      logoUrl: r.team?.logoUrl ?? r.user?.avatarUrl ?? null,
      userId: r.userId,
      teamId: r.teamId,
      status: r.status,
      seed: r.seed,
      waitlistPosition: position.get(r.id) ?? null,
      statusReason: r.statusReason,
      members,
      requiredMembers: t.gameMode.teamSize,
      reservedUntil: r.reservedUntil?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function toRegistration(db: Db, t: TournamentForRegistration, id: string): Promise<Registration> {
  const row = await db.registration.findUniqueOrThrow({ where: { id }, include: registrationInclude });
  const [view] = await toRegistrations(db, t, [row]);
  return view as Registration;
}

export async function takenSlots(db: Db, tournamentId: string): Promise<number> {
  return db.registration.count({ where: { tournamentId, status: { in: SLOT_HOLDING_STATUSES } } });
}

/** Antes de a fase 1 começar: reserva vencida sempre devolve o squad à lista de espera. */
const BEFORE_START: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
/** Estados em que a fila anda sozinha. Depois do check-in só a organização substitui (RN-06). */
export const AUTO_PROMOTION_STATUSES: TournamentStatus[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

/**
 * RN-12 — coloca a fila em dia (use dentro da transação com trava): devolve ao fim da lista o squad
 * promovido que não completou o elenco no prazo e promove os primeiros da fila para as vagas livres.
 * Devolve os ids promovidos.
 */
export async function settleWaitlist(tx: Tx, t: TournamentForRegistration, now: Date, opts: { force?: boolean } = {}): Promise<string[]> {
  if (!BEFORE_START.includes(t.status)) return [];
  const pending = await tx.registration.findMany({ where: { tournamentId: t.id, status: 'PENDING_MEMBERS', reservedUntil: { not: null } }, select: { id: true, status: true, reservedUntil: true } });
  let index = 0;
  for (const r of pending) {
    if (!isReservationExpired({ status: r.status, reservedUntil: r.reservedUntil?.toISOString() ?? null }, now)) continue;
    // A posição na fila é a ordem de `createdAt`: voltar ao fim da fila é entrar de novo agora.
    await tx.registration.update({ where: { id: r.id }, data: { status: 'WAITLIST', reservedUntil: null, createdAt: new Date(now.getTime() + index) } });
    index += 1;
  }

  if (!opts.force && !AUTO_PROMOTION_STATUSES.includes(t.status)) return [];
  const freeSlots = t.maxParticipants - (await takenSlots(tx, t.id));
  if (freeSlots <= 0) return [];
  const waitlist = await tx.registration.findMany({ where: { tournamentId: t.id, status: 'WAITLIST' }, select: { id: true, createdAt: true, teamId: true, members: { select: { confirmedAt: true } } } });
  const promotions = planPromotions({
    freeSlots,
    waitlist: waitlist.map((w) => ({ id: w.id, createdAt: w.createdAt.toISOString(), isTeam: w.teamId !== null, confirmedMembers: confirmed(w), requiredMembers: t.gameMode.teamSize })),
    manualApproval: t.manualApproval,
    registrationClosesAt: t.registrationClosesAt?.toISOString() ?? null,
    now,
  });
  for (const p of promotions) {
    await tx.registration.update({ where: { id: p.id }, data: { status: p.status, reservedUntil: p.reservedUntil ? new Date(p.reservedUntil) : null, statusReason: null } });
  }
  return promotions.map((p) => p.id);
}

/** Status que não ocupam mais o jogador neste campeonato: o elenco sai (ele pode jogar por outro squad). */
export const RELEASED: RegistrationStatus[] = ['CANCELLED', 'REJECTED'];

export async function releaseMembers(tx: Tx, registrationId: string): Promise<void> {
  await tx.registrationMember.deleteMany({ where: { registrationId } });
}
