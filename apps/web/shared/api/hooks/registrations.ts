'use client';

import { MyTournamentEntry, Registration, RegistrationEligibility, type RegisterInTournamentInput } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const MyRegistration = Registration.nullable();
const MyTournamentEntries = z.array(MyTournamentEntry);

/**
 * Uma inscrição nova, confirmada ou cancelada muda vagas, lista de espera, inscritos e "Meus campeonatos":
 * tudo isso fica sob `keys.tournaments.all`. Inscrever-se também passa a seguir o campeonato (RN-15).
 */
function useInvalidateRegistrations() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.tournaments.all }), qc.invalidateQueries({ queryKey: keys.follows })]);
}

/** Minha inscrição no campeonato (solo ou como membro de um squad inscrito). `null` = não estou inscrito. */
export function useMyRegistration(tournamentId: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.tournaments.registrations(tournamentId ?? '', { scope: 'mine' }),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/my-registration`, { schema: MyRegistration, signal }),
    enabled: Boolean(tournamentId) && (opts.enabled ?? true),
  });
}

/** Se quem está vendo é da organização do campeonato (dono ou equipe) e por isso não pode se inscrever. */
export function useRegistrationEligibility(tournamentId: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.tournaments.registrations(tournamentId ?? '', { scope: 'eligibility' }),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/registration-eligibility`, { schema: RegistrationEligibility, signal }),
    enabled: Boolean(tournamentId) && (opts.enabled ?? true),
  });
}

/** "Meus campeonatos": minhas inscrições, as ativas primeiro. */
export function useMyRegistrations(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.tournaments.mine('participant'),
    queryFn: ({ signal }) => api.get('/me/registrations', { schema: MyTournamentEntries, signal }),
    enabled: opts.enabled ?? true,
  });
}

/** Inscrição solo (`{ acceptRules: true }`) ou com squad (`{ teamId, acceptRules: true }`). */
export function useRegisterInTournament(tournamentId: string) {
  const invalidate = useInvalidateRegistrations();
  return useMutation({
    mutationFn: (input: RegisterInTournamentInput) => api.post(`/tournaments/${tournamentId}/registrations`, input, { schema: Registration }),
    onSuccess: () => invalidate(),
  });
}

/** Membro do squad confirma a participação na inscrição. */
export function useConfirmRegistration() {
  const invalidate = useInvalidateRegistrations();
  return useMutation({
    mutationFn: (registrationId: string) => api.post(`/registrations/${registrationId}/confirm`, undefined, { schema: Registration }),
    onSuccess: () => invalidate(),
  });
}

/** Membro do squad recusa a participação (sai do elenco daquela inscrição). */
export function useDeclineRegistration() {
  const invalidate = useInvalidateRegistrations();
  return useMutation({
    mutationFn: (registrationId: string) => api.post<void>(`/registrations/${registrationId}/decline`),
    onSuccess: () => invalidate(),
  });
}

/** Cancela a inscrição (o inscrito ou o capitão, até o prazo da RN-06). */
export function useCancelRegistration() {
  const invalidate = useInvalidateRegistrations();
  return useMutation({
    mutationFn: (registrationId: string) => api.delete<void>(`/registrations/${registrationId}`),
    onSuccess: () => invalidate(),
  });
}
