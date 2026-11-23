/**
 * Seed de demonstração da API real (issue #102): grava no Postgres **os mesmos cenários do protótipo** — o objeto
 * que `apps/web/mocks/seed.ts` (`buildSeed()`) monta para a API simulada. Assim o preview, o staging e os E2E com a
 * API real têm os mesmos dados que o protótipo: campeonatos em vários estados, a Liga Semanal Clash Royale em
 * andamento com o check-in da Bianca aberto, o Open 8 Ball Pool finalizado com pódio, squads, convites, denúncias e
 * notificações.
 *
 * - IDs: `demoId(<id do protótipo>)` (UUID determinístico). Rodar de novo num banco que já tem a seed não faz nada.
 * - Chaves e tabelas: o retrato do motor do protótipo vai para `stages.engineSnapshot` e é projetado nas tabelas de
 *   consulta pelas mesmas funções da API (`projectRun`, `persistStandings`); a sala vai cifrada (`encryptLobby`).
 * - Senha: `SEED_DEMO_PASSWORD` (a mesma de todas as contas de demonstração). 2FA dos Admins: com
 *   `SEED_DEMO_TOTP_SECRET` (Base32), Rafael e Ana já nascem com 2FA ativo nesse segredo; sem ele, ficam sem 2FA.
 *
 * Nunca em produção: quem chama (`apps/web/scripts/seed-demo.ts`) recusa `VERCEL_ENV=production`.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import type { Rule, StageState, StageStructure } from '@nova/engine';
import { hashPassword, sha256 } from '../auth/crypto';
import { encryptSecret } from '../auth/two-factor';
import { encryptLobby } from '../competition/lobby-crypto';
import { projectRun, snapshotOf, type StageRun } from '../competition/run';
import { persistStandings } from '../competition/standings';
import type { Env } from '../env';
import { demoId } from './ids';

export { demoId };

// ── Formato dos dados do protótipo (só o que a seed lê) ─────────────────

type Iso = string;
interface DemoGameMode { id: string; name: string; teamSize: number; maxSubs: number; matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE'; maxLobbySize: number | null }
interface DemoScoringModel { id: string; name: string; matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE'; rules: unknown; tiebreakers: unknown; isDefault: boolean }
interface DemoGame { id: string; slug: string; name: string; icon: string; coverUrl: string | null; platform: string; active: boolean; requiredAccountFields: unknown; extraStatFields: unknown; modes: DemoGameMode[]; scoringModels: DemoScoringModel[] }
interface DemoUser {
  id: string;
  email: string;
  nickname: string;
  emailVerified: boolean;
  birthDate: string;
  avatarUrl: string | null;
  country: string | null;
  state: string | null;
  bio: string | null;
  socials: Record<string, string | undefined>;
  timezone: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'MERGED' | 'DELETED';
  roles: ('SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[];
  verifiedOrganizer: boolean;
  twoFactorEnabled: boolean;
  oauthLinks?: { provider: 'google' | 'discord'; email: string | null; linkedAt: Iso }[];
  gameAccounts: { gameId: string; fields: Record<string, string>; updatedAt?: Iso }[];
  organizerLimits: { maxActiveTournaments: number; allowedGameIds: string[] } | null;
  createdAt: Iso;
  lastSeenAt: Iso;
}
interface DemoStage { id: string; order: number; name: string; format: 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'GROUPS' | 'ROUND_ROBIN' | 'SWISS' | 'BATTLE_ROYALE' | 'TEAM_VS_TEAM'; scoringModelId: string; config: unknown; qualification: unknown; tiebreakers: unknown; seeding: 'RANDOM' | 'RANKED' | 'MANUAL'; randomSeed: string | null; status: 'PENDING' | 'ACTIVE' | 'COMPLETED' }
interface DemoTournament {
  id: string;
  slug: string;
  name: string;
  gameId: string;
  gameModeId: string;
  ownerId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'CHECK_IN' | 'IN_PROGRESS' | 'PAUSED' | 'FINISHED' | 'ARCHIVED' | 'CANCELLED';
  participantType: 'SOLO' | 'TEAM';
  maxParticipants: number;
  registrationOpensAt: Iso | null;
  registrationClosesAt: Iso | null;
  startsAt: Iso | null;
  bannerUrl: string | null;
  featured: boolean;
  description: string;
  rules: string;
  prize: string;
  streamUrls: string[];
  manualApproval: boolean;
  waitlistEnabled: boolean;
  checkIn: unknown;
  rosterLockAt: Iso | null;
  stages: DemoStage[];
  draftStep: number;
  createdAt: Iso;
  updatedAt: Iso;
}
interface DemoTeam { id: string; name: string; tag: string; logoUrl: string | null; captainId: string; members: { userId: string; role: 'CAPTAIN' | 'MEMBER'; isSub: boolean; joinedAt: Iso }[]; createdAt: Iso }
interface DemoRegistration { id: string; tournamentId: string; userId: string | null; teamId: string | null; importedName: string | null; importedTag: string | null; status: 'PENDING_MEMBERS' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'WAITLIST' | 'REJECTED' | 'CANCELLED' | 'WITHDRAWN' | 'DISQUALIFIED'; seed: number | null; statusReason: string | null; members: { userId: string; isSub: boolean; confirmedAt: Iso | null }[]; reservedUntil: Iso | null; createdAt: Iso }

export interface DemoData {
  users: DemoUser[];
  games: DemoGame[];
  tournaments: DemoTournament[];
  teams: DemoTeam[];
  teamInvites: { id: string; teamId: string; invitedUserId: string | null; code: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'REVOKED'; invitedById: string; expiresAt: Iso; createdAt: Iso }[];
  registrations: DemoRegistration[];
  organizerRequests: { id: string; userId: string; justification: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewReason: string | null; reviewedById: string | null; createdAt: Iso; reviewedAt: Iso | null }[];
  roleInvites: { id: string; token: string; role: 'ADMIN' | 'ORGANIZER'; email: string | null; maxUses: number; uses: number; expiresAt: Iso; revokedAt: Iso | null; createdById: string; createdAt: Iso }[];
  staff: { tournamentId: string; userId: string; role: 'CO_ORGANIZER' | 'MODERATOR'; addedAt: Iso }[];
  templates: { id: string; ownerId: string | null; name: string; description: string; gameId: string; gameModeId: string; payload: unknown }[];
  announcements: { id: string; tournamentId: string | null; stageId: string | null; groupId: string | null; authorNickname: string; title: string; body: string; createdAt: Iso }[];
  follows: { userId: string; targetType: 'TOURNAMENT' | 'GAME'; targetId: string }[];
  extra: Record<string, unknown[]>;
}

/** Notificação de demonstração (a API simulada semeia as mesmas na primeira leitura). */
export interface DemoNotification {
  userId: string;
  type: 'REGISTRATION_CONFIRMED' | 'TEAM_INVITE' | 'CHECKIN_OPEN' | 'MATCH_SOON' | 'RESULT_POSTED' | 'QUALIFIED' | 'ELIMINATED' | 'ANNOUNCEMENT' | 'ORGANIZER_REQUEST_RESULT' | 'DISPUTE_UPDATE' | 'SANCTION';
  title: string;
  body: string;
  link: string | null;
  /** Há quantos ms foi criada. */
  ago: number;
  read: boolean;
}

/** Denúncia de demonstração (mesmas da API simulada). */
export interface DemoReport {
  id: string;
  reporterId: string;
  targetType: 'USER' | 'TEAM' | 'MATCH' | 'RESULT';
  targetId: string;
  targetLabel: string;
  targetLink: string | null;
  targetOwnerUserId: string | null;
  reason: string;
  description: string;
  status: 'OPEN' | 'IN_REVIEW' | 'ACTIONED' | 'DISMISSED';
  resolution: string | null;
  handledById: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface SeedDemoOptions {
  /** Senha de todas as contas de demonstração (mín. 8 caracteres). Sem ela, as contas ficam sem senha. */
  password?: string;
  /** Segredo TOTP (Base32) do 2FA das contas que nascem com ele ativo. Sem ele, ninguém nasce com 2FA. */
  totpSecret?: string;
  notifications?: DemoNotification[];
  reports?: DemoReport[];
  log?: (line: string) => void;
}

interface MockRun { stageId: string; tournamentId: string; structure: StageStructure; state: StageState; confirmed: boolean; unlocked: boolean; updatedAt: Iso }
interface MockMeta { id: string; scheduledAt: Iso | null; lobbyCode: string | null; lobbyPassword: string | null; checkIns: { registrationId: string; userId: string; at: Iso }[]; evidenceUrls: string[]; updatedAt: Iso | null }
interface MockPodium { tournamentId: string; places: { place: number; registrationId: string }[]; finishedAt: Iso }

const PODIUM_TYPES = { 1: 'CHAMPION', 2: 'RUNNER_UP', 3: 'THIRD_PLACE' } as const;

/** Troca, em qualquer profundidade (valores e chaves), os IDs do protótipo pelos UUIDs da seed. */
function remap<T>(value: T, ids: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return ids.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [ids.get(k) ?? k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

const date = (iso: Iso | null | undefined) => (iso ? new Date(iso) : null);
const json = (v: unknown) => (v ?? null) as Prisma.InputJsonValue;

/** Já semeado? (a Copa Nova FF é o marco). */
export async function hasDemoSeed(db: PrismaClient): Promise<boolean> {
  return (await db.tournament.count({ where: { id: demoId('tn_copa_ff') } })) > 0;
}

/**
 * Grava a seed de demonstração. Idempotente: se o marco já existe, não faz nada (devolve `false`).
 * O banco precisa estar sem os dados de demonstração (pode ter outros dados).
 */
export async function seedDemo(db: PrismaClient, env: Env, data: DemoData, opts: SeedDemoOptions = {}): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  if (await hasDemoSeed(db)) {
    log('Seed de demonstração já aplicada: nada a fazer.');
    return false;
  }

  // Todos os IDs do protótipo → UUID.
  const ids = new Map<string, string>();
  const add = (mockId: string | null | undefined) => {
    if (mockId && !ids.has(mockId)) ids.set(mockId, demoId(mockId));
  };
  data.users.forEach((u) => add(u.id));
  data.games.forEach((g) => {
    add(g.id);
    g.modes.forEach((m) => add(m.id));
    g.scoringModels.forEach((s) => add(s.id));
  });
  data.tournaments.forEach((t) => {
    add(t.id);
    t.stages.forEach((s) => add(s.id));
  });
  data.teams.forEach((t) => add(t.id));
  data.teamInvites.forEach((i) => add(i.id));
  data.registrations.forEach((r) => add(r.id));
  data.organizerRequests.forEach((r) => add(r.id));
  data.roleInvites.forEach((r) => add(r.id));
  data.templates.forEach((t) => add(t.id));
  data.announcements.forEach((a) => add(a.id));
  opts.reports?.forEach((r) => add(r.id));
  const id = (mockId: string) => ids.get(mockId) ?? demoId(mockId);
  const opt = (mockId: string | null | undefined) => (mockId ? id(mockId) : null);

  const passwordHash = opts.password ? await hashPassword(opts.password) : null;
  const userByNick = new Map(data.users.map((u) => [u.nickname, u]));

  // ── Catálogo ─────────────────────────────────────────────────────
  for (const g of data.games) {
    await db.game.upsert({
      where: { slug: g.slug },
      create: { id: id(g.id), slug: g.slug, name: g.name, icon: g.icon, coverUrl: g.coverUrl, platform: g.platform, active: g.active, requiredAccountFields: json(g.requiredAccountFields), extraStatFields: json(g.extraStatFields) },
      update: {},
    });
    const game = await db.game.findUniqueOrThrow({ where: { slug: g.slug }, select: { id: true } });
    if (game.id !== id(g.id)) {
      throw new Error(`O jogo "${g.slug}" já existe com outro ID (seed do catálogo rodou antes). Rode a seed de demonstração num banco vazio.`);
    }
    await db.gameMode.createMany({ data: g.modes.map((m) => ({ id: id(m.id), gameId: game.id, name: m.name, teamSize: m.teamSize, maxSubs: m.maxSubs, matchType: m.matchType, maxLobbySize: m.maxLobbySize })), skipDuplicates: true });
    await db.scoringModel.createMany({ data: g.scoringModels.map((s) => ({ id: id(s.id), gameId: game.id, name: s.name, matchType: s.matchType, rules: json(s.rules), tiebreakers: json(s.tiebreakers), isDefault: s.isDefault })), skipDuplicates: true });
  }
  log(`Catálogo: ${data.games.length} jogos.`);

  // ── Pessoas ──────────────────────────────────────────────────────
  await db.user.createMany({
    data: data.users.map((u) => ({
      id: id(u.id),
      email: u.email.toLowerCase(),
      nickname: u.nickname,
      nicknameKey: u.nickname.toLowerCase(),
      passwordHash,
      emailVerified: u.emailVerified,
      birthDate: date(u.birthDate),
      avatarUrl: u.avatarUrl,
      country: u.country,
      state: u.state,
      bio: u.bio,
      socials: json(Object.fromEntries(Object.entries(u.socials).filter(([, v]) => v))),
      timezone: u.timezone,
      status: u.status,
      lastSeenAt: date(u.lastSeenAt),
      createdAt: new Date(u.createdAt),
    })),
    skipDuplicates: true,
  });
  await db.userRole.createMany({ data: data.users.flatMap((u) => [...new Set([...u.roles, 'PARTICIPANT' as const])].map((role) => ({ userId: id(u.id), role }))), skipDuplicates: true });
  await db.organizerLimits.createMany({
    data: data.users
      .filter((u) => u.roles.includes('ORGANIZER') || u.organizerLimits)
      .map((u) => ({ userId: id(u.id), verified: u.verifiedOrganizer, maxActiveTournaments: u.organizerLimits?.maxActiveTournaments ?? (u.verifiedOrganizer ? 10 : 3), allowedGameIds: (u.organizerLimits?.allowedGameIds ?? []).map(id) })),
    skipDuplicates: true,
  });
  await db.gameAccount.createMany({ data: data.users.flatMap((u) => u.gameAccounts.map((a) => ({ userId: id(u.id), gameId: id(a.gameId), fields: json(a.fields), ...(a.updatedAt ? { createdAt: new Date(a.updatedAt) } : {}) }))), skipDuplicates: true });
  await db.oAuthAccount.createMany({
    data: data.users.flatMap((u) => (u.oauthLinks ?? []).map((l) => ({ userId: id(u.id), provider: l.provider, providerAccountId: `demo-${u.id}-${l.provider}`, email: l.email, emailVerified: true, createdAt: new Date(l.linkedAt) }))),
    skipDuplicates: true,
  });
  if (opts.totpSecret) {
    for (const u of data.users.filter((x) => x.twoFactorEnabled)) {
      await db.twoFactor.upsert({ where: { userId: id(u.id) }, create: { userId: id(u.id), secretEnc: encryptSecret(env, id(u.id), opts.totpSecret), enabledAt: new Date(u.createdAt), recoveryCodesHash: [] }, update: {} });
    }
  }
  log(`Pessoas: ${data.users.length} contas${passwordHash ? ' (com a senha de demonstração)' : ' (sem senha)'}.`);

  // ── Squads ───────────────────────────────────────────────────────
  await db.team.createMany({ data: data.teams.map((t) => ({ id: id(t.id), name: t.name, tag: t.tag, logoUrl: t.logoUrl, captainId: id(t.captainId), createdAt: new Date(t.createdAt) })), skipDuplicates: true });
  await db.teamMember.createMany({ data: data.teams.flatMap((t) => t.members.map((m) => ({ teamId: id(t.id), userId: id(m.userId), role: m.role, isSub: m.isSub, joinedAt: new Date(m.joinedAt) }))), skipDuplicates: true });
  await db.teamInvite.createMany({
    data: data.teamInvites.map((i) => ({ id: id(i.id), teamId: id(i.teamId), invitedUserId: opt(i.invitedUserId), code: i.code, status: i.status, expiresAt: new Date(i.expiresAt), createdById: id(i.invitedById), createdAt: new Date(i.createdAt) })),
    skipDuplicates: true,
  });

  // ── Campeonatos, fases e inscrições ──────────────────────────────
  for (const t of data.tournaments) {
    await db.tournament.create({
      data: {
        id: id(t.id),
        slug: t.slug,
        name: t.name,
        gameId: id(t.gameId),
        gameModeId: id(t.gameModeId),
        ownerId: id(t.ownerId),
        description: t.description,
        rules: t.rules,
        prize: t.prize,
        bannerUrl: t.bannerUrl,
        streamUrls: t.streamUrls,
        status: t.status,
        participantType: t.participantType,
        maxParticipants: t.maxParticipants,
        registrationOpensAt: date(t.registrationOpensAt),
        registrationClosesAt: date(t.registrationClosesAt),
        startsAt: date(t.startsAt),
        manualApproval: t.manualApproval,
        waitlistEnabled: t.waitlistEnabled,
        checkInConfig: json(t.checkIn),
        rosterLockAt: date(t.rosterLockAt),
        featured: t.featured,
        draftStep: t.status === 'DRAFT' ? t.draftStep : null,
        createdAt: new Date(t.createdAt),
        stages: {
          create: t.stages.map((s) => ({
            id: id(s.id),
            order: s.order,
            name: s.name,
            format: s.format,
            scoringModelId: id(s.scoringModelId),
            config: json(s.config),
            qualification: s.qualification === null ? undefined : json(s.qualification),
            tiebreakers: json(s.tiebreakers),
            seeding: s.seeding,
            randomSeed: s.randomSeed,
            status: s.status,
          })),
        },
      },
    });
  }
  await db.registration.createMany({
    data: data.registrations.map((r, i) => ({
      id: id(r.id),
      tournamentId: id(r.tournamentId),
      userId: opt(r.userId),
      teamId: opt(r.teamId),
      displayName: r.importedName,
      tag: r.importedTag,
      status: r.status,
      seed: r.seed,
      statusReason: r.statusReason,
      reservedUntil: date(r.reservedUntil),
      rulesAcceptedAt: new Date(r.createdAt),
      // O protótipo arredonda as datas para a hora: a ordem do seed (lista de espera, chaves) vai nos milissegundos.
      createdAt: new Date(new Date(r.createdAt).getTime() + i),
    })),
  });
  const captainOf = new Map(data.teams.map((t) => [t.id, t.captainId]));
  await db.registrationMember.createMany({
    data: data.registrations.flatMap((r) =>
      r.members.map((m) => ({ registrationId: id(r.id), tournamentId: id(r.tournamentId), userId: id(m.userId), confirmedAt: date(m.confirmedAt), isSub: m.isSub, isCaptain: r.teamId ? captainOf.get(r.teamId) === m.userId : false })),
    ),
    skipDuplicates: true,
  });
  const owners = new Map(data.tournaments.map((t) => [t.id, t.ownerId]));
  await db.tournamentStaff.createMany({ data: data.staff.map((s) => ({ tournamentId: id(s.tournamentId), userId: id(s.userId), role: s.role, addedById: id(owners.get(s.tournamentId) ?? s.userId), createdAt: new Date(s.addedAt) })), skipDuplicates: true });
  log(`Campeonatos: ${data.tournaments.length}, inscrições: ${data.registrations.length}.`);

  // ── Chaves, partidas e tabelas (retrato do motor do protótipo) ───
  const runs = (data.extra.stageRuns ?? []) as MockRun[];
  const metas = (data.extra.matchMeta ?? []) as MockMeta[];
  for (const r of runs) {
    const stageId = id(r.stageId);
    const run = remap({ structure: r.structure, state: r.state }, ids);
    const at = new Date(r.updatedAt);
    const hasResults = Object.values(run.state.results).some((x) => !x.voided);
    await db.$transaction(
      async (tx) => {
        const stage = await tx.stage.update({
          where: { id: stageId },
          data: { engineSnapshot: snapshotOf(run.structure, run.state), confirmedAt: r.confirmed ? at : null, unlocked: r.unlocked, lockedAt: r.confirmed && hasResults ? at : null },
          include: { scoringModel: { select: { rules: true, matchType: true } } },
        });
        await projectRun(tx, stageId, run, { rules: (stage.scoringModel.rules ?? []) as Rule[] });
        const full: StageRun = { ...run, confirmed: r.confirmed, unlocked: r.unlocked };
        await persistStandings(tx, { ...stage, engineSnapshot: null }, full);
        // Partidas com resultado: validadas (como depois de um lançamento da organização).
        for (const [nodeId, result] of Object.entries(run.state.results)) {
          if (result.voided) continue;
          await tx.match.updateMany({ where: { stageId, nodeId }, data: { status: result.walkover ? 'WALKOVER' : 'VALIDATED' } });
        }
      },
      { timeout: 60_000 },
    );
  }
  for (const m of metas) {
    const [mockStage, nodeId] = m.id.split('~');
    if (!mockStage || !nodeId) continue;
    const match = await db.match.findUnique({ where: { stageId_nodeId: { stageId: id(mockStage), nodeId } }, select: { id: true } });
    if (!match) continue;
    await db.match.update({
      where: { id: match.id },
      data: {
        scheduledAt: date(m.scheduledAt),
        evidenceUrls: m.evidenceUrls,
        // Quando o resultado foi lançado (os indicadores do Admin contam as partidas validadas por data).
        ...(m.updatedAt ? { updatedAt: new Date(m.updatedAt) } : {}),
        ...(m.lobbyCode && env.LOBBY_ENCRYPTION_KEY ? { lobbyCodeEnc: encryptLobby(env, match.id, { code: m.lobbyCode, password: m.lobbyPassword }) } : {}),
      },
    });
    if (m.checkIns.length) await db.checkIn.createMany({ data: m.checkIns.map((ci) => ({ matchId: match.id, registrationId: id(ci.registrationId), userId: id(ci.userId), at: new Date(ci.at) })), skipDuplicates: true });
  }
  if (metas.some((m) => m.lobbyCode) && !env.LOBBY_ENCRYPTION_KEY) log('Atenção: sem LOBBY_ENCRYPTION_KEY, as salas de demonstração ficaram sem código.');
  const usersOf = new Map(data.registrations.map((r) => [r.id, r.userId ? [r.userId] : r.members.map((m) => m.userId)]));
  for (const p of (data.extra.podiums ?? []) as MockPodium[]) {
    const tournament = data.tournaments.find((t) => t.id === p.tournamentId);
    await db.tournamentPodium.create({ data: { tournamentId: id(p.tournamentId), places: json(p.places.map((x) => ({ place: x.place, registrationId: id(x.registrationId) }))), finishedAt: new Date(p.finishedAt), finishedById: tournament ? id(tournament.ownerId) : null } });
    await db.achievement.createMany({
      data: p.places.flatMap((x) => (usersOf.get(x.registrationId) ?? []).map((userId) => ({ userId: id(userId), gameId: tournament ? id(tournament.gameId) : null, type: PODIUM_TYPES[x.place as 1 | 2 | 3], tournamentId: id(p.tournamentId), awardedAt: new Date(p.finishedAt) }))),
    });
  }
  log(`Chaves: ${runs.length} fases com retrato, ${metas.length} partidas com agenda.`);

  // ── Governança, comunicados e o resto ────────────────────────────
  await db.organizerRequest.createMany({
    data: data.organizerRequests.map((r) => ({ id: id(r.id), userId: id(r.userId), justification: r.justification, status: r.status, reviewReason: r.reviewReason, reviewedById: opt(r.reviewedById), reviewedAt: date(r.reviewedAt), createdAt: new Date(r.createdAt) })),
    skipDuplicates: true,
  });
  await db.roleInvite.createMany({
    data: data.roleInvites.map((r) => ({ id: id(r.id), role: r.role, tokenHash: sha256(r.token), email: r.email, maxUses: r.maxUses, uses: r.uses, expiresAt: new Date(r.expiresAt), revokedAt: date(r.revokedAt), createdById: id(r.createdById), createdAt: new Date(r.createdAt) })),
    skipDuplicates: true,
  });
  await db.tournamentTemplate.createMany({
    data: data.templates.map((t) => ({ id: id(t.id), ownerId: opt(t.ownerId), name: t.name, description: t.description, gameId: id(t.gameId), gameModeId: id(t.gameModeId), payload: json(remap(t.payload, ids)) })),
    skipDuplicates: true,
  });
  await db.announcement.createMany({
    data: data.announcements.map((a) => {
      const author = userByNick.get(a.authorNickname) ?? data.users[0];
      return { id: id(a.id), tournamentId: opt(a.tournamentId), stageId: opt(a.stageId), groupId: null, authorId: id(author?.id ?? ''), title: a.title, body: a.body, createdAt: new Date(a.createdAt) };
    }),
    skipDuplicates: true,
  });
  await db.follow.createMany({ data: data.follows.map((f) => ({ userId: id(f.userId), targetType: f.targetType, targetId: id(f.targetId) })), skipDuplicates: true });

  const now = Date.now();
  if (opts.notifications?.length) {
    await db.notification.createMany({
      data: opts.notifications
        .filter((n) => ids.has(n.userId))
        .map((n) => ({ userId: id(n.userId), type: n.type, title: n.title, body: n.body, link: remapLink(n.link, data), readAt: n.read ? new Date(now - n.ago + 5 * 60_000) : null, createdAt: new Date(now - n.ago) })),
    });
  }
  if (opts.reports?.length) {
    await db.report.createMany({
      data: opts.reports.map((r) => ({
        id: id(r.id),
        reporterId: id(r.reporterId),
        targetType: r.targetType,
        targetId: id(r.targetId),
        targetLabel: r.targetLabel,
        targetLink: remapLink(r.targetLink, data),
        targetOwnerUserId: opt(r.targetOwnerUserId),
        reason: r.reason,
        description: r.description,
        evidenceUrls: [],
        status: r.status,
        resolution: r.resolution,
        handledById: opt(r.handledById),
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
      })),
      skipDuplicates: true,
    });
  }
  log(`Governança: ${data.organizerRequests.length} pedido(s) de organizador, ${data.roleInvites.length} convites de papel, ${opts.reports?.length ?? 0} denúncias, ${opts.notifications?.length ?? 0} notificações.`);
  return true;
}

/** Links com ID do protótipo (ex.: `/minha-conta/squads/t_alfa`) passam a usar o UUID da seed. */
function remapLink(link: string | null, data: DemoData): string | null {
  if (!link) return link;
  return link.replace(/\/(t_[a-z0-9]+|tn_[a-z0-9_]+|u_[a-z0-9]+)(?=$|[/?#])/g, (whole, mockId: string) => {
    const known = data.teams.some((t) => t.id === mockId) || data.tournaments.some((t) => t.id === mockId) || data.users.some((u) => u.id === mockId);
    return known ? `/${demoId(mockId)}` : whole;
  });
}
