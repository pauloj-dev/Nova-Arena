import type { TournamentSummary } from '@nova/schemas';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { slotsText, TournamentCard } from './TournamentCard';

const base: TournamentSummary = {
  id: 'tn_1',
  slug: 'copa-nova-ff-squad',
  name: 'Copa Nova FF — Squad',
  gameId: 'g_freefire',
  gameModeId: 'm_ff_squad',
  ownerId: 'u_camila',
  status: 'REGISTRATION_OPEN',
  participantType: 'TEAM',
  maxParticipants: 48,
  registrationOpensAt: null,
  registrationClosesAt: null,
  startsAt: '2026-11-14T23:00:00.000Z',
  bannerUrl: null,
  featured: true,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  gameName: 'Free Fire',
  gameIcon: '🔥',
  modeName: 'Squad',
  organizerNickname: 'Camila',
  organizerVerified: true,
  takenSlots: 12,
  free: true,
};

describe('slotsText', () => {
  it('diz quantas vagas sobram, a última e quando esgotou', () => {
    expect(slotsText(12, 48)).toBe('36 vagas livres');
    expect(slotsText(47, 48)).toBe('Última vaga');
    expect(slotsText(48, 48)).toBe('Vagas esgotadas');
    expect(slotsText(50, 48)).toBe('Vagas esgotadas');
  });
});

describe('TournamentCard', () => {
  it('é um link único para a página do campeonato', () => {
    render(<TournamentCard tournament={base} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/c/copa-nova-ff-squad');
  });

  it('mostra jogo, modo, nome, data com fuso, vagas, status, selo e "Gratuito"', () => {
    render(<TournamentCard tournament={base} />);
    expect(screen.getByText('Free Fire')).toBeInTheDocument();
    expect(screen.getByText('Equipe · Squad')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Copa Nova FF — Squad' })).toBeInTheDocument();
    expect(screen.getByText(/Começa .*14\/11.*horário de/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '48');
    expect(screen.getByText('36 vagas livres')).toBeInTheDocument();
    expect(screen.getByText('Inscrições abertas')).toBeInTheDocument();
    expect(screen.getByText('Verificado')).toBeInTheDocument();
    expect(screen.getByText('Gratuito')).toBeInTheDocument();
  });

  it('solo sem data, organizador não verificado e campeonato pago', () => {
    render(<TournamentCard tournament={{ ...base, participantType: 'SOLO', modeName: '1v1', startsAt: null, organizerVerified: false, free: false }} headingLevel="h2" />);
    expect(screen.getByText('Solo · 1v1')).toBeInTheDocument();
    expect(screen.getByText('Data de início a definir')).toBeInTheDocument();
    expect(screen.queryByText('Verificado')).not.toBeInTheDocument();
    expect(screen.queryByText('Gratuito')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});
