import type { ExtraStatField } from '@nova/schemas';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScoreInput, type ScoreSubmit } from './ScoreInput';
import { duelMatch } from './testing';

const PENALTIES: ExtraStatField[] = [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }];

function setup(props: Partial<Parameters<typeof ScoreInput>[0]> = {}) {
  const onSubmit = vi.fn<(input: ScoreSubmit) => void>();
  render(<ScoreInput match={duelMatch('Bianca', 'Kaue')} gameSlug="clash-royale" onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup() };
}
const save = () => screen.getByRole('button', { name: 'Salvar resultado' });

describe('ScoreInput', () => {
  it('série MD3: o rótulo é "jogos vencidos" e alguém precisa chegar a 2 vitórias', async () => {
    const { user, onSubmit } = setup();
    const bianca = screen.getByRole('textbox', { name: 'Jogos vencidos de Bianca' });
    const kaue = screen.getByRole('textbox', { name: 'Jogos vencidos de Kaue' });
    expect(screen.getByText(/Série MD3: vence quem fizer 2 jogos/)).toBeInTheDocument();

    await user.type(bianca, '1');
    await user.type(kaue, '1');
    expect(screen.getByRole('alert')).toHaveTextContent('Ninguém chegou a 2 vitórias ainda');
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(bianca);
    await user.type(bianca, '3');
    expect(screen.getByRole('alert')).toHaveTextContent('quem vence faz exatamente 2 vitórias');

    await user.clear(bianca);
    await user.type(bianca, '2');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('score-status')).toHaveTextContent('Bianca vence e avança na chave');
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ entries: [{ registrationId: 'r1', score: 2 }, { registrationId: 'r2', score: 1 }], evidenceUrls: [] });
  });

  it('o rótulo do placar segue o jogo em partida única', () => {
    setup({ match: duelMatch('Bianca', 'Kaue', { bestOf: 1 }), gameSlug: 'efootball' });
    expect(screen.getByRole('textbox', { name: 'Gols de Bianca' })).toBeInTheDocument();
  });

  it('pênaltis só aparecem quando o placar empata em partida eliminatória (RN-14)', async () => {
    const { user, onSubmit } = setup({ match: duelMatch('Bianca', 'Kaue', { bestOf: 1 }), gameSlug: 'efootball', extraStatFields: PENALTIES });
    const bianca = screen.getByRole('textbox', { name: 'Gols de Bianca' });
    const kaue = screen.getByRole('textbox', { name: 'Gols de Kaue' });
    await user.type(bianca, '2');
    await user.type(kaue, '1');
    expect(screen.queryByTestId('stat-penalties')).toBeNull();

    await user.clear(kaue);
    await user.type(kaue, '2');
    expect(screen.getByTestId('stat-penalties')).toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled(); // faltam os pênaltis

    await user.type(screen.getByRole('textbox', { name: 'Pênaltis de Bianca' }), '4');
    await user.type(screen.getByRole('textbox', { name: 'Pênaltis de Kaue' }), '5');
    expect(screen.queryByTestId('winner-choice')).toBeNull();
    expect(screen.getByTestId('score-status')).toHaveTextContent('Kaue vence');
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        { registrationId: 'r1', score: 2, stats: { penalties: 4 } },
        { registrationId: 'r2', score: 2, stats: { penalties: 5 } },
      ],
      evidenceUrls: [],
    });
  });

  it('se o desempate também empatar (ou o jogo não tiver desempate), pede o vencedor explicitamente', async () => {
    const { user, onSubmit } = setup({ match: duelMatch('Bianca', 'Kaue', { bestOf: 1 }), gameSlug: 'outro' });
    await user.type(screen.getByRole('textbox', { name: 'Placar de Bianca' }), '1');
    await user.type(screen.getByRole('textbox', { name: 'Placar de Kaue' }), '1');
    expect(screen.getByTestId('winner-choice')).toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('escolha quem venceu o desempate');
    await user.click(screen.getByRole('radio', { name: 'Kaue' }));
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ entries: [{ registrationId: 'r1', score: 1 }, { registrationId: 'r2', score: 1 }], winnerRegistrationId: 'r2', evidenceUrls: [] });
  });

  it('em grupos (sem chave) o empate é aceito e o desempate não aparece', async () => {
    const { user, onSubmit } = setup({ match: duelMatch('Bianca', 'Kaue', { bestOf: 1, bracket: null, nextMatchId: null }), gameSlug: 'efootball', extraStatFields: PENALTIES });
    await user.type(screen.getByRole('textbox', { name: 'Gols de Bianca' }), '0');
    await user.type(screen.getByRole('textbox', { name: 'Gols de Kaue' }), '0');
    expect(screen.queryByTestId('stat-penalties')).toBeNull();
    expect(screen.queryByTestId('winner-choice')).toBeNull();
    expect(screen.getByTestId('score-status')).toHaveTextContent('Empate');
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ entries: [{ registrationId: 'r1', score: 0 }, { registrationId: 'r2', score: 0 }], evidenceUrls: [] });
  });

  it('placar negativo bloqueia; partida sem os dois lados não mostra formulário', async () => {
    const { user, onSubmit } = setup({ match: duelMatch('Bianca', 'Kaue', { bestOf: 1 }) });
    await user.type(screen.getByRole('textbox', { name: 'Coroas de Bianca' }), '-1');
    await user.type(screen.getByRole('textbox', { name: 'Coroas de Kaue' }), '2');
    expect(screen.getByText('O placar não pode ser negativo')).toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
