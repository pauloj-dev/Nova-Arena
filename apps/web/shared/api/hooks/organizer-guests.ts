'use client';

/**
 * Inscrito avulso e elenco sem conta (RN-18). Ficam fora de `organizer.ts` porque só as telas carregadas sob
 * demanda usam: assim não entram no JavaScript inicial da gestão do campeonato.
 */
import { Registration, RosterChangeResult, type GuestMemberInput, type ManualRegistrationInput, type UpdateGuestMemberInput } from '@nova/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { invalidateRegistrations } from './organizer';

/** Inscrito avulso (RN-18): a organização cadastra um jogador ou squad sem conta, sem planilha. */
export function useAddManualRegistration(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualRegistrationInput) => api.post(`/tournaments/${tournamentId}/registrations/manual`, input, { schema: Registration }),
    onSuccess: () => invalidateRegistrations(qc, tournamentId),
  });
}

/** Elenco sem conta (RN-18): colocar um jogador no elenco de uma inscrição criada pela organização. */
export function useAddGuest(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, input }: { registrationId: string; input: GuestMemberInput }) => api.post(`/registrations/${registrationId}/guests`, input, { schema: RosterChangeResult }),
    onSuccess: () => invalidateRegistrations(qc, tournamentId),
  });
}

/** Elenco sem conta (RN-18): corrigir nome, ID no jogo ou titular/reserva. */
export function useUpdateGuest(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, guestId, input }: { registrationId: string; guestId: string; input: UpdateGuestMemberInput }) =>
      api.patch(`/registrations/${registrationId}/guests/${guestId}`, input, { schema: RosterChangeResult }),
    onSuccess: () => invalidateRegistrations(qc, tournamentId),
  });
}

/** Elenco sem conta (RN-18): tirar um jogador. */
export function useRemoveGuest(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, guestId }: { registrationId: string; guestId: string }) => api.delete(`/registrations/${registrationId}/guests/${guestId}`, { schema: RosterChangeResult }),
    onSuccess: () => invalidateRegistrations(qc, tournamentId),
  });
}
