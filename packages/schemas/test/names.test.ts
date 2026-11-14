/** Filtro de nomes ofensivos e reservados (issue #72). */
import { describe, expect, it } from 'vitest';
import { nameBlockReason, NewNickname, RegisterInput, TeamInput } from '../src';

describe('filtro de nomes', () => {
  it('barra palavrão, inclusive disfarçado com números ou junto de outra palavra', () => {
    for (const name of ['porra', 'P0rr4', 'PutaMerda', 'merda_99', 'caralhoGamer', 'xXbucetaXx', 'Hitler88']) {
      expect(nameBlockReason(name), name).toMatch(/não é permitido/);
    }
  });

  it('não barra nome inocente que contém uma palavra curta no meio', () => {
    for (const name of ['Computador', 'Disputa', 'Cupido', 'Escuro', 'Bianca', 'NovaJogadora', 'Lucas_FF', 'kkkGamer', 'Arena7', 'BrunoPro7']) {
      expect(nameBlockReason(name), name).toBeNull();
    }
  });

  it('barra quem tenta se passar pela equipe da Nova Arena', () => {
    for (const name of ['admin', 'Admin_01', 'NovaArenaOficial', 'Suporte', 'moderador', 'Staff']) {
      expect(nameBlockReason(name), name).toMatch(/reservado/);
    }
  });

  it('squad pode ter "Arena" no nome, mas não palavrão nem "Nova Arena"', () => {
    expect(nameBlockReason('Arena Kings', 'team')).toBeNull();
    expect(nameBlockReason('Staff FC', 'team')).toBeNull();
    expect(nameBlockReason('Nova Arena FC', 'team')).toMatch(/reservado/);
    expect(nameBlockReason('Os Merda', 'team')).toMatch(/não é permitido/);
    expect(nameBlockReason('ADM', 'tag')).toMatch(/reservado/);
  });

  it('vale no cadastro, na edição do apelido e no squad (mensagem no campo)', () => {
    const reg = RegisterInput.safeParse({ email: 'a@exemplo.com', nickname: 'Admin', password: 'senha-boa-1', birthDate: '2000-01-01', acceptTerms: true });
    expect(reg.success).toBe(false);
    expect(reg.error?.issues.find((i) => i.path[0] === 'nickname')?.message).toMatch(/reservado/);
    expect(NewNickname.safeParse('Bianca').success).toBe(true);
    const team = TeamInput.safeParse({ name: 'Os Merda', tag: 'OSM' });
    expect(team.error?.issues[0]?.message).toMatch(/não é permitido/);
  });
});
