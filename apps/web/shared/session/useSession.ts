'use client';

import { LoginResult, Me, type LoginInput, type Role } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, renewSession } from '../api/client';
import { keys } from '../api/keys';

const MeOrNull = Me.nullable();

/** Sessão atual. `user` é nulo para visitante. */
export function useSession() {
  const query = useQuery({
    queryKey: keys.me,
    // Sem sessão no token de acesso: tenta renovar pelo refresh antes de tratar como visitante.
    queryFn: async ({ signal }) => (await api.get('/me', { schema: MeOrNull, signal })) ?? (await renewSession()),
    staleTime: 60_000,
  });
  const user = query.data ?? null;
  return {
    user,
    isLoading: query.isPending,
    isAuthenticated: Boolean(user),
    hasRole: (...roles: Role[]) => Boolean(user && roles.some((r) => user.roles.includes(r))),
    refetch: query.refetch,
  };
}

export function isAdminUser(user: Pick<Me, 'roles'> | null | undefined): boolean {
  return Boolean(user && (user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN')));
}
export function isOrganizerUser(user: Pick<Me, 'roles'> | null | undefined): boolean {
  return Boolean(user && (user.roles.includes('ORGANIZER') || isAdminUser(user)));
}

/** Depois de qualquer mudança de sessão, tudo o que estava em cache pode ser de outra pessoa. */
function useResetOnSessionChange() {
  const qc = useQueryClient();
  return (me: Me | null) => {
    // Sem avisar quem está montado: quem chama navega em seguida, e a tela nova já nasce com a sessão certa.
    // (Avisar aqui faria a página protegida redirecionar para o login antes da navegação do "Sair".)
    qc.clear();
    qc.setQueryData(keys.me, me);
  };
}

/** A resposta do login é a conta ou, para quem tem 2FA ativo, o pedido do código (issue #95). */
export function needsTwoFactor(result: LoginResult): result is Extract<LoginResult, { twoFactorRequired: true }> {
  return 'twoFactorRequired' in result;
}

/**
 * E-mail e senha. Com 2FA ativo a sessão ainda não abre: a resposta é `{ twoFactorRequired: true }` e o código
 * vai em `useVerifyTwoFactorLogin`.
 */
export function useLogin() {
  const reset = useResetOnSessionChange();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post('/auth/login', input, { schema: LoginResult }),
    onSuccess: (result) => {
      if (!needsTwoFactor(result)) reset(result);
    },
  });
}

/** Segundo passo do login: o código do aplicativo (ou um de recuperação) abre a sessão. */
export function useVerifyTwoFactorLogin() {
  const reset = useResetOnSessionChange();
  return useMutation({
    mutationFn: (code: string) => api.post('/auth/2fa/verify', { code }, { schema: Me }),
    onSuccess: (me) => reset(me),
  });
}

/** Só no protótipo: entra como um usuário de demonstração (botões sociais e seletor "Entrar como"). */
export function useDevLogin() {
  const reset = useResetOnSessionChange();
  return useMutation({
    mutationFn: (userId: string) => api.post('/auth/dev-login', { userId }, { schema: Me }),
    onSuccess: (me) => reset(me),
  });
}

export function useLogout() {
  const reset = useResetOnSessionChange();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => reset(null),
  });
}
