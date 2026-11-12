import type { StandingRow } from '@nova/schemas';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StandingsContent } from '../StandingsTab';
import { brStandingsFixture, duelStandingsFixture, regId } from '../test/fixtures';
import { BRDropTable, dropRows } from './BRDropTable';
import { StandingsTable } from './StandingsTable';

const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').filter((r) => r.hasAttribute('data-flip-key'));

describe('BRDropTable', () => {
  it('48 squads: uma linha por squad em cada sala, colunas Pos, Squad, Booyahs, Kills, Pts', () => {
    const s = brStandingsFixture(48);
    expect(s.groups).toHaveLength(4);
    render(<StandingsContent standings={s} tournament={{ participantType: 'TEAM' }} />);
    const tables = screen.getAllByRole('table');
    // 4 salas + geral, todas na aba "Acumulado".
    expect(tables).toHaveLength(5);
    const geral = screen.getByRole('table', { name: 'Classificação geral — acumulado' });
    expect(bodyRows(geral)).toHaveLength(48);
    const headers = within(geral)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Pos', 'Squad', 'Booyahs', 'Kills', 'Pts', 'Detalhes']);
  });

  it('zona de classificação com ícone e texto, não só cor', () => {
    const s = brStandingsFixture(12, { qualify: 4 });
    render(<BRDropTable rows={s.overall} caption="Sala A" />);
    const table = screen.getByRole('table', { name: 'Sala A — acumulado' });
    // Texto para leitor de tela: na posição comum ou no nome do botão de desempate.
    const zone = bodyRows(table).filter((r) => within(r).queryByText(/zona de classificação/) || within(r).queryByRole('button', { name: /zona de classificação/ }));
    expect(zone).toHaveLength(4);
    expect(screen.getAllByText('Zona de classificação: avança para a próxima fase').length).toBeGreaterThan(0);
  });

  it('por queda: ordena pela colocação naquela queda', async () => {
    const user = userEvent.setup();
    const s = brStandingsFixture(12, { drops: 3 });
    render(<BRDropTable rows={s.overall} caption="Sala A" />);
    await user.click(screen.getByRole('tab', { name: 'Queda 2' }));
    const table = screen.getByRole('table', { name: 'Sala A — queda 2' });
    const positions = bodyRows(table).map((r) => Number(within(r).getAllByRole('cell')[0]!.textContent));
    expect(positions).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('quem faltou à queda vai para o fim como ausente', () => {
    const s = brStandingsFixture(12, { drops: 2 });
    const rows: StandingRow[] = s.overall.map((r, i) => (i === 0 ? { ...r, perDrop: r.perDrop.map((d) => (d.dropIndex === 1 ? { ...d, placement: null, kills: 0, points: 0 } : d)) } : r));
    const drop1 = dropRows(rows, 1);
    expect(drop1[drop1.length - 1]).toMatchObject({ key: rows[0]!.registrationId, position: null, out: 'ausente' });
  });
});

describe('StandingsTable', () => {
  const s = duelStandingsFixture(8);
  const group = s.groups[0]!;

  it('desktop: Pos, Equipe, J, V, E, D, Saldo, Pts', () => {
    render(<StandingsTable rows={group.rows} caption="Grupo A" />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Pos', 'Equipe', 'J', 'V', 'E', 'D', 'Saldo', 'Pts', 'Detalhes']);
  });

  it('celular: a linha expansível mostra os números que não cabem', async () => {
    const user = userEvent.setup();
    render(<StandingsTable rows={group.rows} caption="Grupo A" />);
    const first = group.rows[0]!;
    const toggle = screen.getByRole('button', { name: `Ver detalhes de ${first.name}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(detail).not.toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(detail).toBeVisible();
    expect(within(detail).getByText('Vitórias')).toBeInTheDocument();
  });

  it('tocar na posição explica o desempate', async () => {
    const user = userEvent.setup();
    const rows: StandingRow[] = group.rows.map((r, i) => (i === 1 ? { ...r, tiebreakNote: 'Empatou em pontos com Squad Eco e ficou à frente pelo saldo (+2 contra 0).' } : r));
    render(<StandingsTable rows={rows} caption="Grupo A" />);
    await user.click(screen.getByRole('button', { name: /^2º lugar.*Ver como foi o desempate$/ }));
    expect(await screen.findByText(/ficou à frente pelo saldo/)).toBeInTheDocument();
  });

  it('destaca a linha do participante logado', () => {
    render(<StandingsTable rows={group.rows} caption="Grupo A" highlightRegistrationId={regId(0)} />);
    const row = screen.getAllByRole('row').find((r) => r.getAttribute('aria-current') === 'true')!;
    expect(within(row).getByText('Você')).toBeInTheDocument();
  });

  it('sem resultados: estado vazio', () => {
    render(<StandingsContent standings={{ ...s, overall: [], groups: [] }} tournament={{ participantType: 'SOLO' }} />);
    expect(screen.getByText('A classificação ainda não começou')).toBeInTheDocument();
  });
});
