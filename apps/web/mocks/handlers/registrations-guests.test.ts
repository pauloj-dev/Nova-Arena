/**
 * Inscrito avulso e elenco sem conta (RN-18) na API simulada: os mesmos cenários do teste de integração da API
 * real (`packages/api/test/registrations-guests.integration.test.ts`).
 */
import { ImportRegistrationsResult, Registration, RosterChangeResult } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLogs } from '../audit';
import { as, call, mutate, setupMockApi } from '../testing';

setupMockApi();

const CAMILA = 'u_camila'; // dona do FF Solo Rush (solo)
const DIEGO = 'u_diego'; // dono da Arena Contra Squad 4v4 (4 titulares + 1 reserva)
const BIANCA = 'u_bianca';
const CONTRA = 'tn_contra_squad';
const SOLO = 'tn_ff_solo';

const squad = (prefix: string, count: number, firstId = 1000) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i + 1}`, gameId: String(firstId + i) }));
const list = async (tournamentId: string, scope = '?scope=all') => z.array(Registration).parse((await call('GET', `/tournaments/${tournamentId}/registrations${scope}`)).data);

async function addManual(tournamentId: string, body: unknown) {
  const res = await call('POST', `/tournaments/${tournamentId}/registrations/manual`, body);
  return { ...res, registration: res.status === 201 ? Registration.parse(res.data) : null };
}

describe('inscrito avulso (RN-18)', () => {
  it('a organização cadastra um jogador sem conta: entra confirmado, sem aprovação manual nem ID do jogo', async () => {
    as(CAMILA);
    const { status, registration } = await addManual(SOLO, { name: '  Zeca Avulso ', contact: 'zeca@exemplo.com', gameId: '123456' });
    expect(status).toBe(201);
    expect(registration).toMatchObject({ displayName: 'Zeca Avulso', status: 'CONFIRMED', userId: null, teamId: null, guests: [] });
    expect(auditLogs().some((l) => l.action === 'REGISTRATION_ADDED' && l.entityId === registration?.id)).toBe(true);
    // O contato e o ID informados saem na exportação da organização.
    const csv = await (await fetch(`http://localhost:3000/api/v1/tournaments/${SOLO}/registrations.csv`)).text();
    expect(csv).toContain('Zeca Avulso;;Importada;Confirmada;;;;;');
    expect(csv).toContain('zeca@exemplo.com;123456');
  });

  it('nome repetido, elenco em campeonato individual e quem não é da organização são recusados', async () => {
    as(CAMILA);
    expect((await addManual(SOLO, { name: 'Zeca' })).status).toBe(201);
    const repeated = await addManual(SOLO, { name: 'zeca' });
    expect(repeated).toMatchObject({ status: 409, code: 'NAME_TAKEN' });
    expect(await addManual(SOLO, { name: 'Com Elenco', members: [{ name: 'A' }] })).toMatchObject({ status: 400, code: 'INVALID_ROSTER' });
    expect((await addManual(SOLO, { name: '' })).status).toBe(400);
    as(BIANCA);
    expect((await addManual(SOLO, { name: 'Intruso' })).status).toBe(403);
    as(null);
    expect((await addManual(SOLO, { name: 'Visitante' })).status).toBe(401);
  });

  it('sem vaga, vai para a lista de espera; com a lista desligada, é recusado; depois do início, não entra mais', async () => {
    as(CAMILA);
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === SOLO);
      if (t) t.maxParticipants = 1;
    });
    expect((await addManual(SOLO, { name: 'Primeiro' })).registration?.status).toBe('CONFIRMED');
    expect((await addManual(SOLO, { name: 'Segundo' })).registration).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === SOLO);
      if (t) t.waitlistEnabled = false;
    });
    expect(await addManual(SOLO, { name: 'Terceiro' })).toMatchObject({ status: 409, code: 'TOURNAMENT_FULL' });
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === SOLO);
      if (t) t.status = 'IN_PROGRESS';
    });
    expect(await addManual(SOLO, { name: 'Atrasado' })).toMatchObject({ status: 409, code: 'REGISTRATIONS_LOCKED' });
  });
});

describe('elenco sem conta do squad (RN-18, Free Fire 4x4)', () => {
  it('squad avulso já com o elenco do modo: 4 titulares + 1 reserva; o público vê os nomes, não os IDs', async () => {
    as(DIEGO);
    const { status, registration } = await addManual(CONTRA, { name: 'Squad Manual', tag: 'man', members: [...squad('Titular', 4), { name: 'Banco', gameId: '2000', isSub: true }] });
    expect(status).toBe(201);
    // Entra confirmado mesmo com a aprovação manual ligada: a organização é quem está cadastrando.
    expect(registration).toMatchObject({ displayName: 'Squad Manual', tag: 'MAN', status: 'CONFIRMED', requiredMembers: 4 });
    expect(registration?.guests.map((g) => [g.name, g.gameId, g.isSub])).toEqual([['Titular1', '1000', false], ['Titular2', '1001', false], ['Titular3', '1002', false], ['Titular4', '1003', false], ['Banco', '2000', true]]);

    as(null);
    const visible = (await list(CONTRA, '')).find((r) => r.id === registration?.id);
    expect(visible?.guests.map((g) => g.name)).toEqual(['Titular1', 'Titular2', 'Titular3', 'Titular4', 'Banco']);
    expect(visible?.guests.every((g) => g.gameId === null)).toBe(true);
  });

  it('elenco fora do modo ou repetido é recusado, com o motivo', async () => {
    as(DIEGO);
    expect((await addManual(CONTRA, { name: 'Cinco Titulares', members: squad('T', 5) })).detail).toBe('Este modo tem 4 titulares por squad: o elenco ficaria com 5.');
    expect((await addManual(CONTRA, { name: 'Duas Reservas', members: [{ name: 'A', isSub: true }, { name: 'B', isSub: true }] })).detail).toBe('Este modo aceita 1 reserva por squad: o elenco ficaria com 2.');
    expect((await addManual(CONTRA, { name: 'Nome Repetido', members: [{ name: 'Ana' }, { name: ' ana ' }] })).detail).toBe('O jogador "ana" aparece duas vezes no elenco.');
    expect((await addManual(CONTRA, { name: 'ID Repetido', members: [{ name: 'Ana', gameId: '77' }, { name: 'Bia', gameId: '77' }] })).detail).toBe('O ID no jogo "77" aparece duas vezes no elenco.');
    expect((await list(CONTRA)).filter((r) => r.userId === null && r.teamId === null)).toEqual([]);
  });

  it('a organização coloca, corrige e tira jogadores do squad sem conta, com auditoria', async () => {
    as(DIEGO);
    const { registration } = await addManual(CONTRA, { name: 'Squad Vazio' });
    const id = registration?.id ?? '';
    const guests = async (res: { data: unknown }) => RosterChangeResult.parse(res.data).registrations[0]?.guests ?? [];

    const added = await call('POST', `/registrations/${id}/guests`, { name: ' Kaue ', gameId: ' 555 ' });
    expect(added.status).toBe(201);
    expect(await guests(added)).toEqual([{ id: expect.any(String), name: 'Kaue', gameId: '555', isSub: false }]);
    for (const name of ['B', 'C', 'D']) expect((await call('POST', `/registrations/${id}/guests`, { name })).status).toBe(201);
    // Titulares completos: o quinto só entra como reserva; a segunda reserva não cabe.
    expect(await call('POST', `/registrations/${id}/guests`, { name: 'E' })).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await call('POST', `/registrations/${id}/guests`, { name: 'E', isSub: true })).status).toBe(201);
    expect(await call('POST', `/registrations/${id}/guests`, { name: 'F', isSub: true })).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect(await call('POST', `/registrations/${id}/guests`, { name: 'kaue', isSub: true })).toMatchObject({ status: 409 });

    const kaue = (await list(CONTRA)).find((r) => r.id === id)?.guests.find((g) => g.name === 'Kaue');
    const fixed = await call('PATCH', `/registrations/${id}/guests/${kaue?.id}`, { name: 'Kauê', gameId: null });
    expect(fixed.status).toBe(200);
    expect((await guests(fixed)).find((g) => g.id === kaue?.id)).toEqual({ id: kaue?.id, name: 'Kauê', gameId: null, isSub: false });
    // Virar reserva com a vaga de reserva ocupada não cabe.
    expect(await call('PATCH', `/registrations/${id}/guests/${kaue?.id}`, { isSub: true })).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await call('PATCH', `/registrations/${id}/guests/${kaue?.id}`, {})).status).toBe(400);

    const removed = await call('DELETE', `/registrations/${id}/guests/${kaue?.id}`);
    expect((await guests(removed)).map((g) => g.name)).toEqual(['B', 'C', 'D', 'E']);
    expect((await call('DELETE', `/registrations/${id}/guests/${kaue?.id}`)).status).toBe(404);
    expect(auditLogs().filter((l) => l.action === 'ROSTER_CHANGED' && l.entityId === id).map((l) => ['escalou', 'corrigiu', 'tirou'].find((key) => key in (l.after ?? {})))).toEqual(['escalou', 'escalou', 'escalou', 'escalou', 'escalou', 'corrigiu', 'tirou']);
  });

  it('o mesmo ID no jogo não entra em dois squads do campeonato', async () => {
    as(DIEGO);
    await addManual(CONTRA, { name: 'Squad Um', members: [{ name: 'Ana', gameId: 'ABC123' }] });
    expect((await addManual(CONTRA, { name: 'Squad Dois', members: [{ name: 'Outra Ana', gameId: 'abc123' }] })).detail).toBe(
      'O ID no jogo "ABC123" já está no elenco do Squad Um neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.',
    );
    const two = (await addManual(CONTRA, { name: 'Squad Dois' })).registration;
    expect(await call('POST', `/registrations/${two?.id}/guests`, { name: 'Outra Ana', gameId: 'ABC123' })).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await call('POST', `/registrations/${two?.id}/guests`, { name: 'Bia', gameId: 'XYZ' })).status).toBe(201);
  });

  it('só a organização mexe; squad com conta, inscrição individual e campeonato encerrado ficam de fora', async () => {
    as(DIEGO);
    const { registration } = await addManual(CONTRA, { name: 'Squad Fechado' });
    const withAccount = (await list(CONTRA)).find((r) => r.teamId !== null);
    expect(await call('POST', `/registrations/${withAccount?.id}/guests`, { name: 'X' })).toMatchObject({ status: 409, code: 'NOT_STAFF_REGISTRATION' });
    as(BIANCA);
    expect((await call('POST', `/registrations/${registration?.id}/guests`, { name: 'X' })).status).toBe(403);

    as(CAMILA);
    const solo = (await addManual(SOLO, { name: 'Jogador Solo' })).registration;
    expect(await call('POST', `/registrations/${solo?.id}/guests`, { name: 'X' })).toMatchObject({ status: 409, code: 'SOLO_REGISTRATION' });

    as(DIEGO);
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === CONTRA);
      if (t) t.status = 'IN_PROGRESS';
    });
    // Com o campeonato em andamento a organização ainda troca o elenco; depois do fim, não.
    expect((await call('POST', `/registrations/${registration?.id}/guests`, { name: 'Durante' })).status).toBe(201);
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === CONTRA);
      if (t) t.status = 'FINISHED';
    });
    expect(await call('POST', `/registrations/${registration?.id}/guests`, { name: 'Depois' })).toMatchObject({ status: 409, code: 'ROSTER_CLOSED' });
  });

  it('a planilha traz o elenco; linha com elenco fora do modo ou ID que já joga por outro squad é pulada', async () => {
    as(DIEGO);
    const result = ImportRegistrationsResult.parse(
      (
        await call('POST', `/tournaments/${CONTRA}/registrations/import`, {
          rows: [
            { name: 'Time A', tag: 'a', members: [...squad('A', 4, 100), { name: 'AR', isSub: true }] },
            { name: 'Time B', members: squad('B', 5, 200) },
            { name: 'Time C', members: [{ name: 'C1', gameId: '100' }] },
            { name: 'Time D' },
          ],
        })
      ).data,
    );
    expect(result).toEqual({
      created: 2,
      waitlisted: 0,
      skipped: [
        { row: 2, reason: 'Este modo tem 4 titulares por squad: o elenco ficaria com 5.' },
        { row: 3, reason: 'O ID no jogo "100" já está no elenco do Time A neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.' },
      ],
    });
    const all = await list(CONTRA);
    expect(all.find((r) => r.displayName === 'Time A')?.guests.map((g) => `${g.name}${g.isSub ? '*' : ''}`)).toEqual(['A1', 'A2', 'A3', 'A4', 'AR*']);
    expect(all.find((r) => r.displayName === 'Time D')?.guests).toEqual([]);
    // O elenco sai na exportação da organização.
    const csv = await (await fetch(`http://localhost:3000/api/v1/tournaments/${CONTRA}/registrations.csv`)).text();
    expect(csv).toContain('Time A;A;Importada;Confirmada;;A1, A2, A3, A4, AR (reserva);');
  });
});
