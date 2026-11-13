import { describe, expect, it } from 'vitest';
import { canTransition, TournamentStatus } from '@nova/schemas';
import { inGroup, lifecycleActions, type LifecycleAction } from './status';

describe('ações do ciclo de vida por estado (PRD §8.3)', () => {
  it('só oferece as transições permitidas pela máquina de estados', () => {
    expect(lifecycleActions('DRAFT')).toEqual([]);
    expect(lifecycleActions('PUBLISHED')).toEqual(['open-registration', 'cancel']);
    expect(lifecycleActions('REGISTRATION_OPEN')).toEqual(['close-registration', 'cancel']);
    expect(lifecycleActions('REGISTRATION_CLOSED')).toEqual(['start', 'cancel']);
    expect(lifecycleActions('CHECK_IN')).toEqual(['start', 'cancel']);
    expect(lifecycleActions('IN_PROGRESS')).toEqual(['pause', 'finish']);
    expect(lifecycleActions('PAUSED')).toEqual(['resume', 'cancel']);
    expect(lifecycleActions('FINISHED')).toEqual(['archive']);
    expect(lifecycleActions('ARCHIVED')).toEqual([]);
    expect(lifecycleActions('CANCELLED')).toEqual([]);
  });

  it('nenhuma ação leva a um estado fora do diagrama', () => {
    const target: Record<LifecycleAction, TournamentStatus> = {
      'open-registration': 'REGISTRATION_OPEN',
      'close-registration': 'REGISTRATION_CLOSED',
      start: 'IN_PROGRESS',
      resume: 'IN_PROGRESS',
      pause: 'PAUSED',
      finish: 'FINISHED',
      archive: 'ARCHIVED',
      cancel: 'CANCELLED',
    };
    for (const status of TournamentStatus.options) {
      for (const action of lifecycleActions(status)) expect(canTransition(status, target[action]), `${status} → ${action}`).toBe(true);
    }
    // Em andamento não cancela direto (é preciso pausar antes) e pausado não encerra.
    expect(lifecycleActions('IN_PROGRESS')).not.toContain('cancel');
    expect(lifecycleActions('PAUSED')).not.toContain('finish');
    expect(lifecycleActions('PAUSED')).not.toContain('pause');
  });

  it('agrupa os estados nas abas de Meus campeonatos', () => {
    expect(inGroup('DRAFT', 'draft')).toBe(true);
    expect(inGroup('DRAFT', 'active')).toBe(false);
    expect(inGroup('PAUSED', 'active')).toBe(true);
    expect(inGroup('ARCHIVED', 'finished')).toBe(true);
    expect(inGroup('CANCELLED', 'cancelled')).toBe(true);
    expect(inGroup('CANCELLED', 'all')).toBe(true);
  });
});
