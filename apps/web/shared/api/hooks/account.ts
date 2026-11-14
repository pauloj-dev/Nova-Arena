'use client';

/** Conta em `/minha-conta/seguranca` (issue #69): aparelhos conectados, troca de senha e troca de e-mail. */
import { ChangeEmailResponse, DeviceSessions, Me, Ok, type ChangeEmailInput, type ChangePasswordInput } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

export function useDeviceSessions() {
  return useQuery({
    queryKey: keys.deviceSessions,
    queryFn: ({ signal }) => api.get('/me/sessions', { schema: DeviceSessions, signal }),
  });
}

function useRefreshDevices() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: keys.deviceSessions });
}

/** Encerra um aparelho (não este: para sair deste, "Sair"). */
export function useEndSession() {
  const refresh = useRefreshDevices();
  return useMutation({ mutationFn: (id: string) => api.delete(`/me/sessions/${encodeURIComponent(id)}`), onSuccess: refresh });
}

/** Encerra todos os outros aparelhos. */
export function useEndOtherSessions() {
  const refresh = useRefreshDevices();
  return useMutation({ mutationFn: () => api.delete('/me/sessions'), onSuccess: refresh });
}

/** Troca a senha: os outros aparelhos saem da conta. */
export function useChangePassword() {
  const refresh = useRefreshDevices();
  return useMutation({ mutationFn: (input: ChangePasswordInput) => api.post('/me/password/change', input, { schema: Ok }), onSuccess: refresh });
}

/** Pede a troca de e-mail. O novo só vale depois do link enviado a ele. */
export function useChangeEmail() {
  return useMutation({ mutationFn: (input: ChangeEmailInput) => api.post('/me/email', input, { schema: ChangeEmailResponse }) });
}

/** Link do e-mail novo (`/confirmar-email?token=`). */
export function useConfirmEmailChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/confirm-email-change', { token }, { schema: Me }),
    onSuccess: (me) => {
      // Se a pessoa estiver logada neste aparelho, a sessão já mostra o e-mail novo.
      const current = qc.getQueryData<Me | null>(keys.me);
      if (current?.id === me.id) qc.setQueryData(keys.me, me);
    },
  });
}
