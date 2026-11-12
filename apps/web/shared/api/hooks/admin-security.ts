'use client';

/** Verificação em duas etapas da própria conta (`/minha-conta/seguranca`). Obrigatória para Admin (RNF-08). */
import { TwoFactorDevCode, TwoFactorEnabled, TwoFactorSetup, TwoFactorStatus } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: keys.twoFactor,
    queryFn: ({ signal }) => api.get('/me/2fa', { schema: TwoFactorStatus, signal }),
  });
}

/** Gera o segredo e o QR code. Nada é ativado até o código ser confirmado em `useEnableTwoFactor`. */
export function useSetupTwoFactor() {
  return useMutation({ mutationFn: () => api.post('/me/2fa/setup', undefined, { schema: TwoFactorSetup }) });
}

function useRefreshSecurity() {
  const qc = useQueryClient();
  // Sem devolver a promessa: a mutação não fica esperando as reconsultas para avisar quem a chamou.
  return () => {
    void qc.invalidateQueries({ queryKey: keys.twoFactor });
    // `RequireRole` libera `/admin` a partir de `me.twoFactorEnabled`.
    void qc.invalidateQueries({ queryKey: keys.me });
  };
}

/** Confirma o código e ativa. A resposta traz os códigos de recuperação, mostrados uma única vez. */
export function useEnableTwoFactor() {
  const refresh = useRefreshSecurity();
  return useMutation({
    mutationFn: (code: string) => api.post('/me/2fa/enable', { code }, { schema: TwoFactorEnabled }),
    onSuccess: refresh,
  });
}

/** Pede o código do aplicativo ou um código de recuperação. Admin não pode desligar. */
export function useDisableTwoFactor() {
  const refresh = useRefreshSecurity();
  return useMutation({
    mutationFn: (code: string) => api.post('/me/2fa/disable', { code }, { schema: TwoFactorStatus }),
    onSuccess: refresh,
  });
}

/** Só no protótipo: o código do momento, para demonstrar sem aplicativo autenticador. */
export function useTwoFactorDevCode(enabled: boolean) {
  return useQuery({
    queryKey: [...keys.twoFactor, 'dev-code'] as const,
    queryFn: ({ signal }) => api.get('/me/2fa/dev-code', { schema: TwoFactorDevCode, signal }),
    enabled,
    refetchInterval: 5_000,
    retry: false,
  });
}
