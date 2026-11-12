import type { Rule } from '@nova/engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRDropForm, type BRDropSubmit } from './BRDropForm';
import { loadDropDraft } from './brDrop';
import { lobbyMatch, polyfillResizeObserver } from './testing';

polyfillResizeObserver();

// Modelo padrão do Free Fire (PRD §11.2): 1 ponto por kill + 3 pelo Booyah.
const FF_RULES: Rule[] = [
  { type: 'PER_UNIT', stat: 'kills', points: 1 },
  { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
];

const placement = (name: string) => screen.getByRole('textbox', { name: `Colocação de ${name}` });
const kills = (name: string) => screen.getByRole('textbox', { name: `Kills de ${name}` });
const rowOf = (name: string) => placement(name).closest('[data-testid="drop-row"]') as HTMLElement;
const pointsOf = (name: string) => within(rowOf(name)).getByTestId('drop-points').textContent;

function setup(props: Partial<Parameters<typeof BRDropForm>[0]> = {}) {
  const onSubmit = vi.fn<(input: BRDropSubmit) => void>();
  const match = props.match ?? lobbyMatch(['Squad Alfa', 'Squad Bravo', 'Squad Charlie']);
  render(<BRDropForm match={match} rules={FF_RULES} dropCount={3} onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup() };
}

beforeEach(() => localStorage.clear());

describe('BRDropForm', () => {
  it('CT-01: a prévia usa o motor — Alfa 1º/7 kills = 10, Bravo 2º/9 = 9, Charlie 3º/4 = 4', async () => {
    const { user, onSubmit } = setup();
    expect(pointsOf('Squad Alfa')).toContain('—');
    await user.type(placement('Squad Alfa'), '1');
    await user.type(kills('Squad Alfa'), '7');
    await user.type(placement('Squad Bravo'), '2');
    await user.type(kills('Squad Bravo'), '9');
    await user.type(placement('Squad Charlie'), '3');
    await user.type(kills('Squad Charlie'), '4');
    expect(pointsOf('Squad Alfa')).toContain('10');
    expect(pointsOf('Squad Bravo')).toContain('9');
    expect(pointsOf('Squad Charlie')).toContain('4');

    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    // Só estatísticas brutas: nenhum "points" sai do cliente (RN-01).
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        { registrationId: 'r1', placement: 1, kills: 7 },
        { registrationId: 'r2', placement: 2, kills: 9 },
        { registrationId: 'r3', placement: 3, kills: 4 },
      ],
      evidenceUrls: [],
    });
  });

  it('o multiplicador da queda entra na prévia', async () => {
    const { user } = setup({ match: lobbyMatch(['Squad Alfa', 'Squad Bravo'], { dropIndex: 3, round: 3, roundLabel: 'Queda 3', multiplier: 2 }) });
    await user.type(placement('Squad Alfa'), '1');
    await user.type(kills('Squad Alfa'), '7');
    expect(pointsOf('Squad Alfa')).toContain('20');
    expect(screen.getByTestId('drop-title')).toHaveTextContent('Final BR · Sala 1 · Queda 3 de 3');
  });

  it('colocação repetida é apontada nos dois campos e bloqueia o envio', async () => {
    const { user, onSubmit } = setup();
    await user.type(placement('Squad Alfa'), '1');
    await user.type(kills('Squad Alfa'), '2');
    await user.type(placement('Squad Bravo'), '1');
    await user.type(kills('Squad Bravo'), '3');
    await user.type(placement('Squad Charlie'), '3');
    await user.type(kills('Squad Charlie'), '0');

    expect(placement('Squad Alfa')).toHaveAttribute('aria-invalid', 'true');
    expect(placement('Squad Bravo')).toHaveAttribute('aria-invalid', 'true');
    expect(placement('Squad Charlie')).not.toHaveAttribute('aria-invalid');
    expect(within(rowOf('Squad Alfa')).getByTestId('drop-row-error')).toHaveTextContent('Colocação 1 repetida (também em Squad Bravo)');

    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(placement('Squad Bravo'));
    await user.type(placement('Squad Bravo'), '2');
    expect(placement('Squad Alfa')).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('kills negativas e colocação fora da sala são apontadas no campo e bloqueiam o envio', async () => {
    const { user, onSubmit } = setup();
    await user.type(placement('Squad Alfa'), '1');
    await user.type(kills('Squad Alfa'), '-2');
    await user.type(placement('Squad Bravo'), '7');
    expect(kills('Squad Alfa')).toHaveAttribute('aria-invalid', 'true');
    expect(within(rowOf('Squad Alfa')).getByTestId('drop-row-error')).toHaveTextContent('Kills não podem ser negativas');
    expect(within(rowOf('Squad Bravo')).getByTestId('drop-row-error')).toHaveTextContent('a colocação vai de 1 a 3');
    expect(pointsOf('Squad Alfa')).toContain('—');
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('campo em branco só vira erro ao tentar validar, e o foco vai para o primeiro que falta', async () => {
    const { user, onSubmit } = setup();
    await user.type(placement('Squad Alfa'), '1');
    expect(screen.getByTestId('drop-status')).toHaveTextContent('Faltam 5 campos');
    expect(kills('Squad Alfa')).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(kills('Squad Alfa')).toHaveAttribute('aria-invalid', 'true');
    expect(kills('Squad Alfa')).toHaveFocus();
  });

  it('o foco não é tirado de quem já foi para outro campo depois de um "Validar" recusado', async () => {
    // Regressão: o foco no primeiro erro era agendado para o quadro seguinte e podia cair no meio da digitação.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    try {
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Validar queda' }));
      await user.click(kills('Squad Charlie'));
      for (const cb of frames.splice(0)) cb(performance.now());
      await user.keyboard('5');
      expect(kills('Squad Charlie')).toHaveValue('5');
      expect(placement('Squad Alfa')).toHaveValue('');
    } finally {
      raf.mockRestore();
    }
  });

  it('Tab e Enter avançam célula a célula; as setas sobem e descem na coluna', async () => {
    const { user } = setup();
    placement('Squad Alfa').focus();
    await user.keyboard('1');
    await user.tab();
    expect(kills('Squad Alfa')).toHaveFocus();
    await user.keyboard('7');
    await user.tab();
    expect(placement('Squad Bravo')).toHaveFocus();
    await user.keyboard('2{Enter}');
    expect(kills('Squad Bravo')).toHaveFocus();
    await user.keyboard('9{Enter}');
    expect(placement('Squad Charlie')).toHaveFocus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(kills('Squad Bravo')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(kills('Squad Charlie')).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(kills('Squad Alfa')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(kills('Squad Alfa')).toHaveFocus(); // já está na primeira linha

    // Enter na última célula leva ao botão de validar.
    kills('Squad Charlie').focus();
    await user.keyboard('4{Enter}');
    expect(screen.getByRole('button', { name: 'Validar queda' })).toHaveFocus();
    expect(placement('Squad Alfa')).toHaveAttribute('inputmode', 'numeric');
  });

  it('kills por jogador: a soma precisa bater com as kills da equipe (RN-03)', async () => {
    const members = {
      r1: [
        { userId: 'u1', nickname: 'Kaue' },
        { userId: 'u2', nickname: 'Nina' },
      ],
      r2: [{ userId: 'u3', nickname: 'Leo' }],
    };
    const { user, onSubmit } = setup({ match: lobbyMatch(['Squad Alfa', 'Squad Bravo']), killsPerPlayer: true, members });
    await user.type(placement('Squad Alfa'), '1');
    await user.type(kills('Squad Alfa'), '7');
    await user.type(screen.getByRole('textbox', { name: 'Kills de Kaue (Squad Alfa)' }), '4');
    expect(within(rowOf('Squad Alfa')).getByTestId('drop-row-error')).toHaveTextContent('A soma por jogador (4) precisa ser igual às kills da equipe (7)');
    await user.type(placement('Squad Bravo'), '2');
    await user.type(kills('Squad Bravo'), '0');
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).not.toHaveBeenCalled();
    // O foco vai para o primeiro campo com problema no próprio clique (nunca um quadro depois).
    expect(screen.getByRole('textbox', { name: 'Kills de Kaue (Squad Alfa)' })).toHaveFocus();

    await user.type(screen.getByRole('textbox', { name: 'Kills de Nina (Squad Alfa)' }), '3');
    expect(within(rowOf('Squad Alfa')).queryByTestId('drop-row-error')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        { registrationId: 'r1', placement: 1, kills: 7, playerKills: { u1: 4, u2: 3 } },
        { registrationId: 'r2', placement: 2, kills: 0, playerKills: { u3: 0 } },
      ],
      evidenceUrls: [],
    });
  });

  it('squad ausente não recebe colocação; "preencher colocações na ordem" pula os ausentes', async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByText(/Marcar squad ausente/));
    await user.click(screen.getByRole('checkbox', { name: 'Squad Bravo ausente' }));
    expect(placement('Squad Bravo')).toBeDisabled();
    expect(pointsOf('Squad Bravo')).toContain('0');
    await user.click(screen.getByRole('button', { name: 'Preencher colocações na ordem' }));
    expect(placement('Squad Alfa')).toHaveValue('1');
    expect(placement('Squad Charlie')).toHaveValue('2');
    await user.type(kills('Squad Alfa'), '5');
    await user.type(kills('Squad Charlie'), '1');
    await user.click(screen.getByRole('button', { name: 'Validar queda' }));
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        { registrationId: 'r1', placement: 1, kills: 5 },
        { registrationId: 'r2', absent: true },
        { registrationId: 'r3', placement: 2, kills: 1 },
      ],
      evidenceUrls: [],
    });
  });

  it('ordenar pela colocação reorganiza as linhas', async () => {
    const { user } = setup();
    await user.type(placement('Squad Alfa'), '3');
    await user.type(placement('Squad Bravo'), '1');
    await user.click(screen.getByRole('switch', { name: 'Ordenar pela colocação' }));
    const order = screen.getAllByTestId('drop-row').map((row) => row.getAttribute('data-registration'));
    expect(order).toEqual(['r2', 'r1', 'r3']);
  });

  it('o rascunho fica guardado por partida e volta ao reabrir', async () => {
    const { user } = setup();
    await user.type(placement('Squad Alfa'), '2');
    await user.type(kills('Squad Alfa'), '6');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(screen.getByText(/Rascunho salvo neste aparelho/)).toBeInTheDocument();
    expect(loadDropDraft('fase~g1-q1')?.rows[0]).toMatchObject({ registrationId: 'r1', placement: '2', kills: '6' });

    // "Recarregar": o formulário monta de novo e recupera o que estava salvo.
    document.body.innerHTML = '';
    setup();
    expect(placement('Squad Alfa')).toHaveValue('2');
    expect(kills('Squad Alfa')).toHaveValue('6');
    expect(screen.getByText(/Recuperamos o rascunho/)).toBeInTheDocument();
  });

  it('corrigir um resultado validado exige motivo', async () => {
    const match = lobbyMatch(['Squad Alfa', 'Squad Bravo'], { status: 'VALIDATED' });
    match.participants[0] = { ...match.participants[0]!, placement: 1, kills: 4 };
    match.participants[1] = { ...match.participants[1]!, placement: 2, kills: 1 };
    const { user, onSubmit } = setup({ match, correction: true });
    expect(placement('Squad Alfa')).toHaveValue('1');
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Informe o motivo da correção')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Motivo da correção/ }), 'Print estava invertido');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ correctionReason: 'Print estava invertido' }));
  });
});
