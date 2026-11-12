/**
 * Converte os registros internos do banco simulado no formato dos contratos de `@nova/schemas`.
 * Tudo o que sai pela API passa por aqui (é onde e-mail, senha e IDs de jogo deixam de aparecer).
 */
import {
  SLOT_HOLDING_STATUSES,
  type Me,
  type PublicUser,
  type Registration,
  type Team,
  type TeamInvite,
  type Tournament,
  type TournamentSummary,
} from '@nova/schemas';
import { db, type DbRegistration, type DbTeam, type DbTeamInvite, type DbTournament, type DbUser } from './db';

export function findUser(id: string | null | undefined): DbUser | undefined {
  return id ? db().users.find((u) => u.id === id) : undefined;
}

export function toPublicUser(u: DbUser): PublicUser {
  return {
    id: u.id,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl,
    country: u.country,
    state: u.state,
    bio: u.bio,
    socials: u.socials,
    roles: u.roles,
    verifiedOrganizer: u.verifiedOrganizer,
    createdAt: u.createdAt,
  };
}

export function toMe(u: DbUser): Me {
  return {
    ...toPublicUser(u),
    email: u.email,
    emailVerified: u.emailVerified,
    birthDate: u.birthDate,
    timezone: u.timezone,
    status: u.status,
    twoFactorEnabled: u.twoFactorEnabled,
    gameAccounts: u.gameAccounts,
  };
}

export function takenSlots(tournamentId: string): number {
  return db().registrations.filter((r) => r.tournamentId === tournamentId && SLOT_HOLDING_STATUSES.includes(r.status)).length;
}

export function toTournamentSummary(t: DbTournament): TournamentSummary {
  const game = db().games.find((g) => g.id === t.gameId);
  const mode = game?.modes.find((m) => m.id === t.gameModeId);
  const owner = findUser(t.ownerId);
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
    registrationOpensAt: t.registrationOpensAt,
    registrationClosesAt: t.registrationClosesAt,
    startsAt: t.startsAt,
    bannerUrl: t.bannerUrl,
    featured: t.featured,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    gameName: game?.name ?? 'Jogo',
    gameIcon: game?.icon ?? '🎮',
    modeName: mode?.name ?? '',
    organizerNickname: owner?.nickname ?? 'Organizador',
    organizerVerified: owner?.verifiedOrganizer ?? false,
    takenSlots: takenSlots(t.id),
    free: t.free,
  };
}

export function toTournament(t: DbTournament): Tournament {
  const owner = findUser(t.ownerId);
  if (!owner) throw new Error(`Campeonato ${t.id} sem organizador`);
  return {
    ...toTournamentSummary(t),
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    streamUrls: t.streamUrls,
    manualApproval: t.manualApproval,
    waitlistEnabled: t.waitlistEnabled,
    checkIn: t.checkIn,
    rosterLockAt: t.rosterLockAt,
    stages: [...t.stages].sort((a, b) => a.order - b.order),
    organizer: toPublicUser(owner),
    draftStep: t.draftStep,
    waitlistCount: db().registrations.filter((r) => r.tournamentId === t.id && r.status === 'WAITLIST').length,
  };
}

export function isInviteExpired(i: DbTeamInvite): boolean {
  return new Date(i.expiresAt).getTime() < Date.now();
}

export function toTeamInvite(i: DbTeamInvite): TeamInvite {
  const team = db().teams.find((t) => t.id === i.teamId);
  return {
    id: i.id,
    teamId: i.teamId,
    teamName: team?.name ?? 'Squad',
    teamTag: team?.tag ?? '',
    invitedUserId: i.invitedUserId,
    invitedNickname: findUser(i.invitedUserId)?.nickname ?? null,
    code: i.code,
    status: i.status === 'PENDING' && isInviteExpired(i) ? 'EXPIRED' : i.status,
    invitedByNickname: findUser(i.invitedById)?.nickname ?? '',
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  };
}

export function toTeam(t: DbTeam): Team {
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    logoUrl: t.logoUrl,
    captainId: t.captainId,
    members: t.members.map((m) => {
      const u = findUser(m.userId);
      return { userId: m.userId, nickname: u?.nickname ?? 'Jogador', avatarUrl: u?.avatarUrl ?? null, role: m.role, isSub: m.isSub, joinedAt: m.joinedAt };
    }),
    pendingInvites: db()
      .teamInvites.filter((i) => i.teamId === t.id && i.status === 'PENDING' && !isInviteExpired(i))
      .map(toTeamInvite),
    createdAt: t.createdAt,
  };
}

export function toRegistration(r: DbRegistration): Registration {
  const d = db();
  const tournament = d.tournaments.find((t) => t.id === r.tournamentId);
  const game = d.games.find((g) => g.id === tournament?.gameId);
  const mode = game?.modes.find((m) => m.id === tournament?.gameModeId);
  const team = r.teamId ? d.teams.find((t) => t.id === r.teamId) : undefined;
  const solo = findUser(r.userId);
  const needsAccount = (game?.requiredAccountFields.length ?? 0) > 0;
  const hasAccount = (userId: string) => !needsAccount || Boolean(findUser(userId)?.gameAccounts.some((a) => a.gameId === game?.id));

  const waitlist = d.registrations.filter((x) => x.tournamentId === r.tournamentId && x.status === 'WAITLIST').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const position = r.status === 'WAITLIST' ? waitlist.findIndex((x) => x.id === r.id) + 1 : null;

  const members = team
    ? r.members.map((m) => {
        const u = findUser(m.userId);
        return {
          userId: m.userId,
          nickname: u?.nickname ?? 'Jogador',
          avatarUrl: u?.avatarUrl ?? null,
          isCaptain: team.captainId === m.userId,
          isSub: m.isSub,
          confirmedAt: m.confirmedAt,
          hasGameAccount: hasAccount(m.userId),
        };
      })
    : solo
      ? [{ userId: solo.id, nickname: solo.nickname, avatarUrl: solo.avatarUrl, isCaptain: false, isSub: false, confirmedAt: r.createdAt, hasGameAccount: hasAccount(solo.id) }]
      : [];

  return {
    id: r.id,
    tournamentId: r.tournamentId,
    displayName: team?.name ?? solo?.nickname ?? r.importedName ?? 'Inscrito',
    tag: team?.tag ?? r.importedTag ?? null,
    logoUrl: team?.logoUrl ?? solo?.avatarUrl ?? null,
    userId: r.userId,
    teamId: r.teamId,
    status: r.status,
    seed: r.seed,
    waitlistPosition: position,
    statusReason: r.statusReason,
    members,
    requiredMembers: mode?.teamSize ?? 1,
    reservedUntil: r.reservedUntil,
    createdAt: r.createdAt,
  };
}
