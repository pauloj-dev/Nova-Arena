import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expectNoA11yViolations } from '../test/axe';
import { Checkbox, Switch } from './Toggle';

function CheckboxHarness({ initial = false, disabled, onChange }: { initial?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Checkbox
      label="Li e aceito o regulamento"
      hint="O regulamento vale para todas as quedas."
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => {
        setChecked(v);
        onChange?.(v);
      }}
    />
  );
}

function SwitchHarness({ initial = false, disabled, onChange }: { initial?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      label="Inscrições abertas"
      hint="Novos squads podem se inscrever."
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => {
        setChecked(v);
        onChange?.(v);
      }}
    />
  );
}

describe('Checkbox', () => {
  it('tem papel de checkbox, nome pelo rótulo e descrição pela dica', () => {
    render(<CheckboxHarness />);
    const checkbox = screen.getByRole('checkbox', { name: 'Li e aceito o regulamento' });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription('O regulamento vale para todas as quedas.');
  });

  it('marca e desmarca com Espaço, depois de receber foco com Tab', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxHarness onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox');
    await user.tab();
    expect(checkbox).toHaveFocus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('Enter não marca (padrão de checkbox)', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clicar no rótulo também marca', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness />);
    await user.click(screen.getByText('Li e aceito o regulamento'));
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('marcado mostra o ícone (decorativo)', () => {
    const { container } = render(<CheckboxHarness initial />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('disabled não muda nem recebe foco', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxHarness disabled onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox');
    await user.tab();
    expect(checkbox).not.toHaveFocus();
    await user.click(checkbox);
    expect(checkbox).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sem dica não tem aria-describedby', () => {
    render(<Checkbox label="Exigir check-in" checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby');
  });

  it('não tem violações de acessibilidade', async () => {
    render(
      <>
        <CheckboxHarness />
        <CheckboxHarness initial />
        <CheckboxHarness disabled />
      </>,
    );
    await expectNoA11yViolations();
  });
});

describe('Switch', () => {
  it('tem papel de switch, nome pelo rótulo e descrição pela dica', () => {
    render(<SwitchHarness />);
    const toggle = screen.getByRole('switch', { name: 'Inscrições abertas' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Novos squads podem se inscrever.');
  });

  it('liga e desliga com Espaço e com Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchHarness onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('clicar no rótulo também liga', async () => {
    const user = userEvent.setup();
    render(<SwitchHarness />);
    await user.click(screen.getByText('Inscrições abertas'));
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('o botão deslizante contrasta com o trilho nos dois estados', async () => {
    const user = userEvent.setup();
    render(<SwitchHarness />);
    const thumb = screen.getByRole('switch').firstElementChild;
    expect(thumb).toHaveClass('bg-border-strong', 'data-[state=checked]:bg-surface');
    expect(thumb).toHaveAttribute('data-state', 'unchecked');
    await user.click(screen.getByRole('switch'));
    expect(thumb).toHaveAttribute('data-state', 'checked');
  });

  it('disabled não muda nem recebe foco', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchHarness disabled onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    await user.tab();
    expect(toggle).not.toHaveFocus();
    await user.click(toggle);
    expect(toggle).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('não tem violações de acessibilidade', async () => {
    render(
      <>
        <SwitchHarness />
        <SwitchHarness initial />
        <SwitchHarness disabled />
      </>,
    );
    await expectNoA11yViolations();
  });
});
