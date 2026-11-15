/**
 * Conversões do campeonato (banco → contrato de `@nova/schemas`). Mesmos campos da API simulada
 * (`apps/web/mocks/views.ts`).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import {
  SLOT_HOLDING_STATUSES,
  type CheckInConfig,
  type OrganizerTournament,
  type OrganizerTournamentDetail,
  type PublicUser,
  type Stage,
  type Tournament,
  type TournamentAccessRole,
  type TournamentSummary,
} from '@nova/schemas';
import type { TournamentAccess } from '../../auth/rbac';

const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT'] as const;

export const publicUserInclude = { roles: true, organizerLimits: { select: { verified: true } } } satisfies Prisma.UserInclude;
type PublicUserRow = Prisma.UserGetPayload<{ include: typeof publicUserInclude }>;

export function toPublicUser(u: PublicUserRow): PublicUser {
  return {
    id: u.id,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl,
    country: u.country,
    state: u.state,
    bio: u.bio,
    socials: (u.socials ?? {}) as PublicUser['socials'],
    roles: ROLE_ORDER.filter((r) => u.roles.some((x) => x.role === r)),
    verifiedOrganizer: u.organizerLimits?.verified ?? false,
    createdAt: u.createdAt.toISOString(),
  };
}

export const tournamentInclude = {
  game: { select: { name: true, icon: true } },
  gameMode: { select: { name: true } },
  owner: { include: publicUserInclude },
  stages: { orderBy: { order: 'asc' } },
} satisfies Prisma.TournamentInclude;
export type TournamentRow = Prisma.TournamentGetPayload<{ include: typeof tournamentInclude }>;
type StageRow = TournamentRow['stages'][number];

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toStage(s: StageRow): Stage {
  return {
    id: s.id,
    tournamentId: s.tournamentId,
    order: s.order,
    name: s.name,
    format: s.format,
    scoringModelId: s.scoringModelId,
    config: s.config as Stage['config'],
    qualification: (s.qualification ?? null) as Stage['qualification'],
    tiebreakers: s.tiebreakers as Stage['tiebreakers'],
    seeding: s.seeding,
    randomSeed: s.randomSeed,
    status: s.status,
    lockedAt: iso(s.lockedAt),
  };
}

const DEFAULT_CHECK_IN: CheckInConfig = { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false };
export const checkInOf = (raw: unknown): CheckInConfig => ({ ...DEFAULT_CHECK_IN, ...((raw as Partial<CheckInConfig> | null) ?? {}) });

/** Contagens que vêm das inscrições (vagas ocupadas, lista de espera, aprovações pendentes). */
export interface TournamentCounts {
  takenSlots: number;
  waitlist: number;
  pendingApprovals: number;
}

export async function countsOf(db: PrismaClient | Prisma.TransactionClient, tournamentIds: string[]): Promise<Map<string, TournamentCounts>> {
  const rows = await db.registration.groupBy({ by: ['tournamentId', 'status'], where: { tournamentId: { in: tournamentIds } }, _count: { _all: true } });
  const map = new Map<string, TournamentCounts>();
  for (const id of tournamentIds) map.set(id, { takenSlots: 0, waitlist: 0, pendingApprovals: 0 });
  for (const r of rows) {
    const c = map.get(r.tournamentId);
    if (!c) continue;
    if (SLOT_HOLDING_STATUSES.includes(r.status)) c.takenSlots += r._count._all;
    if (r.status === 'WAITLIST') c.waitlist += r._count._all;
    if (r.status === 'PENDING_APPROVAL') c.pendingApprovals += r._count._all;
  }
  return map;
}

const NO_COUNTS: TournamentCounts = { takenSlots: 0, waitlist: 0, pendingApprovals: 0 };

export function toTournamentSummary(t: TournamentRow, counts: TournamentCounts = NO_COUNTS): TournamentSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    gameId: t.gameId,
    gameModeId: t.gameModeId,
    ownerId: t.ownerId,
    status: t.status,
    participantType: t.participantType,
    maxParticipants: t.maxParticipants,
    registrationOpensAt: iso(t.registrationOpensAt),
    registrationClosesAt: iso(t.registrationClosesAt),
    startsAt: iso(t.startsAt),
    bannerUrl: t.bannerUrl,
    featured: t.featured,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    gameName: t.game.name,
    gameIcon: t.game.icon,
    modeName: t.gameMode.name,
    organizerNickname: t.owner.nickname,
    organizerVerified: t.owner.organizerLimits?.verified ?? false,
    takenSlots: counts.takenSlots,
    // Pagamentos ficam para depois do lançamento: todo campeonato é gratuito.
    free: true,
  };
}

export function toTournament(t: TournamentRow, counts: TournamentCounts = NO_COUNTS): Tournament {
  return {
    ...toTournamentSummary(t, counts),
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    streamUrls: t.streamUrls,
    manualApproval: t.manualApproval,
    waitlistEnabled: t.waitlistEnabled,
    checkIn: checkInOf(t.checkInConfig),
    rosterLockAt: iso(t.rosterLockAt),
    stages: t.stages.map(toStage),
    organizer: toPublicUser(t.owner),
    draftStep: t.draftStep ?? 0,
    waitlistCount: counts.waitlist,
  };
}

export const accessRole = (via: TournamentAccess['via']): TournamentAccessRole => (via === 'admin' ? 'ADMIN' : via === 'owner' ? 'OWNER' : via);

export function toOrganizerDetail(t: TournamentRow, access: TournamentAccessRole, counts: TournamentCounts = NO_COUNTS): OrganizerTournamentDetail {
  return {
    ...toTournament(t, counts),
    access,
    pendingApprovals: counts.pendingApprovals,
    cancelReason: t.status === 'CANCELLED' ? t.statusReason : null,
    pauseReason: t.status === 'PAUSED' ? t.statusReason : null,
  };
}

export function toOrganizerTournament(t: TournamentRow, access: TournamentAccessRole, counts: TournamentCounts = NO_COUNTS): OrganizerTournament {
  return { ...toTournamentSummary(t, counts), access, draftStep: t.draftStep ?? 0, pendingApprovals: counts.pendingApprovals, waitlistCount: counts.waitlist, stageCount: t.stages.length };
}
