import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '../test/axe';
import { Input, Select, Textarea } from './Field';

const games = [
  { value: 'free-fire', label: 'Free Fire' },
  { value: 'cod-mobile', label: 'Call of Duty: Mobile' },
  { value: 'efootball', label: 'eFootball Mobile', disabled: true },
];

describe.each([
  ['Input', (props: { hint?: string; error?: string; required?: boolean; hideLabel?: boolean; disabled?: boolean }) => <Input label="Nome do squad" {...props} />, 'textbox'],
  ['Textarea', (props: { hint?: string; error?: string; required?: boolean; hideLabel?: boolean; disabled?: boolean }) => <Textarea label="Nome do squad" {...props} />, 'textbox'],
  [
    'Select',
    (props: { hint?: string; error?: string; required?: boolean; hideLabel?: boolean; disabled?: boolean }) => <Select label="Nome do squad" options={games} placeholder="Escolha" {...props} />,
    'combobox',
  ],
] as const)('%s', (_name, renderField, role) => {
  it('liga o rótulo ao controle', async () => {
    const user = userEvent.setup();
    render(renderField({}));
    const control = screen.getByLabelText('Nome do squad');
    expect(control).toBe(screen.getByRole(role, { name: 'Nome do squad' }));
    await user.click(screen.getByText('Nome do squad'));
    expect(control).toHaveFocus();
  });

  it('sem erro não marca aria-invalid nem tem alerta', () => {
    render(renderField({}));
    expect(screen.getByRole(role)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole(role)).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('liga a dica ao controle por aria-describedby', () => {
    render(renderField({ hint: 'De 3 a 24 caracteres.' }));
    expect(screen.getByRole(role)).toHaveAccessibleDescription('De 3 a 24 caracteres.');
  });

  it('mostra o erro com role="alert", marca aria-invalid e troca a dica pelo erro', () => {
    render(renderField({ hint: 'De 3 a 24 caracteres.', error: 'Esse nome já está em uso.' }));
    const control = screen.getByRole(role);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Esse nome já está em uso.');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAttribute('aria-describedby', alert.id);
    expect(control).toHaveAccessibleDescription('Esse nome já está em uso.');
    expect(screen.queryByText('De 3 a 24 caracteres.')).not.toBeInTheDocument();
    expect(within(alert).getByText('Esse nome já está em uso.').parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('required marca o controle e o asterisco fica fora do nome acessível', () => {
    render(renderField({ required: true }));
    const control = screen.getByRole(role, { name: 'Nome do squad' });
    expect(control).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hideLabel esconde o rótulo só visualmente', () => {
    render(renderField({ hideLabel: true }));
    expect(screen.getByText('Nome do squad')).toHaveClass('sr-only');
    expect(screen.getByRole(role, { name: 'Nome do squad' })).toBeInTheDocument();
  });

  it('disabled sai da ordem de foco', async () => {
    const user = userEvent.setup();
    render(renderField({ disabled: true }));
    await user.tab();
    expect(screen.getByRole(role)).toBeDisabled();
    expect(screen.getByRole(role)).not.toHaveFocus();
  });

  it('tem área de toque de 44 px', () => {
    render(renderField({}));
    expect(screen.getByRole(role)).toHaveClass('min-h-11');
  });

  it('não tem violações de acessibilidade (normal, com dica e com erro)', async () => {
    render(
      <>
        {renderField({})}
        {renderField({ hint: 'De 3 a 24 caracteres.', required: true })}
        {renderField({ error: 'Esse nome já está em uso.' })}
        {renderField({ hideLabel: true, disabled: true })}
      </>,
    );
    await expectNoA11yViolations();
  });
});

describe('Input', () => {
  it('recebe digitação e repassa atributos nativos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input label="E-mail" type="email" autoComplete="email" placeholder="voce@exemplo.com" onChange={onChange} />);
    const input = screen.getByLabelText('E-mail');
    await user.type(input, 'rafa@furia.gg');
    expect(input).toHaveValue('rafa@furia.gg');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(onChange).toHaveBeenCalled();
  });

  it('usa o id informado para rótulo, dica e erro', () => {
    render(<Input id="tag" label="Tag" error="A tag precisa ter de 2 a 5 letras." />);
    expect(screen.getByLabelText('Tag')).toHaveAttribute('id', 'tag');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'tag-error');
  });

  it('dois campos sem id não dividem o mesmo id', () => {
    render(
      <>
        <Input label="Nome" />
        <Input label="Tag" />
      </>,
    );
    expect(screen.getByLabelText('Nome').id).not.toBe(screen.getByLabelText('Tag').id);
  });
});

describe('Textarea', () => {
  it('usa 4 linhas por padrão e aceita texto com quebra de linha', async () => {
    const user = userEvent.setup();
    render(<Textarea label="Regras" />);
    const textarea = screen.getByLabelText('Regras');
    expect(textarea).toHaveAttribute('rows', '4');
    await user.type(textarea, 'Squads de 4.{Enter}Sem emulador.');
    expect(textarea).toHaveValue('Squads de 4.\nSem emulador.');
  });
});

describe('Select', () => {
  it('lista as opções, com o placeholder como opção vazia', () => {
    render(<Select label="Jogo" options={games} placeholder="Escolha o jogo" />);
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Escolha o jogo', 'Free Fire', 'Call of Duty: Mobile', 'eFootball Mobile']);
    expect(options[0]).toHaveValue('');
    expect(screen.getByRole('option', { name: 'eFootball Mobile' })).toBeDisabled();
    expect(screen.getByLabelText('Jogo')).toHaveValue('');
  });

  it('sem placeholder não cria a opção vazia', () => {
    render(<Select label="Jogo" options={games} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('escolhe uma opção e avisa por onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Jogo" options={games} placeholder="Escolha o jogo" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Jogo'), 'Free Fire');
    expect(screen.getByLabelText('Jogo')).toHaveValue('free-fire');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a seta é decorativa', () => {
    const { container } = render(<Select label="Jogo" options={games} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
