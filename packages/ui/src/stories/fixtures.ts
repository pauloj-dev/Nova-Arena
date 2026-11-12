/** Dados de exemplo das stories: campeonatos de Free Fire, squads e inscrições. */
import type { Status } from '../components/Badge';

export interface SquadRow {
  id: string;
  name: string;
  tag: string;
  captain: string;
  members: number;
  booyahs: number;
  kills: number;
  points: number;
  status: Status;
}

export const squads: SquadRow[] = [
  { id: 'sq-01', name: 'Fúria Nordestina', tag: 'FNE', captain: 'Rafaela Monteiro', members: 4, booyahs: 3, kills: 47, points: 118, status: 'CONFIRMED' },
  { id: 'sq-02', name: 'Tropa do Rush', tag: 'TDR', captain: 'Caio Ferraz', members: 4, booyahs: 2, kills: 52, points: 109, status: 'CONFIRMED' },
  { id: 'sq-03', name: 'Los Brabos', tag: 'LBR', captain: 'Thiago Antunes', members: 4, booyahs: 1, kills: 39, points: 87, status: 'CONFIRMED' },
  { id: 'sq-04', name: 'Vila Sniper', tag: 'VSN', captain: 'Júlia Paiva', members: 3, booyahs: 1, kills: 31, points: 74, status: 'PENDING_MEMBERS' },
  { id: 'sq-05', name: 'Capa Global', tag: 'CPG', captain: 'Enzo Lacerda', members: 4, booyahs: 0, kills: 28, points: 61, status: 'PENDING_APPROVAL' },
  { id: 'sq-06', name: 'Quebrada E-Sports', tag: 'QBD', captain: 'Larissa Duarte', members: 4, booyahs: 0, kills: 22, points: 49, status: 'WAITLIST' },
  { id: 'sq-07', name: 'Bermuda Kings', tag: 'BMK', captain: 'Pedro Sampaio', members: 4, booyahs: 0, kills: 17, points: 38, status: 'CONFIRMED' },
  { id: 'sq-08', name: 'Zona Segura', tag: 'ZSG', captain: 'Marina Coelho', members: 2, booyahs: 0, kills: 9, points: 21, status: 'WITHDRAWN' },
  { id: 'sq-09', name: 'Kalahari Squad', tag: 'KLH', captain: 'Bruno Teixeira', members: 4, booyahs: 0, kills: 6, points: 14, status: 'DISQUALIFIED' },
];

export const tournament = {
  name: 'Copa Booyah de Verão',
  game: 'Free Fire',
  mode: 'Battle Royale · Squad',
  slots: 48,
  registered: 37,
  prize: 'R$ 5.000',
  startsAt: 'sábado, 17/01, às 19h',
};

export const gameOptions = [
  { value: 'free-fire', label: 'Free Fire' },
  { value: 'cod-mobile', label: 'Call of Duty: Mobile' },
  { value: '8-ball', label: '8 Ball Pool' },
  { value: 'clash-royale', label: 'Clash Royale' },
  { value: 'efootball', label: 'eFootball Mobile', disabled: true },
];

export const wizardSteps = [
  { id: 'jogo', label: 'Jogo', description: 'Free Fire, modo Battle Royale' },
  { id: 'formato', label: 'Formato', description: 'Squads de 4, até 48 vagas' },
  { id: 'fases', label: 'Fases', description: 'Classificatória e final' },
  { id: 'pontuacao', label: 'Pontuação', description: 'Pontos por colocação e por kill' },
  { id: 'regras', label: 'Regras', description: 'Check-in, W.O. e disputas' },
  { id: 'premiacao', label: 'Premiação', description: 'Divisão entre os três primeiros' },
  { id: 'revisao', label: 'Revisão', description: 'Confira tudo antes de publicar' },
];
