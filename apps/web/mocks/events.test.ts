/**
 * Eventos na API simulada (ADR-0005) — os mesmos cenários do teste de integração da API real
 * (`packages/api/test/events.integration.test.ts`): permissões, campeonatos do evento, regra `SINGLE` na inscrição
 * (solo, squad e confirmação), troca de regra com conflito e a página pública.
 */
import { Event, EventDetail, OrganizerTournamentDetail, RegistrationEligibility, Tournament } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLogs } from './audit';
import { db, type DbTournament } from './db';
import { as, call, mutate, setupMockApi } from './testing';

setupMockApi();

const CAMILA = 'u_camila'; // dona do Festival Free Fire (seed)
const DIEGO = 'u_diego';
const BIANCA = 'u_bianca';
const ANA = 'u_ana'; // admin

/** Campeonato de teste com inscrições abertas, clonado do FF Solo Rush (solo, Free Fire, da Camila). */
function openSolo(id: string, patch: Partial<DbTournament> = {}): DbTournament {
  let created: DbTournament | undefined;
  mutate((d) => {
    const base = d.tournaments.find((t) => t.slug === 'ff-solo-rush') as DbTournament;
    created = { ...structuredClone(base), id, slug: id.replace(/_/g, '-'), name: `Copa ${id}`, status: 'REGISTRATION_OPEN', registrationOpensAt: '2000-01-01T00:00:00.000Z', registrationClosesAt: '2100-01-01T00:00:00.000Z', eventId: null, ...patch };
    d.tournaments.push(created);
    // Free Fire pede o ID do jogo: a Bianca ganha uma conta de jogo para conseguir se inscrever.
    const bianca = d.users.find((u) => u.id === BIANCA);
    if (bianca && !bianca.gameAccounts.some((a) => a.gameId === base.gameId)) bianca.gameAccounts.push({ gameId: base.gameId, fields: { playerId: '123456789', nick: 'Bia' }, updatedAt: '2026-01-01T00:00:00.000Z' });
  });
  return created as DbTournament;
}

async function newEvent(rule: 'SINGLE' | 'MULTIPLE', name = 'Semana Gamer') {
  const res = await call('POST', '/organizer/events', { name, participationRule: rule });
  expect(res.status).toBe(201);
  return Event.parse(res.data);
}

describe('eventos', () => {
  it('o seed traz o Festival Free Fire (um só campeonato por jogador) com a página pública e o selo na página do campeonato', async () => {
    as(null);
    const pub = EventDetail.parse((await call('GET', '/events/festival-free-fire')).data);
    expect(pub).toMatchObject({ name: 'Festival Free Fire', participationRule: 'SINGLE', tournamentCount: 2 });
    expect(pub.tournaments.map((t) => t.slug).sort()).toEqual(['copa-nova-ff-squad', 'ff-solo-rush']);
    const page = Tournament.parse((await call('GET', '/tournaments/copa-nova-ff-squad')).data);
    expect(page.event).toEqual({ id: 'ev_festival_ff', slug: 'festival-free-fire', name: 'Festival Free Fire', participationRule: 'SINGLE' });
    expect((await call('GET', '/events/nao-existe')).status).toBe(404);
  });

  it('só quem organiza cria evento; a lista mostra só os meus; outro organizador não mexe', async () => {
    as(null);
    expect((await call('POST', '/organizer/events', { name: 'Anônimo' })).status).toBe(401);
    as(BIANCA);
    expect((await call('POST', '/organizer/events', { name: 'Da Bianca' })).status).toBe(403);
    as(CAMILA);
    const ev = await newEvent('SINGLE', 'Copa de Verão');
    expect(ev).toMatchObject({ slug: 'copa-de-verao', participationRule: 'SINGLE', tournamentCount: 0 });
    expect(z.array(Event).parse((await call('GET', '/organizer/events')).data).map((e) => e.id)).toContain(ev.id);
    as(DIEGO);
    expect(z.array(Event).parse((await call('GET', '/organizer/events')).data).map((e) => e.id)).not.toContain(ev.id);
    expect((await call('PATCH', `/organizer/events/${ev.id}`, { name: 'Tomado' })).status).toBe(403);
    as(ANA);
    expect((await call('PATCH', `/organizer/events/${ev.id}`, { description: 'Revisado' })).status).toBe(200);
    expect(auditLogs().filter((l) => l.action === 'EVENT_CHANGED' && l.entityId === ev.id)).toHaveLength(2);
  });

  it('campeonato entra pelo assistente (eventId) e pela página do evento; sai do mesmo jeito', async () => {
    as(CAMILA);
    const ev = await newEvent('MULTIPLE');
    const created = await call('POST', '/tournaments', { name: 'Copa no evento', eventId: ev.id });
    expect(created.status).toBe(201);
    const draft = OrganizerTournamentDetail.parse(created.data);
    expect(draft.event?.id).toBe(ev.id);
    const open = openSolo('tn_ev_aberto', { ownerId: CAMILA });
    const added = await call('POST', `/organizer/events/${ev.id}/tournaments`, { tournamentId: open.id });
    expect(EventDetail.parse(added.data).tournaments.map((t) => t.id).sort()).toEqual([draft.id, open.id].sort());
    expect((await call('POST', `/organizer/events/${ev.id}/tournaments`, { tournamentId: open.id })).code).toBe('TOURNAMENT_IN_EVENT');
    // Público: só o publicado.
    as(null);
    expect(EventDetail.parse((await call('GET', `/events/${ev.slug}`)).data).tournaments.map((t) => t.id)).toEqual([open.id]);
    as(CAMILA);
    expect((await call('PATCH', `/tournaments/${draft.id}`, { eventId: null })).status).toBe(200);
    expect(EventDetail.parse((await call('DELETE', `/organizer/events/${ev.id}/tournaments/${open.id}`)).data).tournaments).toEqual([]);
    // Outro organizador não coloca o campeonato dele no evento da Camila.
    as(DIEGO);
    const diego = openSolo('tn_ev_diego', { ownerId: DIEGO });
    expect((await call('PATCH', `/tournaments/${diego.id}`, { eventId: ev.id })).status).toBe(403);
  });

  it('SINGLE: avisa antes e barra a segunda inscrição com mensagem clara; MULTIPLE deixa', async () => {
    as(CAMILA);
    const single = await newEvent('SINGLE', 'Desafio Único');
    const a = openSolo('tn_ev_a', { name: 'Copa A', eventId: single.id });
    const b = openSolo('tn_ev_b', { name: 'Copa B', eventId: single.id });
    as(BIANCA);
    expect((await call('POST', `/tournaments/${a.id}/registrations`, { acceptRules: true })).status).toBe(201);
    const elig = RegistrationEligibility.parse((await call('GET', `/tournaments/${b.id}/registration-eligibility`)).data);
    expect(elig.eventConflict).toEqual({ tournamentId: a.id, tournamentName: 'Copa A', slug: a.slug, eventName: 'Desafio Único' });
    const blocked = await call('POST', `/tournaments/${b.id}/registrations`, { acceptRules: true });
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(blocked.detail).toBe('Você já está inscrito no campeonato Copa A deste evento. Neste evento cada jogador participa de um só campeonato.');

    as(CAMILA);
    const multi = await newEvent('MULTIPLE');
    const c = openSolo('tn_ev_c', { eventId: multi.id });
    const d = openSolo('tn_ev_d', { eventId: multi.id });
    as(BIANCA);
    expect((await call('POST', `/tournaments/${c.id}/registrations`, { acceptRules: true })).status).toBe(201);
    expect((await call('POST', `/tournaments/${d.id}/registrations`, { acceptRules: true })).status).toBe(201);
    // Com ela em dois campeonatos, o evento não vira SINGLE.
    as(CAMILA);
    const change = await call('PATCH', `/organizer/events/${multi.id}`, { participationRule: 'SINGLE' });
    expect(change.code).toBe('EVENT_RULE_CONFLICT');
    expect(change.detail).toContain('1 jogador já está em mais de um campeonato deste evento');
  });

  it('SINGLE em squad: jogador confirmado na Copa Nova FF não entra no FF Solo Rush, e o evento com inscrito não é excluído', async () => {
    const reg = db().registrations.find((r) => r.tournamentId === 'tn_copa_ff' && r.status === 'CONFIRMED' && r.members.length > 0);
    const player = reg?.members[0]?.userId as string;
    mutate((d) => {
      const solo = d.tournaments.find((t) => t.slug === 'ff-solo-rush') as DbTournament;
      solo.status = 'REGISTRATION_OPEN';
      solo.registrationOpensAt = '2000-01-01T00:00:00.000Z';
      solo.registrationClosesAt = '2100-01-01T00:00:00.000Z';
    });
    as(player);
    const elig = RegistrationEligibility.parse((await call('GET', '/tournaments/ff-solo-rush/registration-eligibility')).data);
    expect(elig.eventConflict?.slug).toBe('copa-nova-ff-squad');
    expect((await call('POST', '/tournaments/ff-solo-rush/registrations', { acceptRules: true })).code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    as(CAMILA);
    expect((await call('DELETE', '/organizer/events/ev_festival_ff')).code).toBe('EVENT_HAS_TOURNAMENTS');
  });
});
