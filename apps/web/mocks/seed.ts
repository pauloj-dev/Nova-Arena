/**
 * Dados iniciais do protótipo: 4 jogos, usuários dos 4 papéis, squads e campeonatos em vários estados.
 * As datas são relativas ao momento do seed, para o protótipo nunca "vencer".
 */
import type { Game, GameMode, Qualification, ScoringModel, Stage, StageConfig, StageFormat, Tiebreaker } from '@nova/schemas';
import { StageConfig as StageConfigSchema } from '@nova/schemas';
import type { Db, DbRegistration, DbTeam, DbTournament, DbUser } from './db';
import { seedCompetition } from './seed-competition';

/** Senha de todas as contas do protótipo. */
export const DEMO_PASSWORD = 'arena1234';

export const DEMO_USERS = {
  superAdmin: 'u_rafael',
  admin: 'u_ana',
  organizer: 'u_camila',
  organizer2: 'u_diego',
  captain: 'u_lucas',
  participant: 'u_bianca',
} as const;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function at(base: number, offsetMs: number): string {
  // Arredonda para a hora cheia: horários de partida ficam "20h", não "20h17".
  const t = new Date(base + offsetMs);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

function mode(gameId: string, id: string, name: string, teamSize: number, maxSubs: number, matchType: GameMode['matchType'], maxLobbySize: number | null = null): GameMode {
  return { id, gameId, name, teamSize, maxSubs, matchType, maxLobbySize };
}

function model(gameId: string, id: string, name: string, matchType: ScoringModel['matchType'], rules: ScoringModel['rules'], tiebreakers: Tiebreaker[], isDefault = false): ScoringModel {
  return { id, gameId, name, matchType, rules, tiebreakers, isDefault, ownerId: null };
}

function buildGames(): Game[] {
  const ff = 'g_freefire';
  const cr = 'g_clashroyale';
  const pool = 'g_8ball';
  const ef = 'g_efootball';
  return [
    {
      id: ff,
      slug: 'free-fire',
      name: 'Free Fire',
      icon: '🔥',
      coverUrl: null,
      platform: 'Mobile',
      active: true,
      requiredAccountFields: [
        { key: 'playerId', label: 'ID Free Fire', placeholder: 'Ex.: 1234567890', pattern: '^[0-9]{6,12}$' },
        { key: 'nick', label: 'Nick no jogo', placeholder: 'Como aparece na partida' },
      ],
      extraStatFields: [],
      modes: [
        mode(ff, 'm_ff_solo', 'Solo', 1, 0, 'BATTLE_ROYALE', 48),
        mode(ff, 'm_ff_duo', 'Duo', 2, 0, 'BATTLE_ROYALE', 24),
        mode(ff, 'm_ff_squad', 'Squad', 4, 1, 'BATTLE_ROYALE', 12),
        mode(ff, 'm_ff_cs', 'Contra Squad 4v4', 4, 1, 'TEAM_VS_TEAM'),
      ],
      scoringModels: [
        model(ff, 'sm_ff_padrao', 'Free Fire · Padrão (kill 1, Booyah 3)', 'BATTLE_ROYALE', [
          { type: 'PER_UNIT', stat: 'kills', points: 1 },
          { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
        ], ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'], true),
        model(ff, 'sm_ff_liga', 'Free Fire · Liga (tabela de colocação)', 'BATTLE_ROYALE', [
          { type: 'PER_UNIT', stat: 'kills', points: 1 },
          { type: 'TABLE', stat: 'placement', table: { '1': 12, '2': 9, '3': 8, '4': 7, '5': 6, '6': 5, '7': 4, '8': 3, '9': 2, '10': 1, '11': 0, '12': 0 } },
        ], ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw']),
        model(ff, 'sm_ff_cs', 'Contra Squad · Vitória 3', 'TEAM_VS_TEAM', [{ type: 'OUTCOME', win: 3, draw: 0, loss: 0 }], ['points', 'wins', 'scoreDiff', 'headToHead', 'draw'], true),
      ],
    },
    {
      id: cr,
      slug: 'clash-royale',
      name: 'Clash Royale',
      icon: '👑',
      coverUrl: null,
      platform: 'Mobile',
      active: true,
      requiredAccountFields: [{ key: 'playerTag', label: 'Tag do jogador', placeholder: 'Ex.: #2PP0LYQ', pattern: '^#?[0-9A-Z]{4,12}$' }],
      extraStatFields: [],
      modes: [mode(cr, 'm_cr_1v1', '1v1', 1, 0, 'DUEL'), mode(cr, 'm_cr_2v2', '2v2', 2, 0, 'TEAM_VS_TEAM')],
      scoringModels: [
        model(cr, 'sm_cr_padrao', 'Clash Royale · Coroas + vitória', 'DUEL', [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ], ['points', 'scoreDiff', 'score', 'headToHead', 'draw'], true),
        model(cr, 'sm_cr_2v2', 'Clash Royale 2v2 · Coroas + vitória', 'TEAM_VS_TEAM', [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ], ['points', 'scoreDiff', 'score', 'headToHead', 'draw'], true),
      ],
    },
    {
      id: pool,
      slug: '8-ball-pool',
      name: '8 Ball Pool',
      icon: '🎱',
      coverUrl: null,
      platform: 'Mobile',
      active: true,
      requiredAccountFields: [{ key: 'uniqueId', label: 'ID único', placeholder: 'Ex.: 123-456-789-0' }],
      extraStatFields: [],
      modes: [mode(pool, 'm_pool_1v1', '1v1', 1, 0, 'DUEL')],
      scoringModels: [
        model(pool, 'sm_pool_padrao', '8 Ball Pool · Frames + série', 'DUEL', [
          { type: 'PER_UNIT', stat: 'score', points: 1 },
          { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
        ], ['points', 'scoreDiff', 'headToHead', 'draw'], true),
      ],
    },
    {
      id: ef,
      slug: 'efootball',
      name: 'eFootball',
      icon: '⚽',
      coverUrl: null,
      platform: 'Mobile e console',
      active: true,
      requiredAccountFields: [{ key: 'ownerId', label: 'ID do proprietário', placeholder: 'Ex.: ABCD-123-456-789' }],
      extraStatFields: [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }],
      modes: [mode(ef, 'm_ef_1v1', '1v1', 1, 0, 'DUEL')],
      scoringModels: [
        model(ef, 'sm_ef_padrao', 'eFootball · 3 / 1 / 0', 'DUEL', [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], ['points', 'scoreDiff', 'score', 'headToHead', 'draw'], true),
      ],
    },
  ];
}

const FIRST = ['Kaue', 'Thiago', 'Marina', 'Pedro', 'Julia', 'Rafa', 'Bruno', 'Larissa', 'Caio', 'Nina', 'Vitor', 'Duda', 'Igor', 'Sofia', 'Leo', 'Bia', 'Gui', 'Manu', 'Enzo', 'Lia'];
const SUFFIX = ['FF', 'Pro', 'BR', 'X', 'Zz', 'GG'];
const UF = ['SP', 'RJ', 'MG', 'BA', 'PE', 'CE', 'AM', 'RS', 'PR', 'GO'];
const SQUADS = ['Bravo', 'Charlie', 'Delta', 'Eco', 'Falcão', 'Guará', 'Hidra', 'Íbis', 'Jaguar', 'Kraken', 'Lobo', 'Mamba', 'Naja', 'Onça', 'Puma'];

function user(id: string, nickname: string, email: string, base: number, patch: Partial<DbUser> = {}): DbUser {
  return {
    id,
    email,
    nickname,
    password: DEMO_PASSWORD,
    emailVerified: true,
    birthDate: '2002-05-14',
    avatarUrl: null,
    country: 'Brasil',
    state: 'SP',
    bio: null,
    socials: {},
    timezone: null,
    status: 'ACTIVE',
    roles: ['PARTICIPANT'],
    verifiedOrganizer: false,
    twoFactorEnabled: false,
    gameAccounts: [],
    organizerLimits: null,
    createdAt: at(base, -60 * DAY),
    lastSeenAt: at(base, -HOUR),
    ...patch,
  };
}

function gameAccounts(n: number, base: number): DbUser['gameAccounts'] {
  const updatedAt = at(base, -30 * DAY);
  return [
    { gameId: 'g_freefire', fields: { playerId: String(1000000000 + n * 7919), nick: `ff_${n}` }, updatedAt },
    { gameId: 'g_clashroyale', fields: { playerTag: `#${(900000 + n * 131).toString(36).toUpperCase()}` }, updatedAt },
    { gameId: 'g_8ball', fields: { uniqueId: `${100 + n}-${200 + n}-${300 + n}-${n % 10}` }, updatedAt },
    { gameId: 'g_efootball', fields: { ownerId: `EFTB-${100 + n}-${200 + n}-${300 + n}` }, updatedAt },
  ];
}

const cfg = (patch: Partial<StageConfig> = {}): StageConfig => StageConfigSchema.parse(patch);

function stage(
  tournamentId: string,
  order: number,
  name: string,
  format: StageFormat,
  scoringModelId: string,
  tiebreakers: Tiebreaker[],
  config: Partial<StageConfig>,
  qualification: Qualification | null,
  status: Stage['status'] = 'PENDING',
): Stage {
  return {
    id: `${tournamentId}_s${order}`,
    tournamentId,
    order,
    name,
    format,
    scoringModelId,
    config: cfg(config),
    qualification,
    tiebreakers,
    seeding: 'RANDOM',
    randomSeed: null,
    status,
    lockedAt: null,
  };
}

const BR_TB: Tiebreaker[] = ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'];
const DUEL_TB: Tiebreaker[] = ['points', 'scoreDiff', 'score', 'headToHead', 'draw'];

const RULES_HTML =
  '<h3>Regras gerais</h3><ul><li>Respeite os horários: quem não fizer check-in leva W.O.</li><li>É proibido o uso de hacks, emuladores e qualquer vantagem indevida.</li><li>O resultado precisa de print da tela final.</li><li>Decisões do organizador são finais.</li></ul>';

function tournament(id: string, base: number, patch: Partial<DbTournament> & Pick<DbTournament, 'slug' | 'name' | 'gameId' | 'gameModeId' | 'ownerId' | 'status' | 'participantType' | 'maxParticipants' | 'stages'>): DbTournament {
  return {
    id,
    registrationOpensAt: at(base, -3 * DAY),
    registrationClosesAt: at(base, 4 * DAY),
    startsAt: at(base, 5 * DAY),
    bannerUrl: null,
    featured: false,
    free: true,
    description: '<p>Campeonato gratuito da comunidade Nova Arena. Chame seu time e venha jogar!</p>',
    rules: RULES_HTML,
    prize: '1º lugar: troféu digital e destaque na home.',
    streamUrls: [],
    manualApproval: false,
    waitlistEnabled: true,
    checkIn: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
    rosterLockAt: null,
    draftStep: 6,
    createdAt: at(base, -10 * DAY),
    updatedAt: at(base, -DAY),
    ...patch,
  };
}

export function buildSeed(): Db {
  const base = Date.now();
  const games = buildGames();

  const users: DbUser[] = [
    user(DEMO_USERS.superAdmin, 'Rafael', 'rafael@novaarena.gg', base, { roles: ['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT'], twoFactorEnabled: true, bio: 'Dono da Nova Arena.' }),
    user(DEMO_USERS.admin, 'Ana', 'ana@novaarena.gg', base, { roles: ['ADMIN', 'PARTICIPANT'], twoFactorEnabled: true }),
    user(DEMO_USERS.organizer, 'Camila', 'camila@novaarena.gg', base, {
      roles: ['ORGANIZER', 'PARTICIPANT'],
      verifiedOrganizer: true,
      bio: 'Organizo ligas semanais de Free Fire e Clash Royale.',
      organizerLimits: { maxActiveTournaments: 10, allowedGameIds: [] },
      gameAccounts: gameAccounts(901, base),
    }),
    user(DEMO_USERS.organizer2, 'Diego', 'diego@novaarena.gg', base, {
      roles: ['ORGANIZER', 'PARTICIPANT'],
      state: 'RJ',
      organizerLimits: { maxActiveTournaments: 3, allowedGameIds: [] },
      gameAccounts: gameAccounts(902, base),
    }),
    user(DEMO_USERS.captain, 'Lucas', 'lucas@novaarena.gg', base, { bio: 'Capitão do Squad Alfa.', gameAccounts: gameAccounts(903, base) }),
    user(DEMO_USERS.participant, 'Bianca', 'bianca@novaarena.gg', base, { state: 'MG', bio: 'Sinuca e futebol.', gameAccounts: gameAccounts(904, base).filter((g) => g.gameId !== 'g_freefire') }),
  ];
  for (let i = 1; i <= 60; i += 1) {
    const first = FIRST[(i - 1) % FIRST.length] ?? 'Player';
    const nickname = `${first}${SUFFIX[i % SUFFIX.length] ?? ''}${i}`;
    users.push(user(`u_p${String(i).padStart(2, '0')}`, nickname, `jogador${i}@exemplo.com`, base, { state: UF[i % UF.length] ?? 'SP', gameAccounts: gameAccounts(i, base), createdAt: at(base, -(61 - i) * DAY) }));
  }
  const p = (i: number) => `u_p${String(i).padStart(2, '0')}`;

  // Squad Alfa (do Lucas) + 15 squads de 4 jogadores.
  const teams: DbTeam[] = [
    {
      id: 't_alfa',
      name: 'Squad Alfa',
      tag: 'ALFA',
      logoUrl: null,
      captainId: DEMO_USERS.captain,
      members: [
        { userId: DEMO_USERS.captain, role: 'CAPTAIN', isSub: false, joinedAt: at(base, -40 * DAY) },
        { userId: p(1), role: 'MEMBER', isSub: false, joinedAt: at(base, -39 * DAY) },
        { userId: p(2), role: 'MEMBER', isSub: false, joinedAt: at(base, -39 * DAY) },
        { userId: p(3), role: 'MEMBER', isSub: false, joinedAt: at(base, -38 * DAY) },
      ],
      createdAt: at(base, -40 * DAY),
    },
  ];
  SQUADS.forEach((name, idx) => {
    const start = 4 + idx * 4; // p04..p63 → usamos até p60 (o último squad fica com 1 a menos)
    const ids = [start, start + 1, start + 2, start + 3].filter((n) => n <= 60).map(p);
    const captainId = ids[0] ?? p(60);
    teams.push({
      id: `t_${idx + 1}`,
      name: `Squad ${name}`,
      tag: name.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 4).toUpperCase(),
      logoUrl: null,
      captainId,
      members: ids.map((userId, i) => ({ userId, role: i === 0 ? 'CAPTAIN' : 'MEMBER', isSub: false, joinedAt: at(base, -30 * DAY) })),
      createdAt: at(base, -30 * DAY),
    });
  });

  const tournaments: DbTournament[] = [
    tournament('tn_copa_ff', base, {
      slug: 'copa-nova-ff-squad',
      name: 'Copa Nova FF — Squad',
      gameId: 'g_freefire',
      gameModeId: 'm_ff_squad',
      ownerId: DEMO_USERS.organizer,
      status: 'REGISTRATION_OPEN',
      participantType: 'TEAM',
      maxParticipants: 48,
      featured: true,
      description:
        '<p>A <strong>Copa Nova</strong> reúne 48 squads em três fases: grupos em Battle Royale, mata-mata 4v4 e uma grande final em 5 quedas.</p><p>Inscreva seu squad, confirme os membros e acompanhe a tabela ao vivo.</p>',
      prize: '1º lugar: R$ 0 (campeonato gratuito) + troféu digital. 2º e 3º: medalhas no perfil.',
      streamUrls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      stages: [
        stage('tn_copa_ff', 1, 'Fase de grupos', 'GROUPS', 'sm_ff_padrao', BR_TB, { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }),
        stage('tn_copa_ff', 2, 'Mata-mata 4v4', 'TEAM_VS_TEAM', 'sm_ff_cs', DUEL_TB, { bestOf: 3 }, { type: 'WINNERS', n: 2, repechage: 0 }),
        stage('tn_copa_ff', 3, 'Grande Final', 'BATTLE_ROYALE', 'sm_ff_padrao', BR_TB, { drops: 5, lobbySize: 12 }, null),
      ],
    }),
    tournament('tn_liga_cr', base, {
      slug: 'liga-semanal-clash-royale',
      name: 'Liga Semanal Clash Royale 1v1',
      gameId: 'g_clashroyale',
      gameModeId: 'm_cr_1v1',
      ownerId: DEMO_USERS.organizer,
      status: 'IN_PROGRESS',
      participantType: 'SOLO',
      maxParticipants: 16,
      registrationOpensAt: at(base, -10 * DAY),
      registrationClosesAt: at(base, -2 * DAY),
      startsAt: at(base, -DAY),
      stages: [stage('tn_liga_cr', 1, 'Mata-mata', 'SINGLE_ELIM', 'sm_cr_padrao', DUEL_TB, { bestOf: 3, thirdPlace: true }, null, 'ACTIVE')],
    }),
    tournament('tn_open_8ball', base, {
      slug: 'open-8-ball-pool',
      name: 'Open 8 Ball Pool',
      gameId: 'g_8ball',
      gameModeId: 'm_pool_1v1',
      ownerId: DEMO_USERS.organizer2,
      status: 'FINISHED',
      participantType: 'SOLO',
      maxParticipants: 8,
      registrationOpensAt: at(base, -30 * DAY),
      registrationClosesAt: at(base, -22 * DAY),
      startsAt: at(base, -21 * DAY),
      stages: [stage('tn_open_8ball', 1, 'Suíço', 'SWISS', 'sm_pool_padrao', DUEL_TB, { rounds: 3, bestOf: 3 }, null, 'COMPLETED')],
    }),
    tournament('tn_efootball', base, {
      slug: 'copa-efootball-iniciantes',
      name: 'Copa eFootball Iniciantes',
      gameId: 'g_efootball',
      gameModeId: 'm_ef_1v1',
      ownerId: DEMO_USERS.organizer2,
      status: 'REGISTRATION_OPEN',
      participantType: 'SOLO',
      maxParticipants: 8,
      stages: [
        stage('tn_efootball', 1, 'Grupos', 'GROUPS', 'sm_ef_padrao', DUEL_TB, { groupCount: 2, groupMode: 'DUEL' }, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }),
        stage('tn_efootball', 2, 'Semifinais e final', 'SINGLE_ELIM', 'sm_ef_padrao', DUEL_TB, { bestOf: 1, thirdPlace: true }, null),
      ],
    }),
    tournament('tn_ff_solo', base, {
      slug: 'ff-solo-rush',
      name: 'FF Solo Rush',
      gameId: 'g_freefire',
      gameModeId: 'm_ff_solo',
      ownerId: DEMO_USERS.organizer,
      status: 'PUBLISHED',
      participantType: 'SOLO',
      maxParticipants: 48,
      registrationOpensAt: at(base, 2 * DAY),
      registrationClosesAt: at(base, 9 * DAY),
      startsAt: at(base, 10 * DAY),
      stages: [stage('tn_ff_solo', 1, 'Quedas', 'BATTLE_ROYALE', 'sm_ff_liga', BR_TB, { drops: 4, lobbySize: 48 }, null)],
    }),
    tournament('tn_cr_2v2', base, {
      slug: 'torneio-relampago-cr-2v2',
      name: 'Torneio Relâmpago CR 2v2',
      gameId: 'g_clashroyale',
      gameModeId: 'm_cr_2v2',
      ownerId: DEMO_USERS.organizer,
      status: 'DRAFT',
      participantType: 'TEAM',
      maxParticipants: 16,
      registrationOpensAt: null,
      registrationClosesAt: null,
      startsAt: null,
      draftStep: 3,
      stages: [],
    }),
    tournament('tn_contra_squad', base, {
      slug: 'arena-contra-squad-4v4',
      name: 'Arena Contra Squad 4v4',
      gameId: 'g_freefire',
      gameModeId: 'm_ff_cs',
      ownerId: DEMO_USERS.organizer2,
      status: 'REGISTRATION_OPEN',
      participantType: 'TEAM',
      maxParticipants: 8,
      manualApproval: true,
      stages: [stage('tn_contra_squad', 1, 'Eliminação dupla', 'DOUBLE_ELIM', 'sm_ff_cs', DUEL_TB, { bestOf: 3, grandFinalReset: true }, null)],
    }),
    tournament('tn_8ball_verao', base, {
      slug: 'classico-8-ball-de-verao',
      name: 'Clássico 8 Ball de Verão',
      gameId: 'g_8ball',
      gameModeId: 'm_pool_1v1',
      ownerId: DEMO_USERS.organizer2,
      status: 'CANCELLED',
      participantType: 'SOLO',
      maxParticipants: 32,
      stages: [stage('tn_8ball_verao', 1, 'Pontos corridos', 'ROUND_ROBIN', 'sm_pool_padrao', DUEL_TB, {}, null)],
    }),
  ];

  const registrations: DbRegistration[] = [];
  let regN = 0;
  const reg = (tournamentId: string, patch: Partial<DbRegistration>): void => {
    regN += 1;
    registrations.push({
      id: `r_${regN}`,
      tournamentId,
      userId: null,
      teamId: null,
      importedName: null,
      importedTag: null,
      status: 'CONFIRMED',
      seed: null,
      statusReason: null,
      members: [],
      reservedUntil: null,
      createdAt: at(base, -2 * DAY + regN * 60_000),
      ...patch,
    });
  };
  const teamReg = (tournamentId: string, team: DbTeam, patch: Partial<DbRegistration> = {}) =>
    reg(tournamentId, { teamId: team.id, members: team.members.map((m) => ({ userId: m.userId, isSub: m.isSub, confirmedAt: at(base, -2 * DAY) })), ...patch });
  const soloReg = (tournamentId: string, userId: string, patch: Partial<DbRegistration> = {}) => reg(tournamentId, { userId, ...patch });

  // Copa Nova FF: 12 squads confirmados (o Squad Alfa fica de fora, para a demonstração da inscrição).
  teams.slice(1, 13).forEach((t) => teamReg('tn_copa_ff', t));
  // Liga CR: 16 jogadores, incluindo a Bianca.
  soloReg('tn_liga_cr', DEMO_USERS.participant);
  for (let i = 1; i <= 15; i += 1) soloReg('tn_liga_cr', p(i));
  // Open 8 Ball (finalizado): 8 jogadores, incluindo a Bianca.
  soloReg('tn_open_8ball', DEMO_USERS.participant);
  for (let i = 20; i <= 26; i += 1) soloReg('tn_open_8ball', p(i));
  // eFootball: 8 vagas cheias + 2 na lista de espera.
  for (let i = 30; i <= 37; i += 1) soloReg('tn_efootball', p(i));
  soloReg('tn_efootball', p(38), { status: 'WAITLIST' });
  soloReg('tn_efootball', p(39), { status: 'WAITLIST' });
  // Contra Squad (aprovação manual): Alfa confirmado, 2 confirmados, 1 aguardando aprovação.
  teamReg('tn_contra_squad', teams[0] as DbTeam);
  teamReg('tn_contra_squad', teams[13] as DbTeam);
  teamReg('tn_contra_squad', teams[14] as DbTeam);
  teamReg('tn_contra_squad', teams[15] as DbTeam, { status: 'PENDING_APPROVAL' });

  const seeded: Db = {
    version: 1,
    users,
    games,
    tournaments,
    teams,
    teamInvites: [
      { id: 'ti_1', teamId: 't_alfa', invitedUserId: null, code: 'ALFA42', status: 'PENDING', invitedById: DEMO_USERS.captain, expiresAt: at(base, 3 * DAY), createdAt: at(base, -HOUR) },
      { id: 'ti_2', teamId: 't_1', invitedUserId: DEMO_USERS.participant, code: 'BRAV07', status: 'PENDING', invitedById: p(4), expiresAt: at(base, 2 * DAY), createdAt: at(base, -DAY) },
      { id: 'ti_3', teamId: 't_2', invitedUserId: null, code: 'VELHO1', status: 'PENDING', invitedById: p(8), expiresAt: at(base, -DAY), createdAt: at(base, -4 * DAY) },
    ],
    registrations,
    organizerRequests: [
      {
        id: 'or_1',
        userId: p(5),
        justification: 'Organizo campeonatos de Free Fire no meu bairro há dois anos, com cerca de 30 squads por edição, e quero parar de usar planilha.',
        status: 'PENDING',
        reviewReason: null,
        reviewedById: null,
        createdAt: at(base, -2 * DAY),
        reviewedAt: null,
      },
    ],
    roleInvites: [
      { id: 'ri_1', token: 'convite-admin-valido', role: 'ADMIN', email: null, maxUses: 3, uses: 0, expiresAt: at(base, 7 * DAY), revokedAt: null, createdById: DEMO_USERS.superAdmin, createdAt: at(base, -HOUR) },
      { id: 'ri_2', token: 'convite-organizador-valido', role: 'ORGANIZER', email: null, maxUses: 5, uses: 1, expiresAt: at(base, DAY), revokedAt: null, createdById: DEMO_USERS.admin, createdAt: at(base, -HOUR) },
      { id: 'ri_3', token: 'convite-expirado', role: 'ADMIN', email: null, maxUses: 1, uses: 0, expiresAt: at(base, -DAY), revokedAt: null, createdById: DEMO_USERS.superAdmin, createdAt: at(base, -3 * DAY) },
      { id: 'ri_4', token: 'convite-revogado', role: 'ADMIN', email: null, maxUses: 1, uses: 0, expiresAt: at(base, 7 * DAY), revokedAt: at(base, -HOUR), createdById: DEMO_USERS.superAdmin, createdAt: at(base, -2 * DAY) },
    ],
    staff: [{ tournamentId: 'tn_copa_ff', userId: p(6), role: 'MODERATOR', addedAt: at(base, -2 * DAY) }],
    templates: [
      {
        id: 'tpl_ff_grupos_final',
        ownerId: null,
        name: 'FF Squad — Grupos + Final BR',
        description: 'Fase de grupos em Battle Royale (3 quedas), mata-mata 4v4 e final em 5 quedas.',
        gameId: 'g_freefire',
        gameModeId: 'm_ff_squad',
        payload: {
          gameId: 'g_freefire',
          gameModeId: 'm_ff_squad',
          maxParticipants: 48,
          manualApproval: false,
          waitlistEnabled: true,
          rules: RULES_HTML,
          stages: [
            { name: 'Fase de grupos', format: 'GROUPS', scoringModelId: 'sm_ff_padrao', config: cfg({ groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }), qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, tiebreakers: BR_TB, seeding: 'RANDOM' },
            { name: 'Mata-mata 4v4', format: 'TEAM_VS_TEAM', scoringModelId: 'sm_ff_cs', config: cfg({ bestOf: 3 }), qualification: { type: 'WINNERS', n: 2, repechage: 0 }, tiebreakers: DUEL_TB, seeding: 'RANKED' },
            { name: 'Grande Final', format: 'BATTLE_ROYALE', scoringModelId: 'sm_ff_padrao', config: cfg({ drops: 5, lobbySize: 12 }), qualification: null, tiebreakers: BR_TB, seeding: 'RANKED' },
          ],
        },
      },
      {
        id: 'tpl_cr_md3',
        ownerId: null,
        name: 'CR 1v1 — Mata-mata MD3',
        description: 'Eliminação simples em melhor de 3, com disputa de 3º lugar.',
        gameId: 'g_clashroyale',
        gameModeId: 'm_cr_1v1',
        payload: {
          gameId: 'g_clashroyale',
          gameModeId: 'm_cr_1v1',
          maxParticipants: 16,
          manualApproval: false,
          waitlistEnabled: true,
          rules: RULES_HTML,
          stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: 'sm_cr_padrao', config: cfg({ bestOf: 3, thirdPlace: true }), qualification: null, tiebreakers: DUEL_TB, seeding: 'RANDOM' }],
        },
      },
      {
        id: 'tpl_ef_grupos',
        ownerId: null,
        name: 'eFootball — Grupos + Mata-mata',
        description: 'Dois grupos em pontos corridos; os 2 melhores de cada grupo vão às semifinais.',
        gameId: 'g_efootball',
        gameModeId: 'm_ef_1v1',
        payload: {
          gameId: 'g_efootball',
          gameModeId: 'm_ef_1v1',
          maxParticipants: 8,
          manualApproval: false,
          waitlistEnabled: true,
          rules: RULES_HTML,
          stages: [
            { name: 'Grupos', format: 'GROUPS', scoringModelId: 'sm_ef_padrao', config: cfg({ groupCount: 2, groupMode: 'DUEL' }), qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, tiebreakers: DUEL_TB, seeding: 'RANDOM' },
            { name: 'Semifinais e final', format: 'SINGLE_ELIM', scoringModelId: 'sm_ef_padrao', config: cfg({ bestOf: 1, thirdPlace: true }), qualification: null, tiebreakers: DUEL_TB, seeding: 'RANKED' },
          ],
        },
      },
    ],
    announcements: [
      {
        id: 'an_1',
        tournamentId: 'tn_copa_ff',
        stageId: null,
        groupId: null,
        authorNickname: 'Camila',
        title: 'Inscrições abertas!',
        body: 'As inscrições da Copa Nova FF estão abertas. Confirme todos os membros do squad para garantir a vaga.',
        createdAt: at(base, -2 * DAY),
      },
      {
        id: 'an_2',
        tournamentId: 'tn_liga_cr',
        stageId: null,
        groupId: null,
        authorNickname: 'Camila',
        title: 'Quartas de final hoje',
        body: 'As quartas começam às 20h. Façam check-in a partir das 19h30.',
        createdAt: at(base, -3 * HOUR),
      },
    ],
    follows: [{ userId: DEMO_USERS.participant, targetType: 'GAME', targetId: 'g_8ball' }],
    emailTokens: [],
    extra: {},
  };
  seedCompetition(seeded, base);
  return seeded;
}
