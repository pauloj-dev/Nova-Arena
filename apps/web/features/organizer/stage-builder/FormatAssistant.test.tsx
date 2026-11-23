import type { Game, GameMode, StageInput } from '@nova/schemas';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { FormatAssistant } from './FormatAssistant';

const games = buildSeed().games;
const cr = games.find((g) => g.id === 'g_clashroyale') as Game;
const cr1v1 = cr.modes.find((m) => m.id === 'm_cr_1v1') as GameMode;

function setup(hasStages = false) {
  const onApply = vi.fn<(stages: StageInput[]) => void>();
  render(<FormatAssistant game={cr} mode={cr1v1} userId={null} maxParticipants={16} hasStages={hasStages} onApply={onApply} />);
  return { onApply, user: userEvent.setup() };
}

describe('FormatAssistant', () => {
  it('mostra sugestões com duração e se cabem no tempo (ícone + texto)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Sugerir formato' }));
    const dialog = screen.getByRole('dialog', { name: 'Sugerir formato' });
    expect(within(dialog).getByLabelText(/Inscritos/)).toHaveValue(16);
    const cards = within(dialog).getAllByTestId('format-suggestion');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(4);
    expect(within(cards[0] as HTMLElement).getByText(/Cerca de/)).toBeInTheDocument();
    expect(within(dialog).getAllByText('Cabe no tempo').length).toBeGreaterThan(0);

    // Com 1 hora, algumas passam do tempo.
    await user.selectOptions(within(dialog).getByLabelText('Tempo disponível'), '60');
    expect(within(dialog).getAllByText('Passa do tempo').length).toBeGreaterThan(0);
  });

  it('sem fases, aplica direto', async () => {
    const { user, onApply } = setup(false);
    await user.click(screen.getByRole('button', { name: 'Sugerir formato' }));
    await user.click(screen.getByRole('button', { name: 'Usar este formato: Mata-mata em jogo único' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0][0]?.format).toBe('SINGLE_ELIM');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('com fases já montadas, pede confirmação antes de substituir', async () => {
    const { user, onApply } = setup(true);
    await user.click(screen.getByRole('button', { name: 'Sugerir formato' }));
    await user.click(screen.getByRole('button', { name: 'Usar este formato: Mata-mata em jogo único' }));
    expect(onApply).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Substituir as fases?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(onApply).not.toHaveBeenCalled();
    // Volta para a lista.
    await user.click(screen.getByRole('button', { name: 'Usar este formato: Mata-mata em jogo único' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Substituir as fases?' })).getByRole('button', { name: 'Substituir fases' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
