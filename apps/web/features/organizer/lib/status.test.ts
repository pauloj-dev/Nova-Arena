import { describe, expect, it } from 'vitest';
import { inGroup, lifecycleActions } from './status';

describe('ações do ciclo de vida por estado (PRD §8.3)', () => {
  it('só oferece as transições permitidas pela máquina de estados', () => {
    expect(lifecycleActions('DRAFT')).toEqual([]);
    expect(lifecycleActions('PUBLISHED')).toEqual(['open-registration', 'cancel']);
    expect(lifecycleActions('REGISTRATION_OPEN')).toEqual(['close-registration', 'cancel']);
    expect(lifecycleActions('REGISTRATION_CLOSED')).toEqual(['cancel']);
    expect(lifecycleActions('CHECK_IN')).toEqual(['cancel']);
    expect(lifecycleActions('IN_PROGRESS')).toEqual([]);
    expect(lifecycleActions('PAUSED')).toEqual(['cancel']);
    expect(lifecycleActions('FINISHED')).toEqual([]);
    expect(lifecycleActions('ARCHIVED')).toEqual([]);
    expect(lifecycleActions('CANCELLED')).toEqual([]);
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
