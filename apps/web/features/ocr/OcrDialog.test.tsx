import type { Rule } from '@nova/engine';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRDropForm, type BRDropSubmit } from '@/features/organizer/operation/results/BRDropForm';
import { lobbyMatch, polyfillResizeObserver } from '@/features/organizer/operation/results/testing';
import { OcrDialog } from './OcrDialog';
import { linesFromText } from './parse';
import type { Recognizer } from './recognize';

polyfillResizeObserver();
vi.setConfig({ testTimeout: 30_000 });

const print = () => new File([new Uint8Array([137, 80, 78, 71])], 'print-queda.png', { type: 'image/png' });
const fake =
  (text: string, confidence = 92): Recognizer =>
  async (_image, onProgress) => {
    onProgress?.(0.5, 'Lendo o print');
    return { text, lines: linesFromText(text, confidence), confidence };
  };

const RULES: Rule[] = [
  { type: 'PER_UNIT', stat: 'kills', points: 1 },
  { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
];

beforeEach(() => localStorage.clear());

describe('OcrDialog', () => {
  const candidates = [
    { registrationId: 'r1', name: 'Squad Alfa', tag: 'ALF' },
    { registrationId: 'r2', name: 'Squad Bravo', tag: 'BRV' },
    { registrationId: 'r3', name: 'Squad Charlie', tag: 'CHL' },
  ];

  it('lê, mostra cada valor com a situação (ícone + texto) e só aplica o que ficou marcado', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<OcrDialog open onClose={() => undefined} kind="drop" candidates={candidates} onApply={onApply} recognize={fake('#1 Squad Bravo 9\n#2 Squad Alfa 4\nZulu 3 3', 92)} />);
    expect(screen.getByRole('button', { name: 'Ler o print' })).toBeDisabled();
    await user.upload(screen.getByLabelText('Escolher imagem do print'), print());
    expect(screen.getByText('print-queda.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ler o print' }));

    const review = await screen.findByTestId('ocr-review');
    const bravo = within(review).getAllByTestId('ocr-row').find((r) => r.dataset.registration === 'r2') as HTMLElement;
    expect(within(bravo).getByText('Lido do print')).toBeInTheDocument();
    expect(within(bravo).getByText('Linha lida: “#1 Squad Bravo 9”')).toBeInTheDocument();
    const charlie = within(review).getAllByTestId('ocr-row').find((r) => r.dataset.registration === 'r3') as HTMLElement;
    expect(within(charlie).getByText('Não encontrado no print')).toBeInTheDocument();
    expect(screen.getByText('Linhas que não reconhecemos (1)')).toBeInTheDocument();

    // Corrige as kills do Alfa e desmarca o Bravo.
    const alfaKills = screen.getByRole('textbox', { name: 'Kills lida de Squad Alfa' });
    await user.clear(alfaKills);
    await user.type(alfaKills, '5');
    await user.click(within(bravo).getByRole('checkbox', { name: 'Usar' }));
    await user.click(screen.getByRole('button', { name: 'Usar estes valores' }));
    expect(onApply).toHaveBeenCalledWith({ r1: { placement: 2, kills: 5 } });
  });

  it('leitura falhou: explica e deixa tentar de novo', async () => {
    const user = userEvent.setup();
    render(<OcrDialog open onClose={() => undefined} kind="drop" candidates={candidates} onApply={vi.fn()} recognize={() => Promise.reject(new Error('rede'))} />);
    await user.upload(screen.getByLabelText('Escolher imagem do print'), print());
    await user.click(screen.getByRole('button', { name: 'Ler o print' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler esta imagem');
    expect(screen.getByRole('button', { name: 'Ler o print' })).toBeEnabled();
  });

  it('duelo: placar "2 x 1" vai para cada lado', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <OcrDialog
        open
        onClose={() => undefined}
        kind="duel"
        bestOf={3}
        candidates={[
          { registrationId: 'a', name: 'BiancaGG', tag: null },
          { registrationId: 'b', name: 'LucasPro', tag: null },
        ]}
        onApply={onApply}
        recognize={fake('LucasPro 1 x 2 BiancaGG')}
      />,
    );
    await user.upload(screen.getByLabelText('Escolher imagem do print'), print());
    await user.click(screen.getByRole('button', { name: 'Ler o print' }));
    await user.click(await screen.findByRole('button', { name: 'Usar estes valores' }));
    expect(onApply).toHaveBeenCalledWith({ a: { score: 2 }, b: { score: 1 } });
  });
});

describe('BRDropForm com a leitura do print', () => {
  function setup(recognize: Recognizer) {
    const onSubmit = vi.fn<(input: BRDropSubmit) => void>();
    render(<BRDropForm match={lobbyMatch(['Squad Alfa', 'Squad Bravo', 'Squad Charlie'])} rules={RULES} dropCount={3} onSubmit={onSubmit} ocrEnabled recognize={recognize} />);
    return { onSubmit, user: userEvent.setup() };
  }

  it('sem a flag, não há botão', () => {
    render(<BRDropForm match={lobbyMatch(['Squad Alfa'])} rules={RULES} dropCount={1} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Ler o print' })).not.toBeInTheDocument();
  });

  it('preenche, marca "lido do print" e só valida depois da conferência', async () => {
    const { user, onSubmit } = setup(fake('1 Squad Charlie 8\n2 Squad Alfa 3\n3 Squad Bravo 1'));
    await user.click(screen.getByRole('button', { name: 'Ler o print' }));
    await user.upload(screen.getByLabelText('Escolher imagem do print'), print());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ler o print' }));
    await user.click(await screen.findByRole('button', { name: 'Usar estes valores' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Colocação de Squad Charlie' })).toHaveValue('1');
    expect(screen.getByRole('textbox', { name: 'Kills de Squad Charlie' })).toHaveValue('8');
    expect(screen.getAllByTestId('ocr-mark')).toHaveLength(6);

    // Nada sai sem a conferência.
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Marque que conferiu os valores lidos do print antes de validar.');
    expect(screen.getByRole('checkbox', { name: 'Conferi os valores lidos do print' })).toHaveFocus();

    // Alterar um valor tira a marca dele.
    const bravoKills = screen.getByRole('textbox', { name: 'Kills de Squad Bravo' });
    await user.clear(bravoKills);
    await user.type(bravoKills, '2');
    expect(screen.getAllByTestId('ocr-mark')).toHaveLength(5);

    await user.click(screen.getByRole('checkbox', { name: 'Conferi os valores lidos do print' }));
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        { registrationId: 'r1', placement: 2, kills: 3 },
        { registrationId: 'r2', placement: 3, kills: 2 },
        { registrationId: 'r3', placement: 1, kills: 8 },
      ],
      evidenceUrls: [],
    });
  });
});
