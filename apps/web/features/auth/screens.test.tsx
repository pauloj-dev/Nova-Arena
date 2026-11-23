import { ToastProvider } from '@nova/ui';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';

const router = { replace: vi.fn(), push: vi.fn() };
let search = '';
const login = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };
const devLogin = { mutate: vi.fn(), isPending: false };
const verify = { mutate: vi.fn(), isPending: false };
const signUp = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };

// O cadastro depende da flag `publicSignup`; nos testes de formulário ela fica ligada.
const signupFlags = { publicSignup: true };
vi.mock('@/shared/flags/useFlag', () => ({ useFlags: () => ({ flags: signupFlags, isLoading: false }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/session/useSession', () => ({
  useSession: () => ({ user: null, isLoading: false }),
  useLogin: () => login,
  useDevLogin: () => devLogin,
  useVerifyTwoFactorLogin: () => verify,
}));
vi.mock('@/features/profile/security/PrototypeCode', () => ({
  prototypeCodeAvailable: () => true,
  PrototypeCode: ({ onUse }: { onUse: (code: string) => void }) => (
    <button type="button" onClick={() => onUse('654321')}>
      Usar este código
    </button>
  ),
}));
vi.mock('@/shared/api/hooks/users', () => ({
  useRegister: () => signUp,
}));

function renderScreen(ui: ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

// O Checkbox do Radix mede o próprio tamanho; o jsdom não tem ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  search = '';
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginScreen', () => {
  it('valida os campos antes de chamar a API', async () => {
    const user = userEvent.setup();
    renderScreen(<LoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe um e-mail válido')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha')).toBeInTheDocument();
    expect(login.mutate).not.toHaveBeenCalled();
  });

  it('envia e-mail e senha e preserva o next nos links', async () => {
    search = 'next=%2Fconvite%2Fabc';
    const user = userEvent.setup();
    renderScreen(<LoginScreen />);

    await user.type(screen.getByLabelText('E-mail'), 'bianca@novaarena.gg');
    await user.type(screen.getByLabelText('Senha'), 'arena1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(login.mutate).toHaveBeenCalledTimes(1));
    expect(login.mutate.mock.calls[0]?.[0]).toEqual({ email: 'bianca@novaarena.gg', password: 'arena1234' });
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro?next=%2Fconvite%2Fabc');
    expect(screen.getByRole('link', { name: 'Esqueci a senha' })).toHaveAttribute('href', '/recuperar-senha');
  });

  it('ignora next que aponta para fora do site', async () => {
    search = 'next=https%3A%2F%2Fevil.example.com';
    const user = userEvent.setup();
    renderScreen(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    const options = devLogin.mutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('os botões sociais entram como a conta de demonstração e dizem que é simulado', async () => {
    const user = userEvent.setup();
    renderScreen(<LoginScreen />);

    const google = screen.getByRole('button', { name: 'Entrar com Google' });
    expect(google).toHaveAccessibleDescription(/simulado/);
    expect(screen.getByText('Protótipo')).toBeInTheDocument();

    await user.click(google);
    await user.click(screen.getByRole('button', { name: 'Entrar com Discord' }));
    expect(devLogin.mutate).toHaveBeenCalledTimes(2);
    expect(devLogin.mutate.mock.calls.map((c) => c[0])).toEqual(['u_bianca', 'u_bianca']);
  });
});

describe('LoginScreen com verificação em duas etapas (issue #95)', () => {
  async function toCodeStep(user: ReturnType<typeof userEvent.setup>) {
    renderScreen(<LoginScreen />);
    await user.type(screen.getByLabelText('E-mail'), 'ana@novaarena.gg');
    await user.type(screen.getByLabelText('Senha'), 'arena1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(login.mutate).toHaveBeenCalledTimes(1));
    const options = login.mutate.mock.calls[0]?.[1] as { onSuccess: (result: unknown) => void };
    act(() => options.onSuccess({ twoFactorRequired: true }));
  }

  it('a senha leva ao passo do código (sem navegar); o código confirma e volta para a origem', async () => {
    search = 'next=%2Fadmin';
    const user = userEvent.setup();
    await toCodeStep(user);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(screen.getByLabelText('Código do aplicativo')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByText('O código tem 6 dígitos')).toBeInTheDocument();
    expect(verify.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Usar este código' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(verify.mutate.mock.calls[0]?.[0]).toBe('654321');
    const options = verify.mutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();
    expect(router.replace).toHaveBeenCalledWith('/admin');
  });

  it('código de recuperação: troca o campo e envia como digitado', async () => {
    const user = userEvent.setup();
    await toCodeStep(user);
    await user.click(screen.getByRole('button', { name: 'Sem o celular? Usar um código de recuperação' }));
    expect(screen.getByLabelText('Código de recuperação')).toHaveFocus();
    await user.type(screen.getByLabelText('Código de recuperação'), 'abcd-efgh');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(verify.mutate.mock.calls[0]?.[0]).toBe('abcd-efgh');
  });

  it('passo vencido: volta para a senha explicando o motivo', async () => {
    const user = userEvent.setup();
    await toCodeStep(user);
    await user.type(screen.getByLabelText('Código do aplicativo'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const options = verify.mutate.mock.calls[0]?.[1] as { onError: (e: unknown) => void };
    act(() => options.onError(new ApiError({ type: 'about:blank', title: 'Venceu', status: 401, code: 'TWO_FACTOR_CHALLENGE_EXPIRED' })));
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('O tempo para informar o código acabou');
  });

  it('chegando do login social com 2FA (`?etapa=codigo`), abre direto no passo do código', () => {
    search = 'etapa=codigo&next=%2Fminha-conta';
    renderScreen(<LoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Verificação em duas etapas' })).toBeInTheDocument();
  });
});

describe('RegisterScreen', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, birthDate: string) {
    await user.type(screen.getByLabelText('Apelido'), 'NovaJogadora');
    await user.type(screen.getByLabelText('E-mail'), 'nova@exemplo.com');
    await user.type(screen.getByLabelText('Senha'), 'arena1234');
    await user.type(screen.getByLabelText('Data de nascimento'), birthDate);
  }

  it('com o cadastro público fechado, explica e oferece entrar, sem formulário', () => {
    signupFlags.publicSignup = false;
    try {
      renderScreen(<RegisterScreen />);
      expect(screen.getByRole('heading', { name: 'Cadastro fechado no momento' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Apelido')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument();
    } finally {
      signupFlags.publicSignup = true;
    }
  });

  it('mostra a força da senha em texto', async () => {
    const user = userEvent.setup();
    renderScreen(<RegisterScreen />);
    const meter = screen.getByRole('meter', { name: 'Força da senha' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');

    await user.type(screen.getByLabelText('Senha'), 'abc');
    expect(screen.getByText(/Força da senha:/)).toHaveTextContent('Força da senha: fraca');
    await user.type(screen.getByLabelText('Senha'), 'def-GHI#2026');
    expect(screen.getByText(/Força da senha:/)).toHaveTextContent('Força da senha: forte');
    expect(meter).toHaveAttribute('aria-valuenow', '4');
  });

  it('recusa quem tem menos de 16 anos e quem não aceitou os termos', async () => {
    const user = userEvent.setup();
    renderScreen(<RegisterScreen />);
    const tooYoung = `${new Date().getUTCFullYear() - 10}-01-15`;
    await fill(user, tooYoung);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('É preciso ter pelo menos 16 anos para se cadastrar')).toBeInTheDocument();
    expect(screen.getByText('É preciso aceitar os Termos de Uso e a Política de Privacidade')).toBeInTheDocument();
    expect(signUp.mutate).not.toHaveBeenCalled();
  });

  it('envia o cadastro completo', async () => {
    const user = userEvent.setup();
    renderScreen(<RegisterScreen />);
    await fill(user, '2000-03-20');
    await user.click(screen.getByRole('checkbox', { name: /^Li e aceito os Termos de Uso e a Política de Privacidade/ }));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => expect(signUp.mutate).toHaveBeenCalledTimes(1));
    expect(signUp.mutate.mock.calls[0]?.[0]).toEqual({
      nickname: 'NovaJogadora',
      email: 'nova@exemplo.com',
      password: 'arena1234',
      birthDate: '2000-03-20',
      acceptTerms: true,
    });
  });
});
