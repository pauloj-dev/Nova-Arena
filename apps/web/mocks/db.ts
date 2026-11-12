/**
 * "Banco" em memória da API simulada (plano F1.1).
 * Fica no navegador e é salvo no localStorage, para o protótipo sobreviver ao recarregar a página.
 * Os registros aqui são internos (têm senha, por exemplo); o que sai pela API passa por `views.ts`.
 */
import type {
  Announcement,
  CheckInConfig,
  Game,
  GameAccount,
  InviteStatus,
  RegistrationStatus,
  Role,
  Stage,
  TournamentDraftInput,
  TournamentStatus,
  UserStatus,
} from '@nova/schemas';
import { buildSeed } from './seed';

export interface DbUser {
  id: string;
  email: string;
  nickname: string;
  password: string;
  emailVerified: boolean;
  birthDate: string;
  avatarUrl: string | null;
  country: string | null;
  state: string | null;
  bio: string | null;
  socials: { discord?: string; instagram?: string; youtube?: string; twitch?: string };
  timezone: string | null;
  status: UserStatus;
  roles: Role[];
  verifiedOrganizer: boolean;
  twoFactorEnabled: boolean;
  gameAccounts: GameAccount[];
  organizerLimits: { maxActiveTournaments: number; allowedGameIds: string[] } | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface DbTournament {
  id: string;
  slug: string;
  name: string;
  gameId: string;
  gameModeId: string;
  ownerId: string;
  status: TournamentStatus;
  participantType: 'SOLO' | 'TEAM';
  maxParticipants: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  bannerUrl: string | null;
  featured: boolean;
  free: boolean;
  description: string;
  rules: string;
  prize: string;
  streamUrls: string[];
  manualApproval: boolean;
  waitlistEnabled: boolean;
  checkIn: CheckInConfig;
  rosterLockAt: string | null;
  stages: Stage[];
  draftStep: number;
  createdAt: string;
  updatedAt: string;
}

export interface DbTeamMember {
  userId: string;
  role: 'CAPTAIN' | 'MEMBER';
  isSub: boolean;
  joinedAt: string;
}
export interface DbTeam {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  captainId: string;
  members: DbTeamMember[];
  createdAt: string;
}
export interface DbTeamInvite {
  id: string;
  teamId: string;
  invitedUserId: string | null;
  code: string;
  status: InviteStatus;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

export interface DbRegistrationMember {
  userId: string;
  isSub: boolean;
  confirmedAt: string | null;
}
export interface DbRegistration {
  id: string;
  tournamentId: string;
  userId: string | null;
  teamId: string | null;
  /** Inscrito importado por CSV, sem conta na plataforma. */
  importedName: string | null;
  importedTag: string | null;
  status: RegistrationStatus;
  seed: number | null;
  statusReason: string | null;
  members: DbRegistrationMember[];
  reservedUntil: string | null;
  createdAt: string;
}

export interface DbOrganizerRequest {
  id: string;
  userId: string;
  justification: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewReason: string | null;
  reviewedById: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface DbRoleInvite {
  id: string;
  token: string;
  role: 'ADMIN' | 'ORGANIZER';
  email: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string;
  revokedAt: string | null;
  createdById: string;
  createdAt: string;
}

export interface DbStaff {
  tournamentId: string;
  userId: string;
  role: 'CO_ORGANIZER' | 'MODERATOR';
  addedAt: string;
}

export interface DbTemplate {
  id: string;
  ownerId: string | null;
  name: string;
  description: string;
  gameId: string;
  gameModeId: string;
  payload: TournamentDraftInput;
}

export interface DbFollow {
  userId: string;
  targetType: 'TOURNAMENT' | 'GAME';
  targetId: string;
}

export interface DbEmailToken {
  token: string;
  userId: string;
  type: 'VERIFY' | 'RESET';
  usedAt: string | null;
}

/** Estado completo do banco. Módulos de F2 acrescentam coleções em `extra` sem mexer aqui. */
export interface Db {
  version: number;
  users: DbUser[];
  games: Game[];
  tournaments: DbTournament[];
  teams: DbTeam[];
  teamInvites: DbTeamInvite[];
  registrations: DbRegistration[];
  organizerRequests: DbOrganizerRequest[];
  roleInvites: DbRoleInvite[];
  staff: DbStaff[];
  templates: DbTemplate[];
  announcements: Announcement[];
  follows: DbFollow[];
  emailTokens: DbEmailToken[];
  /** Coleções dos módulos de competição, administração e notificações (F2). */
  extra: Record<string, unknown[]>;
}

export const DB_VERSION = 1;
const STORAGE_KEY = 'nova-mock-db';
const SESSION_KEY = 'nova-mock-session';

let state: Db | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function db(): Db {
  if (state) return state;
  const raw = storage()?.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.version === DB_VERSION) {
        state = parsed;
        return state;
      }
    } catch {
      // Dado corrompido: recomeça do seed.
    }
  }
  state = buildSeed();
  save();
  return state;
}

/** Grava o estado. Chame depois de qualquer mutação. */
export function save(): void {
  if (!state) return;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Armazenamento cheio ou bloqueado: o protótipo segue só em memória.
  }
}

/** Volta ao estado inicial (botão "Reiniciar dados" do protótipo e testes). */
export function resetDb(): void {
  state = buildSeed();
  save();
  setSessionUserId(null);
}

/** Coleção de um módulo de F2, criada na primeira leitura. */
export function collection<T>(name: string, seed?: () => T[]): T[] {
  const d = db();
  if (!d.extra[name]) {
    d.extra[name] = seed ? seed() : [];
    save();
  }
  return d.extra[name] as T[];
}

// ── Sessão simulada ──────────────────────────────────────────────────
export function getSessionUserId(): string | null {
  return storage()?.getItem(SESSION_KEY) ?? null;
}
export function setSessionUserId(id: string | null): void {
  const s = storage();
  if (!s) return;
  if (id) s.setItem(SESSION_KEY, id);
  else s.removeItem(SESSION_KEY);
}

// ── Utilidades ───────────────────────────────────────────────────────
let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
export function nowIso(): string {
  return new Date().toISOString();
}
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  const root = slugify(base) || 'campeonato';
  if (!taken(root)) return root;
  for (let i = 2; i < 1000; i += 1) {
    if (!taken(`${root}-${i}`)) return `${root}-${i}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}
export function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
