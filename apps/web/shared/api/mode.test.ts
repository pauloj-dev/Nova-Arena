import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from '@/features/auth/oauthErrors';
import { oauthStartUrl } from './hooks/login-methods';
import { isModuleMocked } from './mode';

describe('módulos simulados', () => {
  it('all simula tudo, none nada, lista só os citados', () => {
    expect(isModuleMocked('auth', 'all')).toBe(true);
    expect(isModuleMocked('auth', 'none')).toBe(false);
    expect(isModuleMocked('auth', 'games, auth')).toBe(true);
    expect(isModuleMocked('auth', 'games')).toBe(false);
  });
});

describe('login social na tela', () => {
  it('monta o endereço de início com next e modo vincular', () => {
    expect(oauthStartUrl('google')).toBe('/api/v1/auth/oauth/google');
    expect(oauthStartUrl('google', { next: '/' })).toBe('/api/v1/auth/oauth/google');
    expect(oauthStartUrl('discord', { next: '/campeonatos?jogo=efootball' })).toBe('/api/v1/auth/oauth/discord?next=%2Fcampeonatos%3Fjogo%3Defootball');
    expect(oauthStartUrl('discord', { mode: 'link' })).toBe('/api/v1/auth/oauth/discord?mode=link');
  });

  it('todo código de erro vira mensagem para o jogador', () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage('oauth_email_existente')).toMatch(/Já existe uma conta/);
    expect(oauthErrorMessage('codigo_desconhecido')).toBe('Não foi possível entrar. Tente de novo.');
  });
});
