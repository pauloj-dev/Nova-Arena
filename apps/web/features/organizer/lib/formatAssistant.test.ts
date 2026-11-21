import type { Game, GameMode } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { validateStages } from '../validation';
import { defaultStage } from './formats';
import { BR_DROP_MINUTES, DUEL_GAME_MINUTES, estimateStages, formatDuration, ROUND_GAP_MINUTES, stageRounds, suggestFormats } from './formatAssistant';

const games = buildSeed().games;
const game = (id: string) => games.find((g) => g.id === id) as Game;
const mode = (g: Game, id: string) => g.modes.find((m) => m.id === id) as GameMode;
const ff = game('g_freefire');
const ffSquad = mode(ff, 'm_ff_squad');
const cr = game('g_clashroyale');
const cr1v1 = mode(cr, 'm_cr_1v1');

const HOUR = 60;

describe('estimativa de duração', () => {
  it('mata-mata de 16 em jogo único: 4 rodadas de 10 min + 3 intervalos', () => {
    const stage = defaultStage('SINGLE_ELIM', { game: cr, mode: cr1v1, userId: null }, { isLast: true });
    const md1 = { ...stage, config: { ...stage.config, bestOf: 1 as const } };
    expect(stageRounds(md1, 16)).toBe(4);
    expect(estimateStages([md1], 16)).toEqual({ rounds: 4, minutes: 4 * DUEL_GAME_MINUTES + 3 * ROUND_GAP_MINUTES });
    // Inscritos que não são potência de 2 arredondam para cima (byes).
    expect(stageRounds(md1, 17)).toBe(5);
  });

  it('série melhor de 3 multiplica o tempo da rodada', () => {
    const stage = defaultStage('SINGLE_ELIM', { game: cr, mode: cr1v1, userId: null }, { isLast: true });
    const md3 = { ...stage, config: { ...stage.config, bestOf: 3 as const } };
    expect(estimateStages([md3], 8).minutes).toBe(3 * 3 * DUEL_GAME_MINUTES + 2 * ROUND_GAP_MINUTES);
  });

  it('BR conta quedas, com salas em paralelo', () => {
    const stage = defaultStage('BATTLE_ROYALE', { game: ff, mode: ffSquad, userId: null }, { isLast: true });
    expect(estimateStages([{ ...stage, config: { ...stage.config, drops: 3 } }], 12).minutes).toBe(3 * BR_DROP_MINUTES + 2 * ROUND_GAP_MINUTES);
  });

  it('pontos corridos com número ímpar tem uma rodada de folga a mais', () => {
    const rr = defaultStage('ROUND_ROBIN', { game: cr, mode: cr1v1, userId: null }, { isLast: true });
    expect(stageRounds(rr, 6)).toBe(5);
    expect(stageRounds(rr, 5)).toBe(5);
  });

  it('formata a duração em horas e minutos', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(155)).toBe('2 h 35 min');
  });
});

describe('sugestões de formato', () => {
  it('sem jogo, modo ou inscritos suficientes não sugere nada', () => {
    expect(suggestFormats({ entrants: 16, availableMinutes: 120, game: null, mode: null, userId: null })).toEqual([]);
    expect(suggestFormats({ entrants: 1, availableMinutes: 120, game: cr, mode: cr1v1, userId: null })).toEqual([]);
  });

  it('duelo: de 2 a 4 sugestões, todas válidas para as vagas', () => {
    for (const entrants of [4, 8, 16, 32, 64, 100]) {
      const list = suggestFormats({ entrants, availableMinutes: 6 * HOUR, game: cr, mode: cr1v1, userId: null });
      expect(list.length, `${entrants} inscritos`).toBeGreaterThanOrEqual(2);
      expect(list.length).toBeLessThanOrEqual(4);
      for (const s of list) {
        expect(validateStages(s.stages, { maxParticipants: entrants, game: cr, mode: cr1v1 }), `${s.id} com ${entrants}`).toEqual([]);
        expect(s.estimatedMinutes).toBeGreaterThan(0);
        expect(s.pros.length).toBeGreaterThan(0);
        expect(s.cons.length).toBeGreaterThan(0);
      }
    }
  });

  it('com tempo folgado, todas cabem; as que cabem vêm primeiro', () => {
    const loose = suggestFormats({ entrants: 16, availableMinutes: 10 * HOUR, game: cr, mode: cr1v1, userId: null });
    expect(loose.every((s) => s.fits)).toBe(true);
    const tight = suggestFormats({ entrants: 16, availableMinutes: 60, game: cr, mode: cr1v1, userId: null });
    const firstMiss = tight.findIndex((s) => !s.fits);
    expect(tight[0]?.fits).toBe(true);
    expect(tight[0]?.id).toBe('mata-mata-md1');
    if (firstMiss >= 0) expect(tight.slice(firstMiss).every((s) => !s.fits)).toBe(true);
  });

  it('tempo apertado demais: mostra as mais curtas primeiro, marcadas como fora do tempo', () => {
    const list = suggestFormats({ entrants: 64, availableMinutes: 20, game: cr, mode: cr1v1, userId: null });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((s) => !s.fits)).toBe(true);
    const minutes = list.map((s) => s.estimatedMinutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('poucos inscritos oferece pontos corridos; muitos, grupos e suíço', () => {
    const few = suggestFormats({ entrants: 6, availableMinutes: 10 * HOUR, game: cr, mode: cr1v1, userId: null }).map((s) => s.id);
    expect(few).toContain('pontos-corridos');
    const many = suggestFormats({ entrants: 32, availableMinutes: 10 * HOUR, game: cr, mode: cr1v1, userId: null }).map((s) => s.id);
    expect(many).toEqual(expect.arrayContaining(['grupos-mata-mata', 'suico']));
    expect(many).not.toContain('pontos-corridos');
  });

  it('Battle Royale que cabe numa sala: sala única com 3 ou 6 quedas', () => {
    const list = suggestFormats({ entrants: 12, availableMinutes: 3 * HOUR, game: ff, mode: ffSquad, userId: null });
    expect(list.map((s) => s.id)).toEqual(['sala-unica-3', 'sala-unica-6']);
    expect(list.every((s) => s.stages.every((st) => st.format === 'BATTLE_ROYALE'))).toBe(true);
  });

  it('Battle Royale com várias salas: grupos + Grande Final, válidos', () => {
    for (const entrants of [24, 48, 100]) {
      const list = suggestFormats({ entrants, availableMinutes: 5 * HOUR, game: ff, mode: ffSquad, userId: null });
      expect(list.length, `${entrants} equipes`).toBeGreaterThanOrEqual(2);
      for (const s of list) {
        expect(s.stages).toHaveLength(2);
        expect(validateStages(s.stages, { maxParticipants: entrants, game: ff, mode: ffSquad })).toEqual([]);
      }
      // A versão curta é mais rápida que a completa.
      const full = list.find((s) => s.id === 'grupos-final');
      const short = list.find((s) => s.id === 'grupos-final-curto');
      expect(short && full && short.estimatedMinutes < full.estimatedMinutes).toBe(true);
    }
  });
});
