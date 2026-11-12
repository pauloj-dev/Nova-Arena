import type { CreateRoleInviteInput, RoleInvite } from '@nova/schemas';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteForm } from './InviteForm';

const LINK = 'http://localhost:3000/convite/0123456789abcdef0123456789abcdef0123456789abcdef';

function invite(input: CreateRoleInviteInput): RoleInvite {
  return { id: 'ri_novo', role: input.role, email: input.email ?? null, link: LINK, maxUses: input.maxUses, uses: 0, state: 'VALID', createdByNickname: 'Ana', createdAt: '2026-11-12T12:00:00.000Z', expiresAt: '2026-11-13T12:00:00.000Z' };
}

function setup(onCreate = vi.fn((input: CreateRoleInviteInput) => Promise.resolve(invite(input)))) {
  const user = userEvent.setup();
  render(<InviteForm onCreate={onCreate} />);
  return { user, onCreate };
}

describe('<InviteForm />', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('oferece as três validades e começa em link, administrador, 24 horas e 1 uso', () => {
    setup();
    expect(screen.getByRole('radio', { name: /Link compartilhável/ })).toBeChecked();
    expect(screen.getByLabelText('Papel')).toHaveValue('ADMIN');
    const validity = screen.getByLabelText('Validade');
    expect(validity).toHaveValue('24h');
    expect([...validity.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['1 hora', '24 horas', '7 dias']);
    expect(screen.getByLabelText('Limite de usos')).toHaveValue(1);
    expect(screen.queryByTestId('invite-created')).toBeNull();
  });

  it('envia validade e limite de usos escolhidos e mostra o link completo com botão de copiar', async () => {
    const { user, onCreate } = setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);

    await user.selectOptions(screen.getByLabelText('Validade'), '1h');
    await user.clear(screen.getByLabelText('Limite de usos'));
    await user.type(screen.getByLabelText('Limite de usos'), '3');
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ role: 'ADMIN', validity: '1h', maxUses: 3, email: undefined });
    expect(await screen.findByTestId('invite-link')).toHaveTextContent(LINK);
    expect(screen.getByText(/ele não aparece de novo/)).toBeInTheDocument();
    expect(screen.getByText(/Vale para 3 pessoas/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('recusa limite de usos fora de 1 a 10 sem chamar a API', async () => {
    const { user, onCreate } = setup();
    const uses = screen.getByLabelText('Limite de usos');
    await user.clear(uses);
    await user.type(uses, '11');
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByText('Máximo de 10 usos')).toBeInTheDocument();

    await user.clear(uses);
    await user.type(uses, '0');
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByText('Mínimo de 1 uso')).toBeInTheDocument();
    expect(uses).toHaveAttribute('aria-invalid', 'true');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('por e-mail: pede um e-mail válido e o convite vale para uma pessoa só', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('radio', { name: /Por e-mail/ }));
    expect(screen.queryByLabelText('Limite de usos')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByText('Informe o e-mail do convidado')).toBeInTheDocument();
    await user.type(screen.getByLabelText('E-mail do convidado'), 'nao-e-email');
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByText('Informe um e-mail válido')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('E-mail do convidado'));
    await user.type(screen.getByLabelText('E-mail do convidado'), 'nova.admin@exemplo.com');
    await user.selectOptions(screen.getByLabelText('Papel'), 'ORGANIZER');
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ role: 'ORGANIZER', validity: '24h', maxUses: 1, email: 'nova.admin@exemplo.com' }));
    expect(await screen.findByText(/Só nova.admin@exemplo.com consegue aceitar/)).toBeInTheDocument();
  });

  it('avisa do 2FA só para convite de administrador', async () => {
    const { user } = setup();
    expect(screen.getByText(/precisa ativar a verificação em duas etapas/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Papel'), 'ORGANIZER');
    expect(screen.queryByText(/precisa ativar a verificação em duas etapas/)).toBeNull();
  });

  it('mostra o erro da API e não exibe link nenhum', async () => {
    const { user } = setup(vi.fn(() => Promise.reject(new TypeError('falha de rede'))));
    await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão. Confira sua internet e tente de novo.');
    expect(screen.queryByTestId('invite-created')).toBeNull();
  });
});
