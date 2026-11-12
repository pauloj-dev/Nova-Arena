import { describe, expect, it } from 'vitest';
import { needsOnboarding, onboardingSteps } from './FirstSteps';

const t = (status: 'DRAFT' | 'REGISTRATION_OPEN' | 'FINISHED', access: 'OWNER' | 'CO_ORGANIZER' = 'OWNER') => ({ status, access });

describe('onboarding do organizador (issue #62)', () => {
  it('aparece para quem ainda não publicou nenhum campeonato próprio', () => {
    expect(needsOnboarding([])).toBe(true);
    expect(needsOnboarding([t('DRAFT')])).toBe(true);
    // Ser co-organizador do campeonato de outra pessoa não conta como "já publiquei".
    expect(needsOnboarding([t('REGISTRATION_OPEN', 'CO_ORGANIZER')])).toBe(true);
    expect(needsOnboarding([t('DRAFT'), t('FINISHED')])).toBe(false);
  });

  it('marca cada passo pelo que a conta já tem', () => {
    const fresh = onboardingSteps({ hasBio: false, hasAvatar: false, tournaments: [], sawTemplates: false });
    expect(fresh.map((s) => [s.id, s.done])).toEqual([['perfil', false], ['modelo', false], ['publicar', false]]);

    const drafting = onboardingSteps({ hasBio: true, hasAvatar: false, tournaments: [t('DRAFT')], sawTemplates: false });
    expect(drafting.map((s) => s.done)).toEqual([true, true, false]);

    expect(onboardingSteps({ hasBio: false, hasAvatar: true, tournaments: [], sawTemplates: true }).map((s) => s.done)).toEqual([true, true, false]);
    expect(onboardingSteps({ hasBio: false, hasAvatar: false, tournaments: [t('REGISTRATION_OPEN')], sawTemplates: false }).at(-1)?.done).toBe(true);
  });

  it('o assistente fica a no máximo 2 cliques: os passos pendentes levam direto para /organizador/novo', () => {
    const steps = onboardingSteps({ hasBio: true, hasAvatar: true, tournaments: [], sawTemplates: false });
    expect(steps.filter((s) => !s.done).map((s) => s.href)).toEqual(['/organizador/novo', '/organizador/novo']);
  });
});
