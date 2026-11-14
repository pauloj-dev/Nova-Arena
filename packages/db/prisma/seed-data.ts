/**
 * Dados do seed. O catálogo espelha `buildGames()` de `apps/web/mocks/seed.ts` (o protótipo):
 * ao mudar um, mude o outro. Depois do lançamento, o catálogo é editado pelo Admin (ADM-06).
 */
import type { MatchType, Role } from '../src/generated/prisma/client';

export interface SeedMode {
  key: string;
  name: string;
  teamSize: number;
  maxSubs: number;
  matchType: MatchType;
  maxLobbySize: number | null;
}

export interface SeedScoringModel {
  key: string;
  name: string;
  matchType: MatchType;
  rules: unknown[];
  tiebreakers: string[];
  isDefault: boolean;
}

export interface SeedGame {
  slug: string;
  name: string;
  icon: string;
  platform: string;
  requiredAccountFields: unknown[];
  extraStatFields: unknown[];
  modes: SeedMode[];
  scoringModels: SeedScoringModel[];
}

const BR_TB = ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'];
const DUEL_TB = ['points', 'scoreDiff', 'score', 'headToHead', 'draw'];

export const GAMES: SeedGame[] = [
  {
    slug: 'free-fire',
    name: 'Free Fire',
    icon: '🔥',
    platform: 'Mobile',
    requiredAccountFields: [
      { key: 'playerId', label: 'ID Free Fire', placeholder: 'Ex.: 1234567890', pattern: '^[0-9]{6,12}$' },
      { key: 'nick', label: 'Nick no jogo', placeholder: 'Como aparece na partida' },
    ],
    extraStatFields: [],
    modes: [
      { key: 'solo', name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'BATTLE_ROYALE', maxLobbySize: 48 },
      { key: 'duo', name: 'Duo', teamSize: 2, maxSubs: 0, matchType: 'BATTLE_ROYALE', maxLobbySize: 24 },
      { key: 'squad', name: 'Squad', teamSize: 4, maxSubs: 1, matchType: 'BATTLE_ROYALE', maxLobbySize: 12 },
      { key: 'cs', name: 'Contra Squad 4v4', teamSize: 4, maxSubs: 1, matchType: 'TEAM_VS_TEAM', maxLobbySize: null },
    ],
    scoringModels: [
      {
        key: 'padrao',
        name: 'Free Fire · Padrão (kill 1, Booyah 3)',
        matchType: 'BATTLE_ROYALE',
        rules: [
          { type: 'PER_UNIT', stat: 'kills', points: 1 },
          { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
        ],
        tiebreakers: BR_TB,
        isDefault: true,
      },
      {
        key: 'liga',
        name: 'Free Fire · Liga (tabela de colocação)',
        matchType: 'BATTLE_ROYALE',
        rules: [
          { type: 'PER_UNIT', stat: 'kills', points: 1 },
          { type: 'TABLE', stat: 'placement', table: { '1': 12, '2': 9, '3': 8, '4': 7, '5': 6, '6': 5, '7': 4, '8': 3, '9': 2, '10': 1, '11': 0, '12': 0 } },
        ],
        tiebreakers: BR_TB,
        isDefault: false,
      },
      {
        key: 'cs',
        name: 'Contra Squad · Vitória 3',
        matchType: 'TEAM_VS_TEAM',
        rules: [{ type: 'OUTCOME', win: 3, draw: 0, loss: 0 }],
        tiebreakers: ['points', 'wins', 'scoreDiff', 'headToHead', 'draw'],
        isDefault: true,
      },
    ],
  },
  {
    slug: 'clash-royale',
    name: 'Clash Royale',
    icon: '👑',
    platform: 'Mobile',
    requiredAccountFields: [{ key: 'playerTag', label: 'Tag do jogador', placeholder: 'Ex.: #2PP0LYQ', pattern: '^#?[0-9A-Z]{4,12}$' }],
    extraStatFields: [],
    modes: [
      { key: '1v1', name: '1v1', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null },
      { key: '2v2', name: '2v2', teamSize: 2, maxSubs: 0, matchType: 'TEAM_VS_TEAM', maxLobbySize: null },
    ],
    scoringModels: [
      {
        key: 'padrao',
        name: 'Clash Royale · Coroas + vitória',
        matchType: 'DUEL',
        rules: [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ],
        tiebreakers: DUEL_TB,
        isDefault: true,
      },
      {
        key: '2v2',
        name: 'Clash Royale 2v2 · Coroas + vitória',
        matchType: 'TEAM_VS_TEAM',
        rules: [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ],
        tiebreakers: DUEL_TB,
        isDefault: true,
      },
    ],
  },
  {
    slug: '8-ball-pool',
    name: '8 Ball Pool',
    icon: '🎱',
    platform: 'Mobile',
    requiredAccountFields: [{ key: 'uniqueId', label: 'ID único', placeholder: 'Ex.: 123-456-789-0' }],
    extraStatFields: [],
    modes: [{ key: '1v1', name: '1v1', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }],
    scoringModels: [
      {
        key: 'padrao',
        name: '8 Ball Pool · Frames + série',
        matchType: 'DUEL',
        rules: [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ],
        tiebreakers: ['points', 'scoreDiff', 'headToHead', 'draw'],
        isDefault: true,
      },
    ],
  },
  {
    slug: 'efootball',
    name: 'eFootball',
    icon: '⚽',
    platform: 'Mobile e console',
    requiredAccountFields: [{ key: 'ownerId', label: 'ID do proprietário', placeholder: 'Ex.: ABCD-123-456-789' }],
    extraStatFields: [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }],
    modes: [{ key: '1v1', name: '1v1', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }],
    scoringModels: [
      {
        key: 'padrao',
        name: 'eFootball · 3 / 1 / 0',
        matchType: 'DUEL',
        rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }],
        tiebreakers: DUEL_TB,
        isDefault: true,
      },
    ],
  },
];

export interface SeedUser {
  email: string;
  nickname: string;
  roles: Role[];
  state?: string;
  bio?: string;
  /** Organizador verificado (RN-10: 10 campeonatos simultâneos). */
  verifiedOrganizer?: boolean;
}

/** Contas de demonstração (desenvolvimento e staging), as mesmas do seletor "Entrar como" do protótipo. */
export const DEMO_USERS: SeedUser[] = [
  { email: 'rafael@novaarena.gg', nickname: 'Rafael', roles: ['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT'], state: 'SP', bio: 'Super admin da Nova Arena.' },
  { email: 'ana@novaarena.gg', nickname: 'Ana', roles: ['ADMIN', 'PARTICIPANT'], state: 'RJ', bio: 'Moderação e suporte.' },
  { email: 'camila@novaarena.gg', nickname: 'Camila', roles: ['ORGANIZER', 'PARTICIPANT'], state: 'SP', bio: 'Organizo campeonatos de Free Fire.', verifiedOrganizer: true },
  { email: 'diego@novaarena.gg', nickname: 'Diego', roles: ['ORGANIZER', 'PARTICIPANT'], state: 'PE', bio: 'Ligas de sinuca e futebol.' },
  { email: 'lucas@novaarena.gg', nickname: 'Lucas', roles: ['PARTICIPANT'], state: 'SP', bio: 'Capitão do Squad Alfa.' },
  { email: 'bianca@novaarena.gg', nickname: 'Bianca', roles: ['PARTICIPANT'], state: 'MG', bio: 'Sinuca e futebol.' },
];
