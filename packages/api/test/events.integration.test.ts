/**
 * Eventos (ADR-0005) contra um Postgres de verdade: um evento agrupa campeonatos e a regra `SINGLE` impede que o
 * jogador participe de mais de um campeonato do evento (solo, squad e confirmação de membro). Permissões, inclusão
 * de campeonato, troca de regra com conflito, aviso de elegibilidade e a página pública.
 */
import { Event, EventDetail, OrganizerTournamentDetail, RegistrationEligibility, Tournament } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('eventos (Postgres)', { timeout: 120_000 }, () => {
  let h: Harness;
  let solo: Awaited<ReturnType<Harness['game']>>;
  let squad = { id: '', modeId: '', modelId: '' };
  const nick = new Map<string, string>();

  /** Campeonato com inscrições abertas (solo ou squad), opcionalmente já num evento. */
  async function openTournament(owner: string, opts: { team?: boolean; eventId?: string | null; name?: string; status?: string } = {}) {
    const game = opts.team ? squad : { id: solo.id, modeId: solo.modeId, modelId: solo.model('coroas') };
    const t = await h.db.tournament.create({
      data: {
        slug: `ev-${randomUUID().slice(0, 8)}`,
        name: opts.name ?? `Copa ${randomUUID().slice(0, 4)}`,
        gameId: game.id,
        gameModeId: game.modeId,
        ownerId: h.id(owner),
        status: (opts.status ?? 'REGISTRATION_OPEN') as never,
        participantType: opts.team ? 'TEAM' : 'SOLO',
        maxParticipants: 16,
        eventId: opts.eventId ?? null,
      },
    });
    await h.db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Chave', format: 'SINGLE_ELIM', scoringModelId: game.modelId, tiebreakers: ['points'] } });
    return t;
  }

  async function newEvent(owner: string, rule: 'SINGLE' | 'MULTIPLE', name = 'Festival Nova Arena') {
    const res = await h.call(owner, '/organizer/events', { method: 'POST', body: { name, participationRule: rule } });
    expect(res.status, res.detail).toBe(201);
    return Event.parse(res.data);
  }

  const register = (who: string, tournamentId: string, teamId?: string) => h.call(who, `/tournaments/${tournamentId}/registrations`, { method: 'POST', body: { acceptRules: true, ...(teamId ? { teamId } : {}) } });

  async function team(captain: string, members: string[]) {
    return h.db.team.create({
      data: {
        name: `Squad ${randomUUID().slice(0, 4)}`,
        tag: `E${randomUUID().slice(0, 4).toUpperCase()}`,
        captainId: h.id(captain),
        members: { create: [{ userId: h.id(captain), role: 'CAPTAIN' }, ...members.map((m) => ({ userId: h.id(m) }))] },
      },
    });
  }

  beforeAll(async () => {
    h = await createHarness(url as string, 'ev');
    for (const [k, roles] of [
      ['org', ['ORGANIZER', 'PARTICIPANT']],
      ['org2', ['ORGANIZER', 'PARTICIPANT']],
      ['adm', ['ADMIN', 'PARTICIPANT']],
      ['ana', ['PARTICIPANT']],
      ['bia', ['PARTICIPANT']],
      ['caio', ['PARTICIPANT']],
      ['davi', ['PARTICIPANT']],
      ['edu', ['PARTICIPANT']],
    ] as const) {
      nick.set(k, (await h.user(k, [...roles])).nickname);
    }
    solo = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const g = await h.db.game.create({
      data: {
        slug: `ev-squad-${randomUUID().slice(0, 8)}`,
        name: 'Jogo de squad',
        icon: '👑',
        modes: { create: { name: '2x2', teamSize: 2, maxSubs: 0, matchType: 'TEAM_VS_TEAM' } },
        scoringModels: { create: { name: 'V', matchType: 'TEAM_VS_TEAM', rules: SERIES_RULES as never, tiebreakers: ['points'], isDefault: true } },
      },
      include: { modes: true, scoringModels: true },
    });
    squad = { id: g.id, modeId: g.modes[0]?.id ?? '', modelId: g.scoringModels[0]?.id ?? '' };
  });

  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('só quem organiza cria evento; participante e visitante não', async () => {
    expect((await h.call('ana', '/organizer/events', { method: 'POST', body: { name: 'Evento da Ana' } })).status).toBe(403);
    expect((await h.call(null, '/organizer/events', { method: 'POST', body: { name: 'Evento anônimo' } })).status).toBe(401);
    expect((await h.call('ana', '/organizer/events')).status).toBe(403);
    const ev = await newEvent('org', 'SINGLE', 'Copa de Verão');
    expect(ev).toMatchObject({ name: 'Copa de Verão', participationRule: 'SINGLE', tournamentCount: 0, owner: { id: h.id('org') } });
    expect(ev.slug).toMatch(/^copa-de-verao/);
    // Regra padrão: vários campeonatos.
    const multi = await h.call('org', '/organizer/events', { method: 'POST', body: { name: 'Sem regra informada' } });
    expect(Event.parse(multi.data).participationRule).toBe('MULTIPLE');
    expect(await h.auditCount({ action: 'EVENT_CHANGED', entityId: ev.id })).toBe(1);
    // A lista do organizador mostra só os próprios eventos.
    const mine = z.array(Event).parse((await h.call('org', '/organizer/events')).data);
    expect(mine.map((e) => e.id)).toContain(ev.id);
    expect(z.array(Event).parse((await h.call('org2', '/organizer/events')).data).map((e) => e.id)).not.toContain(ev.id);
  });

  it('outro organizador não edita nem usa o evento; Admin edita', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    expect((await h.call('org2', `/organizer/events/${ev.id}`, { method: 'PATCH', body: { name: 'Tomado' } })).status).toBe(403);
    expect((await h.call('org2', `/organizer/events/${ev.id}`)).status).toBe(403);
    const t2 = await openTournament('org2');
    // Campeonato do outro organizador não entra no meu evento sem ser dele…
    expect((await h.call('org', `/organizer/events/${ev.id}/tournaments`, { method: 'POST', body: { tournamentId: t2.id } })).status).toBe(403);
    // …nem ele coloca o campeonato dele no meu evento pelo assistente.
    expect((await h.call('org2', `/tournaments/${t2.id}`, { method: 'PATCH', body: { eventId: ev.id } })).status).toBe(403);
    const adm = await h.call('adm', `/organizer/events/${ev.id}`, { method: 'PATCH', body: { description: 'Revisado pela administração' } });
    expect(adm.status, adm.detail).toBe(200);
    expect(Event.parse(adm.data).description).toBe('Revisado pela administração');
  });

  it('campeonatos entram no evento pelo assistente e pela página do evento; a página pública mostra só os publicados', async () => {
    const ev = await newEvent('org', 'MULTIPLE', 'Semana Gamer');
    // Criação já dentro do evento.
    const created = await h.call('org', '/tournaments', { method: 'POST', body: { name: 'Copa 1v1 da Semana', gameId: solo.id, gameModeId: solo.modeId, eventId: ev.id } });
    expect(created.status, created.detail).toBe(201);
    const draft = OrganizerTournamentDetail.parse(created.data);
    expect(draft.event).toMatchObject({ id: ev.id, name: 'Semana Gamer', participationRule: 'MULTIPLE' });
    // Campeonato existente entra pela página do evento.
    const open = await openTournament('org', { name: 'Copa Aberta da Semana' });
    const added = await h.call('org', `/organizer/events/${ev.id}/tournaments`, { method: 'POST', body: { tournamentId: open.id } });
    expect(added.status, added.detail).toBe(200);
    expect(EventDetail.parse(added.data).tournaments.map((t) => t.id).sort()).toEqual([draft.id, open.id].sort());
    expect((await h.call('org', `/organizer/events/${ev.id}/tournaments`, { method: 'POST', body: { tournamentId: open.id } })).code).toBe('TOURNAMENT_IN_EVENT');

    // Público: só o publicado aparece; a página do campeonato mostra o evento.
    const pub = EventDetail.parse((await h.call(null, `/events/${ev.slug}`)).data);
    expect(pub.tournaments.map((t) => t.id)).toEqual([open.id]);
    expect(pub.tournamentCount).toBe(1);
    const page = Tournament.parse((await h.call(null, `/tournaments/${open.slug}`)).data);
    expect(page.event).toMatchObject({ id: ev.id, slug: ev.slug });

    // Evento sem nada publicado não existe para o público.
    const empty = await newEvent('org', 'MULTIPLE', 'Evento vazio');
    expect((await h.call(null, `/events/${empty.slug}`)).status).toBe(404);

    // Tirar do evento pelo assistente (`eventId: null`) e pela página do evento.
    expect((await h.call('org', `/tournaments/${draft.id}`, { method: 'PATCH', body: { eventId: null } })).status).toBe(200);
    const out = await h.call('org', `/organizer/events/${ev.id}/tournaments/${open.id}`, { method: 'DELETE' });
    expect(out.status, out.detail).toBe(200);
    expect(EventDetail.parse(out.data).tournaments).toEqual([]);
  });

  it('campeonato em andamento não entra nem sai do evento', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    const running = await openTournament('org', { status: 'IN_PROGRESS', eventId: ev.id });
    expect((await h.call('org', `/organizer/events/${ev.id}/tournaments/${running.id}`, { method: 'DELETE' })).code).toBe('EVENT_LOCKED');
    const other = await openTournament('org', { status: 'IN_PROGRESS' });
    expect((await h.call('org', `/organizer/events/${ev.id}/tournaments`, { method: 'POST', body: { tournamentId: other.id } })).code).toBe('EVENT_LOCKED');
  });

  it('SINGLE: o jogador solo entra em um só campeonato do evento, com mensagem clara e aviso antes', async () => {
    const ev = await newEvent('org', 'SINGLE', 'Desafio Único');
    const a = await openTournament('org', { eventId: ev.id, name: 'Copa A' });
    const b = await openTournament('org', { eventId: ev.id, name: 'Copa B' });
    const avulso = await openTournament('org', { name: 'Copa Avulsa' });

    expect(RegistrationEligibility.parse((await h.call('ana', `/tournaments/${b.id}/registration-eligibility`)).data).eventConflict).toBeNull();
    expect((await register('ana', a.id)).status).toBe(201);

    const elig = RegistrationEligibility.parse((await h.call('ana', `/tournaments/${b.id}/registration-eligibility`)).data);
    expect(elig.eventConflict).toEqual({ tournamentId: a.id, tournamentName: 'Copa A', slug: a.slug, eventName: 'Desafio Único' });

    const blocked = await register('ana', b.id);
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(blocked.detail).toBe('Você já está inscrito no campeonato Copa A deste evento. Neste evento cada jogador participa de um só campeonato.');
    // Campeonato fora do evento não é afetado.
    expect((await register('ana', avulso.id)).status).toBe(201);

    // Cancelou a inscrição na Copa A: pode ir para a Copa B.
    const mine = await h.db.registration.findFirstOrThrow({ where: { tournamentId: a.id, userId: h.id('ana') } });
    expect((await h.call('ana', `/registrations/${mine.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await register('ana', b.id)).status).toBe(201);
  });

  it('MULTIPLE: o jogador entra em vários campeonatos do evento', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    const a = await openTournament('org', { eventId: ev.id });
    const b = await openTournament('org', { eventId: ev.id });
    expect((await register('bia', a.id)).status).toBe(201);
    expect((await register('bia', b.id)).status).toBe(201);
    expect(RegistrationEligibility.parse((await h.call('bia', `/tournaments/${b.id}/registration-eligibility`)).data).eventConflict).toBeNull();
  });

  it('SINGLE em squad: barra o squad com jogador confirmado em outro campeonato e barra a confirmação do membro', async () => {
    const ev = await newEvent('org', 'SINGLE', 'Liga dos Squads');
    const a = await openTournament('org', { eventId: ev.id, team: true, name: 'Squads A' });
    const b = await openTournament('org', { eventId: ev.id, team: true, name: 'Squads B' });

    // Caio (capitão) inscreve o squad com Davi na Copa A; Davi confirma.
    const alfa = await team('caio', ['davi']);
    const regA = await register('caio', a.id, alfa.id);
    expect(regA.status, regA.detail).toBe(201);
    const regAId = (regA.data as { id: string }).id;
    expect((await h.call('davi', `/registrations/${regAId}/confirm`, { method: 'POST' })).status).toBe(200);

    // Edu tenta inscrever, na Copa B, um squad com o Davi: barrado, com o nome do jogador.
    const beta = await team('edu', ['davi']);
    const blocked = await register('edu', b.id, beta.id);
    expect(blocked.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(blocked.detail).toBe(`${nick.get('davi')} já está inscrito no campeonato Squads A deste evento. Neste evento cada jogador participa de um só campeonato.`);

    // Membro convocado que ainda não confirmou não conta: Bia é convocada nos dois, mas só confirma em um.
    const gama = await team('ana', ['bia']);
    const delta = await team('edu', ['bia']);
    // Ana já tem inscrição no outro teste (solo, em outro evento): não interfere aqui.
    const regG = await register('ana', a.id, gama.id);
    expect(regG.status, regG.detail).toBe(201);
    const regD = await register('edu', b.id, delta.id);
    expect(regD.status, regD.detail).toBe(201);
    expect((await h.call('bia', `/registrations/${(regG.data as { id: string }).id}/confirm`, { method: 'POST' })).status).toBe(200);
    const second = await h.call('bia', `/registrations/${(regD.data as { id: string }).id}/confirm`, { method: 'POST' });
    expect(second.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(second.detail).toBe('Você já está inscrito no campeonato Squads A deste evento. Neste evento cada jogador participa de um só campeonato.');
  });

  it('trocar para SINGLE com jogador em dois campeonatos do evento dá 409 com a contagem; incluir campeonato que cria conflito também', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    const a = await openTournament('org', { eventId: ev.id });
    const b = await openTournament('org', { eventId: ev.id });
    expect((await register('caio', a.id)).status).toBe(201);
    expect((await register('caio', b.id)).status).toBe(201);
    const res = await h.call('org', `/organizer/events/${ev.id}`, { method: 'PATCH', body: { participationRule: 'SINGLE' } });
    expect(res.status).toBe(409);
    expect(res.code).toBe('EVENT_RULE_CONFLICT');
    expect(res.detail).toContain('1 jogador já está em mais de um campeonato deste evento');

    // Num evento SINGLE, incluir um campeonato com alguém que já está em outro do evento: 409.
    const single = await newEvent('org', 'SINGLE');
    const c1 = await openTournament('org', { eventId: single.id });
    const c2 = await openTournament('org');
    expect((await register('davi', c1.id)).status).toBe(201);
    expect((await register('davi', c2.id)).status).toBe(201);
    const add = await h.call('org', `/organizer/events/${single.id}/tournaments`, { method: 'POST', body: { tournamentId: c2.id } });
    expect(add.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(add.detail).toContain('1 jogador inscrito neste campeonato já está em outro campeonato do evento');
    expect((await h.call('org', `/tournaments/${c2.id}`, { method: 'PATCH', body: { eventId: single.id } })).code).toBe('EVENT_SINGLE_CHAMPIONSHIP');

    // Sem conflito, a troca para SINGLE passa e fica auditada.
    const clean = await newEvent('org', 'MULTIPLE');
    const ok = await h.call('org', `/organizer/events/${clean.id}`, { method: 'PATCH', body: { participationRule: 'SINGLE' } });
    expect(ok.status, ok.detail).toBe(200);
    expect(await h.auditCount({ action: 'EVENT_CHANGED', entityId: clean.id })).toBe(2);
  });

  it('excluir evento: só sem campeonato publicado; os campeonatos continuam, avulsos', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    const pub = await openTournament('org', { eventId: ev.id });
    expect((await h.call('org', `/organizer/events/${ev.id}`, { method: 'DELETE' })).code).toBe('EVENT_HAS_TOURNAMENTS');
    await h.db.tournament.update({ where: { id: pub.id }, data: { status: 'DRAFT' } });
    expect((await h.call('org2', `/organizer/events/${ev.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await h.call('org', `/organizer/events/${ev.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await h.db.tournament.findUniqueOrThrow({ where: { id: pub.id } })).eventId).toBeNull();
  });

  it('duplicar campeonato mantém o evento para quem organiza o evento', async () => {
    const ev = await newEvent('org', 'MULTIPLE');
    const t = await openTournament('org', { eventId: ev.id });
    const copy = await h.call('org', `/tournaments/${t.id}/duplicate`, { method: 'POST' });
    expect(copy.status, copy.detail).toBe(201);
    expect(OrganizerTournamentDetail.parse(copy.data).event?.id).toBe(ev.id);
  });
});
