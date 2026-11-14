'use client';

/** Jeitos de entrar na conta (`/minha-conta/seguranca`): senha e provedores vinculados (issue #68). */
import { LoginMethods, Ok, type OAuthProviderName } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

export function useLoginMethods() {
  return useQuery({
    queryKey: keys.loginMethods,
    queryFn: ({ signal }) => api.get('/me/oauth', { schema: LoginMethods, signal }),
  });
}

/** A API recusa (409 `LAST_LOGIN_METHOD`) se for o único jeito de entrar. */
export function useUnlinkProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: OAuthProviderName) => api.delete(`/me/oauth/${provider}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.loginMethods }),
  });
}

/** Primeira senha de quem entrou só com Google/Discord. */
export function useSetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post('/me/password', { password }, { schema: Ok }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.loginMethods }),
  });
}

/** Endereço que inicia o login social (navegação, não `fetch`). */
export function oauthStartUrl(provider: OAuthProviderName, opts: { next?: string; mode?: 'link' } = {}): string {
  const params = new URLSearchParams();
  if (opts.next && opts.next !== '/') params.set('next', opts.next);
  if (opts.mode) params.set('mode', opts.mode);
  const query = params.toString();
  return `/api/v1/auth/oauth/${provider}${query ? `?${query}` : ''}`;
}
