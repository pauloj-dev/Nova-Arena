import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditDiff } from './AuditDiff';
import { diffAudit, fieldLabel, formatAuditValue } from './diff';

describe('diffAudit', () => {
  it('classifica cada campo e põe o que mudou primeiro', () => {
    const rows = diffAudit({ ownerId: 'u_camila', responsavel: 'Camila', status: 'PAUSED', antigo: 1 }, { ownerId: 'u_diego', responsavel: 'Diego', status: 'PAUSED', semResponsavel: false });
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ['ownerId', 'changed'],
      ['responsavel', 'changed'],
      ['antigo', 'removed'],
      ['semResponsavel', 'added'],
      ['status', 'same'],
    ]);
    expect(rows[1]).toMatchObject({ label: 'Responsável', before: 'Camila', after: 'Diego' });
    expect(rows[2]).toMatchObject({ before: '1', after: '—' });
    expect(rows[3]).toMatchObject({ label: 'Sem responsável', before: '—', after: 'Não' });
    expect(rows[4]).toMatchObject({ before: 'Pausado', after: 'Pausado' });
  });

  it('aceita antes ou depois vazios (criação e remoção)', () => {
    expect(diffAudit(null, { papel: 'ADMIN', usos: 2 }).map((r) => [r.label, r.before, r.after, r.kind])).toEqual([
      ['Papel', '—', 'Administrador', 'added'],
      ['Usos', '—', '2', 'added'],
    ]);
    expect(diffAudit({ active: true }, undefined)).toEqual([{ key: 'active', label: 'Ativo', before: 'Sim', after: '—', kind: 'removed' }]);
    expect(diffAudit(null, null)).toEqual([]);
  });

  it('compara listas e objetos pelo conteúdo, não pela referência', () => {
    const rows = diffAudit({ papeis: ['ADMIN', 'PARTICIPANT'], jogos: 'todos' }, { papeis: ['ADMIN', 'PARTICIPANT'], jogos: ['Free Fire', 'eFootball'] });
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ['jogos', 'changed'],
      ['papeis', 'same'],
    ]);
    expect(rows[0]?.after).toBe('Free Fire, eFootball');
    expect(rows[1]?.before).toBe('Administrador, Participante');
  });
});

describe('formatAuditValue e fieldLabel', () => {
  it('traduz valores de máquina para texto de gente', () => {
    expect(formatAuditValue(true)).toBe('Sim');
    expect(formatAuditValue(false)).toBe('Não');
    expect(formatAuditValue(null)).toBe('—');
    expect(formatAuditValue([])).toBe('—');
    expect(formatAuditValue(12480)).toBe('12.480');
    expect(formatAuditValue('BANNED')).toBe('Banido');
    expect(formatAuditValue('texto livre')).toBe('texto livre');
    expect(formatAuditValue({ status: 'ACTIVE', featured: true })).toBe('Status: Ativo; Destaque na home: Sim');
  });

  it('mostra data ISO no formato do produto, com o fuso', () => {
    const text = formatAuditValue('2026-11-14T23:00:00.000Z');
    expect(text).toMatch(/\d{2}\/\d{2}/);
    expect(text).not.toContain('T23:00');
  });

  it('usa o rótulo conhecido ou deixa o nome do campo legível', () => {
    expect(fieldLabel('featured')).toBe('Destaque na home');
    expect(fieldLabel('maxActiveTournaments')).toBe('Max active tournaments');
    expect(fieldLabel('algum_campo')).toBe('Algum campo');
  });
});

describe('<AuditDiff />', () => {
  it('mostra antes e depois lado a lado, com o que mudou marcado em texto', () => {
    render(<AuditDiff before={{ responsavel: 'Camila', status: 'PAUSED' }} after={{ responsavel: 'Diego', status: 'PAUSED' }} />);
    const table = screen.getByRole('table', { name: 'Antes e depois, campo a campo' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Campo', 'Antes', 'Depois']);

    const changed = within(table).getByRole('row', { name: /Responsável/ });
    expect(changed).toHaveAttribute('data-kind', 'changed');
    expect(within(changed).getByRole('rowheader')).toHaveTextContent('Responsável');
    expect(within(changed).getByRole('rowheader')).toHaveTextContent('alterado');
    const cells = within(changed).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['Camila', 'Diego']);
    // Semântica de remoção/inserção para leitores de tela.
    expect(cells[0]?.querySelector('del')).not.toBeNull();
    expect(cells[1]?.querySelector('ins')).not.toBeNull();

    const unchanged = within(table).getByRole('row', { name: /Status/ });
    expect(unchanged).toHaveAttribute('data-kind', 'same');
    expect(within(unchanged).getByRole('rowheader')).toHaveTextContent('igual');
    expect(unchanged.querySelector('del, ins')).toBeNull();
    // O que mudou vem antes do que ficou igual.
    const order = within(table).getAllByRole('rowheader').map((h) => h.textContent);
    expect(order[0]).toContain('Responsável');
    expect(order[1]).toContain('Status');
  });

  it('criação: campo novo aparece com "—" no antes', () => {
    render(<AuditDiff before={null} after={{ enabled: false }} />);
    const row = screen.getByRole('row', { name: /Ligado/ });
    expect(row).toHaveAttribute('data-kind', 'added');
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', 'Não']);
    expect(within(row).getByRole('rowheader')).toHaveTextContent('novo');
  });

  it('sem campos, diz isso em vez de mostrar uma tabela vazia', () => {
    render(<AuditDiff before={null} after={null} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Esta ação não registrou campos alterados.')).toBeInTheDocument();
  });
});
