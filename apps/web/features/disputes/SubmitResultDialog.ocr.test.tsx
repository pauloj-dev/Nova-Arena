import { ToastProvider } from '@nova/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { duelMatch, polyfillResizeObserver } from '@/features/organizer/operation/results/testing';
import { linesFromText } from '@/features/ocr/parse';
import type { Recognizer } from '@/features/ocr/recognize';
import { SubmitResultDialog } from './SubmitResultDialog';

polyfillResizeObserver();
vi.setConfig({ testTimeout: 30_000 });

const state = vi.hoisted(() => ({ ocr: true, mutate: vi.fn() }));
vi.mock('@/shared/flags/useFlag', () => ({ useFlag: (key: string) => (key === 'resultOcr' ? state.ocr : true) }));
vi.mock('@/shared/api/hooks/disputes', () => ({ useCreateSubmission: () => ({ mutate: state.mutate, isPending: false }) }));
vi.mock('./useTiebreakField', () => ({ useTiebreakField: () => ({ field: undefined, isLoading: false }) }));
// O print obrigatório: aqui o anexo é imediato (o envio de imagem tem testes próprios).
vi.mock('@/features/evidence/EvidenceUpload', () => ({
  EvidenceUpload: ({ onChange }: { onChange: (urls: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['https://blob.exemplo/print.png'])}>
      Anexar print
    </button>
  ),
}));

const recognize: Recognizer = async () => ({ text: 'Bianca 2 x 0 Lucas', lines: linesFromText('Bianca 2 x 0 Lucas', 95), confidence: 95 });

function setup() {
  const match = duelMatch('Bianca', 'Lucas');
  render(
    <ToastProvider>
      <SubmitResultDialog
        match={match}
        sides={[
          { registrationId: 'r1', name: 'Bianca' },
          { registrationId: 'r2', name: 'Lucas' },
        ]}
        mineRegistrationId="r1"
        onClose={() => undefined}
        recognize={recognize}
      />
    </ToastProvider>,
  );
  return userEvent.setup();
}

describe('envio de resultado com a leitura do print', () => {
  it('sugere o placar, marca os campos e pede conferência antes de enviar', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Ler o print' }));
    const ocr = await screen.findByTestId('ocr-dialog');
    await user.upload(within(ocr).getByLabelText('Escolher imagem do print'), new File([new Uint8Array([1])], 'placar.png', { type: 'image/png' }));
    await user.click(screen.getAllByRole('button', { name: 'Ler o print' }).at(-1) as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Usar estes valores' }));
    await waitFor(() => expect(screen.queryByTestId('ocr-dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('spinbutton', { name: /Placar de Bianca/ })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: /Placar de Lucas/ })).toHaveValue(0);
    expect(screen.getAllByTestId('ocr-mark')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Anexar print' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Marque que conferiu o placar lido do print antes de enviar.')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Conferi os valores lidos do print' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
    expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({ entries: [{ registrationId: 'r1', score: 2 }, { registrationId: 'r2', score: 0 }] });
  });
});
