/**
 * Campeonatos (visão global), comunicados globais, auditoria (consulta, CSV em streaming, somente leitura, visão do
 * organizador), moderação (denúncias, ações rápidas, disputas escaladas) e os KPIs com a North Star, contra o Postgres.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { applyResult, applyWalkover } from '@nova/engine';
import { AdminReport, AdminStats, AdminTournament, AuditLog, AuditMeta, Dispute, GlobalAnnouncement, LockedStage, numberedPage, Report, SanctionResult, SiteBannerItem } from '@nova/schemas';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readRun, snapshotOf } from '../src/competition/run';
import { concludedMatches } from '../src/modules/admin/stats';
import { ANNOUNCEMENT_BATCH, ANNOUNCEMENT_JOB_PATH } from '../src/modules/admin/tournaments';
import { auditCount, createHarness, lastAudit, type Harness } from './fixtures/admin';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600_000;
const QSTASH = { QSTASH_TOKEN: 'token-de-teste', QSTASH_CURRENT_SIGNING_KEY: 'chave-atual-de-teste', QSTASH_NEXT_SIGNING_KEY: 'chave-proxima-de-teste', NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg' };

async function qstashSignature(body: string, path: string): Promise<string> {
  return new SignJWT({ body: createHash('sha256').update(body).digest('base64url') })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('Upstash')
    .setSubject(`https://novaarena.gg/api/v1${path}`)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(QSTASH.QSTASH_CURRENT_SIGNING_KEY));
}

describe.skipIf(!url)('painel Admin: campeonatos, comunicados, auditoria e moderação (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  let gameId = '';
  let modeId = '';
  let modelId = '';
  const t: Record<string, string> = {};
  let stageId = '';
  const id = (key: string) => h.people.get(key)?.id ?? '';

  async function tournament(key: string, owner: string, status: 'DRAFT' | 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED' | 'REGISTRATION_CLOSED', name: string) {
    const row = await db.tournament.create({ data: { slug: `${key}-${h.stamp}`, name, gameId, gameModeId: modeId, ownerId: id(owner), status, participantType: 'SOLO', maxParticipants: 16 } });
    t[key] = row.id;
    return row;
  }

  beforeAll(async () => {
    // Folga no pool: o lote da notificação grava 200 avisos em sequência enquanto os outros arquivos rodam.
    db = createDb({ connectionString: url, max: 10 });
    h = createHarness(db, 'op', QSTASH);
    await h.makeUser('rafael', ['SUPER_ADMIN', 'ADMIN']);
    await h.makeUser('ana', ['ADMIN']);
    await h.makeUser('camila', ['ORGANIZER']);
    await h.makeUser('diego', ['ORGANIZER']);
    await h.makeUser('bianca', []);
    await h.makeUser('lucas', []);
    await h.makeUser('coorg', []);
    await h.makeUser('mod', []);
    const game = await db.game.create({
      data: { slug: `op-${h.stamp}`, name: `Jogo OP ${h.stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    gameId = game.id;
    modeId = game.modes[0]?.id ?? '';
    modelId = game.scoringModels[0]?.id ?? '';
    await tournament('copa', 'camila', 'REGISTRATION_OPEN', `Copa Nova ${h.stamp}`);
    await tournament('efoot', 'diego', 'REGISTRATION_OPEN', `Copa eFoot ${h.stamp}`);
    await tournament('draft', 'camila', 'DRAFT', `Rascunho ${h.stamp}`);
    await tournament('open8', 'diego', 'FINISHED', `Open Oito ${h.stamp}`);
    await tournament('liga', 'camila', 'REGISTRATION_CLOSED', `Liga Clash ${h.stamp}`);
    await db.tournamentStaff.createMany({
      data: [
        { tournamentId: t.copa as string, userId: id('coorg'), role: 'CO_ORGANIZER', addedById: id('camila') },
        { tournamentId: t.copa as string, userId: id('mod'), role: 'MODERATOR', addedById: id('camila') },
      ],
    });

    // Liga com chave confirmada: 8 inscritos; 3 partidas com resultado (uma por W.O.).
    stageId = (await db.stage.create({ data: { tournamentId: t.liga as string, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: modelId, tiebreakers: ['points'], config: { bestOf: 1 } } })).id;
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    for (const [i, key] of players.entries()) {
      await h.makeUser(key, []);
      await db.registration.create({ data: { tournamentId: t.liga as string, userId: id(key), status: 'CONFIRMED', createdAt: new Date(Date.now() + i) } });
    }
    expect((await h.call('camila', 'POST', `/stages/${stageId}/generate`, { seeding: 'RANDOM', seed: 'op' })).status).toBe(200);
    expect((await h.call('camila', 'POST', `/stages/${stageId}/confirm`)).status).toBe(200);
    const run = readRun(await db.stage.findUniqueOrThrow({ where: { id: stageId } }));
    if (!run) throw new Error('sem chave');
    const firstRound = run.structure.matches.filter((m) => m.round === 1 && m.slots.every((s) => s.entrantId)).slice(0, 3);
    let { structure, state } = run;
    for (const [i, m] of firstRound.entries()) {
      const [x, y] = m.slots.map((s) => s.entrantId as string);
      ({ structure, state } = i === 2 ? applyWalkover(structure, state, { matchId: m.id, winnerId: x as string }) : applyResult(structure, state, { matchId: m.id, entries: [{ entrantId: x as string, score: 2 }, { entrantId: y as string, score: 0 }] }));
    }
    await db.stage.update({ where: { id: stageId }, data: { engineSnapshot: snapshotOf(structure, state) } });
    await db.tournament.update({ where: { id: t.liga as string }, data: { status: 'IN_PROGRESS' } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Campeonatos ────────────────────────────────────────────────────
  describe('campeonatos: visão global', () => {
    it('lista todos, inclusive rascunhos, com busca (nome, endereço, jogo, responsável) e filtro de status', async () => {
      const Page = numberedPage(AdminTournament);
      const all = Page.parse((await h.call('ana', 'GET', `/admin/tournaments?q=${h.stamp}`)).data);
      expect(all.total).toBe(5);
      expect(all.items.find((x) => x.id === t.draft)?.status).toBe('DRAFT');
      expect(Page.parse((await h.call('ana', 'GET', `/admin/tournaments?q=${h.stamp}&status=FINISHED`)).data).items.map((x) => x.id)).toEqual([t.open8]);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/tournaments?q=clash ${h.stamp}`)).data).items.map((x) => x.id)).toEqual([t.liga]);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/tournaments?q=${h.people.get('diego')?.nickname}`)).data).total).toBe(2);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/tournaments?q=jogo op ${h.stamp}`)).data).total).toBe(5);
    });

    it('destacar na home: só campeonato público; repetir não gera auditoria', async () => {
      expect((await h.call('ana', 'PATCH', `/admin/tournaments/${t.draft}`, { featured: true })).code).toBe('NOT_PUBLIC');
      const res = await h.call('ana', 'PATCH', `/admin/tournaments/${t.efoot}`, { featured: true });
      expect(AdminTournament.parse(res.data).featured).toBe(true);
      expect(await lastAudit(db, 'TOURNAMENT_FEATURED', { tournamentId: t.efoot })).toMatchObject({ actorId: id('ana'), before: { featured: false }, after: { featured: true } });
      await h.call('ana', 'PATCH', `/admin/tournaments/efoot-${h.stamp}`, { featured: true });
      expect(await auditCount(db, 'TOURNAMENT_FEATURED', { tournamentId: t.efoot })).toBe(1);
    });

    it('trocar o responsável: o novo precisa ser organizador ativo; auditado; o novo passa a ver a auditoria e o antigo não', async () => {
      expect((await h.call('ana', 'POST', `/admin/tournaments/${t.copa}/owner`, { ownerId: id('bianca'), reason: 'Tentativa com participante' })).code).toBe('NOT_ORGANIZER');
      expect((await h.call('ana', 'POST', `/admin/tournaments/${t.copa}/owner`, { ownerId: id('camila'), reason: 'Mesma dona de antes' })).code).toBe('SAME_OWNER');
      expect((await h.call('ana', 'POST', `/admin/tournaments/${t.copa}/owner`, { ownerId: id('diego') })).status).toBe(400);
      const res = await h.call('ana', 'POST', `/admin/tournaments/${t.copa}/owner`, { ownerId: id('diego'), reason: 'Camila pediu para sair da organização' });
      expect(AdminTournament.parse(res.data)).toMatchObject({ ownerId: id('diego'), ownerNickname: h.people.get('diego')?.nickname });
      expect(await lastAudit(db, 'TOURNAMENT_OWNER_CHANGED', { tournamentId: t.copa })).toMatchObject({
        actorId: id('ana'),
        before: { ownerId: id('camila'), responsavel: h.people.get('camila')?.nickname },
        after: { ownerId: id('diego'), responsavel: h.people.get('diego')?.nickname },
        reason: 'Camila pediu para sair da organização',
      });
      expect(await db.notification.count({ where: { userId: id('camila'), title: 'Você deixou de ser responsável por um campeonato' } })).toBe(1);
      expect((await h.call('diego', 'GET', `/tournaments/${t.copa}/audit-logs`)).status).toBe(200);
      expect((await h.call('camila', 'GET', `/tournaments/${t.copa}/audit-logs`)).status).toBe(403);
    });

    it('lista as fases travadas (com partida concluída)', async () => {
      const locked = z.array(LockedStage).parse((await h.call('ana', 'GET', `/admin/tournaments/${t.liga}/locked-stages`)).data);
      expect(locked).toEqual([{ stageId, stageName: 'Mata-mata', tournamentId: t.liga, tournamentName: `Liga Clash ${h.stamp}`, completedMatches: 3 }]);
      expect(z.array(LockedStage).parse((await h.call('ana', 'GET', `/admin/tournaments/${t.copa}/locked-stages`)).data)).toEqual([]);
      expect((await h.call('ana', 'GET', '/admin/tournaments/nao-existe/locked-stages')).status).toBe(404);
    });
  });

  // ── KPIs e North Star ──────────────────────────────────────────────
  describe('dashboard: indicadores', () => {
    it('North Star conta partidas com resultado validado; W.O. entra na taxa de W.O. e não conta como validada', async () => {
      const mine = (await concludedMatches(db, Date.now() - HOUR)).filter((m) => m.tournamentId === t.liga);
      expect(mine).toHaveLength(3);
      expect(mine.filter((m) => m.walkover)).toHaveLength(1);
      const stats = AdminStats.parse((await h.call('ana', 'GET', '/admin/stats')).data);
      expect(stats.validatedMatchesThisWeek).toBeGreaterThanOrEqual(2);
      expect(stats.signups).toHaveLength(30);
      expect(stats.totalUsers).toBeGreaterThanOrEqual(h.people.size);
      expect(stats.activeTournaments).toBeGreaterThanOrEqual(3);
      expect(stats.tournamentsByGame.find((g) => g.gameName === `Jogo OP ${h.stamp}`)?.count).toBe(4);
      const week = AdminStats.parse((await h.call('ana', 'GET', `/admin/stats?from=${new Date(Date.now() - 6 * 24 * HOUR).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`)).data);
      expect(week.signups).toHaveLength(7);
      expect(week.signups.reduce((s, d) => s + d.count, 0)).toBeGreaterThanOrEqual(h.people.size);
    });
  });

  // ── Comunicados globais ────────────────────────────────────────────
  describe('comunicados globais e aviso no topo do site', () => {
    const banner = { body: 'Ranking por jogo no ar.', kind: 'BANNER', audience: 'ALL', gameId: null, startsAt: null, endsAt: null };
    const Banners = z.array(SiteBannerItem);
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    const shown = async (who: string | null = null) => Banners.parse((await h.call(who, 'GET', '/site/banner')).data);

    it('banner aparece para todos e some quando é desativado; tudo auditado', async () => {
      const created = GlobalAnnouncement.parse((await h.call('ana', 'POST', '/admin/announcements', { ...banner, title: `Novidade ${h.stamp}` })).data);
      expect(created).toMatchObject({ active: true, authorNickname: h.people.get('ana')?.nickname, kind: 'BANNER' });
      expect(await lastAudit(db, 'ANNOUNCEMENT_SENT', { entityId: created.id })).toMatchObject({ actorId: id('ana'), after: { tipo: 'BANNER', publico: 'Todos' } });
      expect((await shown()).find((b) => b.id === created.id)).toEqual({ id: created.id, kind: 'BANNER', title: `Novidade ${h.stamp}`, body: 'Ranking por jogo no ar.', startsAt: null, endsAt: null, ongoing: false, dismissible: true });
      expect(GlobalAnnouncement.parse((await h.call('ana', 'PATCH', `/admin/announcements/${created.id}`, { active: false })).data).active).toBe(false);
      expect(await lastAudit(db, 'ANNOUNCEMENT_TOGGLED', { entityId: created.id })).toMatchObject({ before: { active: true }, after: { active: false } });
      expect((await shown()).some((b) => b.id === created.id)).toBe(false);
      expect(z.array(GlobalAnnouncement).parse((await h.call('ana', 'GET', '/admin/announcements')).data).some((a) => a.id === created.id)).toBe(true);
    });

    it('manutenção exige início e fim, aparece 48 h antes e não pode ser dispensada enquanto acontece', async () => {
      const maintenance = { title: `Manutenção ${h.stamp}`, body: 'O site fica fora do ar por 1 hora.', kind: 'MAINTENANCE', audience: 'ALL', gameId: null };
      expect((await h.call('ana', 'POST', '/admin/announcements', { ...maintenance, startsAt: null, endsAt: null })).status).toBe(400);
      expect((await h.call('ana', 'POST', '/admin/announcements', { ...maintenance, startsAt: iso(2 * HOUR), endsAt: iso(HOUR) })).status).toBe(400);
      const far = GlobalAnnouncement.parse((await h.call('ana', 'POST', '/admin/announcements', { ...maintenance, title: 'Distante', startsAt: iso(72 * HOUR), endsAt: iso(73 * HOUR) })).data);
      const soon = GlobalAnnouncement.parse((await h.call('ana', 'POST', '/admin/announcements', { ...maintenance, startsAt: iso(24 * HOUR), endsAt: iso(25 * HOUR) })).data);
      let items = await shown();
      expect(items.some((b) => b.id === far.id)).toBe(false);
      expect(items.find((b) => b.id === soon.id)).toMatchObject({ kind: 'MAINTENANCE', ongoing: false, dismissible: true });
      try {
        h.clock.now = new Date(Date.now() + 24 * HOUR + 10 * 60_000);
        items = await shown();
        expect(items.find((b) => b.id === soon.id)).toMatchObject({ ongoing: true, dismissible: false });
        expect(items.find((b) => b.id === far.id)).toMatchObject({ ongoing: false, dismissible: true });
        expect(items[0]?.ongoing).toBe(true);
        h.clock.now = new Date(Date.now() + 26 * HOUR + 10 * 60_000);
        items = await shown();
        expect(items.some((b) => b.id === soon.id)).toBe(false);
        expect(items.some((b) => b.id === far.id)).toBe(true);
      } finally {
        h.clock.now = null;
      }
    });

    it('público "inscritos de um jogo": só quem joga ou segue o jogo vê o banner; notificação não vira banner', async () => {
      expect((await h.call('ana', 'POST', '/admin/announcements', { ...banner, title: 'Sem jogo', audience: 'GAME', gameId: null })).status).toBe(400);
      const created = GlobalAnnouncement.parse((await h.call('ana', 'POST', '/admin/announcements', { ...banner, title: `Temporada ${h.stamp}`, audience: 'GAME', gameId })).data);
      expect(created).toMatchObject({ audience: 'GAME', gameId });
      expect((await shown()).some((b) => b.id === created.id)).toBe(false);
      expect((await shown('p1')).some((b) => b.id === created.id)).toBe(true);
      expect((await shown('lucas')).some((b) => b.id === created.id)).toBe(false);
      await db.follow.create({ data: { userId: id('lucas'), targetType: 'GAME', targetId: gameId } });
      expect((await shown('lucas')).some((b) => b.id === created.id)).toBe(true);

      const before = await db.notification.count({ where: { userId: { in: ['p1', 'p2', 'lucas', 'bianca'].map(id) } } });
      const res = await h.call('ana', 'POST', '/admin/announcements', { title: `Aviso do jogo ${h.stamp}`, body: 'Nova temporada começa amanhã.', kind: 'NOTIFICATION', audience: 'GAME', gameId, startsAt: null, endsAt: null });
      const sent = GlobalAnnouncement.parse(res.data);
      expect(sent.active).toBe(false);
      // 8 jogadores da liga + quem segue o jogo.
      expect(await db.notification.count({ where: { title: `Aviso do jogo ${h.stamp}` } })).toBe(9);
      expect(await db.notification.count({ where: { userId: id('bianca'), title: `Aviso do jogo ${h.stamp}` } })).toBe(0);
      expect(await db.notification.count({ where: { userId: { in: ['p1', 'p2', 'lucas', 'bianca'].map(id) } } })).toBe(before + 3);
      expect(await lastAudit(db, 'ANNOUNCEMENT_SENT', { entityId: sent.id })).toMatchObject({ after: { tipo: 'NOTIFICATION', publico: `Inscritos de um jogo: Jogo OP ${h.stamp}`, destinatarios: 9 } });
      expect((await shown('p1')).some((b) => b.id === sent.id)).toBe(false);
      expect((await h.call('ana', 'PATCH', `/admin/announcements/${sent.id}`, { active: true })).code).toBe('NOT_TOGGLEABLE');
    });

    it('notificação para público grande sai em lotes pela fila (QStash), um lote por mensagem', async () => {
      const big = await db.game.create({ data: { slug: `op-big-${h.stamp}`, name: `Jogo Grande ${h.stamp}` } });
      const total = ANNOUNCEMENT_BATCH * 2 + 17;
      await db.user.createMany({ data: Array.from({ length: total }, (_, i) => ({ email: `op.big.${i}.${h.stamp}@exemplo.com`, nickname: `ob${i}x${h.stamp}`, nicknameKey: `ob${i}x${h.stamp}` })) });
      const ids = (await db.user.findMany({ where: { email: { startsWith: 'op.big.', endsWith: `.${h.stamp}@exemplo.com` } }, select: { id: true } })).map((u) => u.id);
      await db.follow.createMany({ data: ids.map((userId) => ({ userId, targetType: 'GAME' as const, targetId: big.id })) });
      const jobsBefore = h.jobs.length;
      const res = await h.call('ana', 'POST', '/admin/announcements', { title: `Grande ${h.stamp}`, body: 'Aviso para muita gente.', kind: 'NOTIFICATION', audience: 'GAME', gameId: big.id, startsAt: null, endsAt: null });
      expect(res.status).toBe(201);
      const created = GlobalAnnouncement.parse(res.data);
      const count = () => db.notification.count({ where: { title: `Grande ${h.stamp}` } });
      // Na requisição: só o primeiro lote. O resto foi para a fila.
      expect(await count()).toBe(ANNOUNCEMENT_BATCH);
      const job = h.jobs.slice(jobsBefore).find((j) => j.path === ANNOUNCEMENT_JOB_PATH);
      expect(job?.body).toMatchObject({ announcementId: created.id });

      // O QStash entrega a mensagem (assinada); cada lote agenda o próximo.
      let next = job;
      let rounds = 0;
      while (next && rounds < 5) {
        const raw = JSON.stringify(next.body);
        const before = h.jobs.length;
        const delivered = await h.app.request(`/api/v1${ANNOUNCEMENT_JOB_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Upstash-Signature': await qstashSignature(raw, ANNOUNCEMENT_JOB_PATH) }, body: raw });
        expect(delivered.status).toBe(200);
        next = h.jobs.slice(before).find((j) => j.path === ANNOUNCEMENT_JOB_PATH);
        rounds += 1;
      }
      expect(rounds).toBe(2);
      expect(await count()).toBe(total);
      // Sem assinatura, ninguém dispara um lote.
      expect((await h.app.request(`/api/v1${ANNOUNCEMENT_JOB_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    });
  });

  // ── Auditoria ──────────────────────────────────────────────────────
  describe('auditoria: consulta, filtros, CSV e somente leitura', () => {
    it('lista do mais recente para o mais antigo, com rótulo da ação, IP e filtros', async () => {
      await h.call('ana', 'POST', `/admin/users/${id('bianca')}/sanctions`, { type: 'WARNING', reason: 'Nick ofensivo' });
      await h.call('rafael', 'POST', `/admin/tournaments/${t.efoot}/owner`, { ownerId: id('camila'), reason: '=CMD("calc") tentativa de fórmula' });
      const Page = numberedPage(AuditLog);
      const efoot = Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?tournamentId=${t.efoot}`)).data);
      expect(efoot.items.map((l) => l.action)).toEqual(['TOURNAMENT_OWNER_CHANGED', 'TOURNAMENT_FEATURED']);
      expect(efoot.items[0]).toMatchObject({ actorNickname: h.people.get('rafael')?.nickname, actionLabel: 'Responsável do campeonato trocado', entityLabel: `Copa eFoot ${h.stamp}`, ip: '203.0.113.10' });
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?tournamentId=${t.efoot}&action=TOURNAMENT_FEATURED`)).data).total).toBe(1);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?actor=${h.people.get('rafael')?.nickname}&tournamentId=${t.efoot}`)).data).total).toBe(1);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?actor=${id('rafael')}&tournamentId=${t.efoot}`)).data).total).toBe(1);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?entityId=${id('bianca')}`)).data).items.map((l) => l.action)).toContain('USER_SANCTIONED');
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?entityType=Tournament&tournamentId=${t.efoot}`)).data).total).toBe(2);
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?tournamentId=${t.efoot}&from=${today}&to=${today}`)).data).total).toBe(2);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/audit-logs?tournamentId=${t.efoot}&to=${yesterday}`)).data).total).toBe(0);
      expect(Page.parse((await h.call('ana', 'GET', '/admin/audit-logs?tournamentId=nao-e-uuid')).data).total).toBe(0);
      const meta = AuditMeta.parse((await h.call('ana', 'GET', '/admin/audit-logs/meta')).data);
      expect(meta.actions).toContainEqual({ value: 'USER_SANCTIONED', label: 'Usuário sancionado' });
      expect(meta.entityTypes).toContain('Tournament');
    });

    it('exporta CSV em streaming com os filtros, BOM UTF-8 e ponto e vírgula, sem virar fórmula na planilha', async () => {
      const { res } = await h.call('ana', 'GET', `/admin/audit-logs.csv?entityType=Tournament&tournamentId=${t.efoot}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"/);
      expect(res.body).toBeInstanceOf(ReadableStream);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').trim().split('\r\n');
      expect(lines[0]).toBe('Data (UTC);Quem;Ação;Recurso;Tipo;ID do recurso;Campeonato;Motivo;Antes;Depois;IP');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain(`;${h.people.get('rafael')?.nickname};Responsável do campeonato trocado;Copa eFoot ${h.stamp};Campeonato;${t.efoot};${t.efoot};`);
      expect(lines[1]).toContain(`"'=CMD(""calc"") tentativa de fórmula"`);
      expect(lines[2]).toContain(`;${h.people.get('ana')?.nickname};Destaque na home alterado;`);
    });

    it('exportação grande sai em blocos (mais de 1.000 linhas) sem perder nem repetir registro', async () => {
      const entityId = `lote-${h.stamp}`;
      await db.auditLog.createMany({ data: Array.from({ length: 2345 }, (_, i) => ({ actorId: id('ana'), action: 'SETTINGS_CHANGED', entityType: 'SiteSettings', entityId, entityLabel: `linha ${i}`, createdAt: new Date(Date.now() - i * 1000) })) });
      const { res } = await h.call('ana', 'GET', `/admin/audit-logs.csv?entityId=${entityId}`);
      const lines = (await res.text()).trim().split('\r\n');
      expect(lines).toHaveLength(2346);
      expect(new Set(lines.slice(1).map((l) => l.split(';')[3])).size).toBe(2345);
    });

    it('é somente leitura: nenhuma rota altera ou apaga um registro, e o banco recusa', async () => {
      const log = await lastAudit(db, 'TOURNAMENT_FEATURED', { tournamentId: t.efoot });
      for (const [method, path] of [
        ['DELETE', `/admin/audit-logs/${log?.id}`],
        ['PATCH', `/admin/audit-logs/${log?.id}`],
        ['PUT', `/admin/audit-logs/${log?.id}`],
        ['DELETE', '/admin/audit-logs'],
        ['POST', '/admin/audit-logs'],
      ] as const) {
        expect((await h.call('rafael', method, path, method === 'DELETE' ? undefined : { reason: 'apagar rastro' })).status, `${method} ${path}`).toBe(404);
      }
      expect((await h.call('camila', 'DELETE', `/tournaments/${t.efoot}/audit-logs`)).status).toBe(404);
      await expect(db.auditLog.deleteMany({ where: { tournamentId: t.efoot } })).rejects.toThrow();
      expect(await auditCount(db, 'TOURNAMENT_FEATURED', { tournamentId: t.efoot })).toBe(1);
    });

    it('organizador consulta só os logs dos próprios campeonatos; o filtro não pode ser trocado; moderador não vê', async () => {
      const Page = numberedPage(AuditLog);
      expect((await h.call('camila', 'GET', '/admin/audit-logs')).status).toBe(403);
      const own = Page.parse((await h.call('camila', 'GET', `/tournaments/${t.liga}/audit-logs`)).data);
      expect(own.total).toBeGreaterThan(0);
      expect(own.items.every((l) => l.tournamentId === t.liga)).toBe(true);
      const forced = Page.parse((await h.call('camila', 'GET', `/tournaments/${t.liga}/audit-logs?tournamentId=${t.efoot}`)).data);
      expect(forced.items.every((l) => l.tournamentId === t.liga)).toBe(true);
      expect((await h.call('camila', 'GET', `/tournaments/${t.open8}/audit-logs`)).status).toBe(403);
      expect((await h.call('bianca', 'GET', `/tournaments/${t.liga}/audit-logs`)).status).toBe(403);
      expect((await h.call(null, 'GET', `/tournaments/${t.liga}/audit-logs`)).status).toBe(401);
      expect((await h.call('mod', 'GET', `/tournaments/${t.copa}/audit-logs`)).status).toBe(403);
      // Co-organizador vê (pelo endereço também).
      expect((await h.call('coorg', 'GET', `/tournaments/copa-${h.stamp}/audit-logs`)).status).toBe(200);
      expect(Page.parse((await h.call('ana', 'GET', `/tournaments/${t.efoot}/audit-logs`)).data).items.map((l) => l.action)).toEqual(['TOURNAMENT_OWNER_CHANGED', 'TOURNAMENT_FEATURED']);
    });
  });

  // ── Moderação ──────────────────────────────────────────────────────
  describe('moderação: denúncias e disputas escaladas', () => {
    let squadReport = '';

    it('denunciar usuário (pelo apelido), squad, partida e resultado; não vale denunciar a si mesmo; limite de 5 em aberto', async () => {
      const user = await h.call('bianca', 'POST', '/reports', { targetType: 'USER', targetId: h.people.get('p3')?.nickname, reason: 'HARASSMENT', description: 'Ficou me xingando no chat do jogo.' });
      expect(user.status).toBe(201);
      expect(Report.parse(user.data)).toMatchObject({ targetId: id('p3'), targetLabel: h.people.get('p3')?.nickname, status: 'OPEN', reporterNickname: h.people.get('bianca')?.nickname });
      const team = await db.team.create({ data: { name: 'Squad Delta', tag: `DT${h.stamp}`.slice(0, 10), captainId: id('p4'), members: { create: { userId: id('p4'), role: 'CAPTAIN' } } } });
      const upload = await db.upload.create({ data: { ownerId: id('lucas'), purpose: 'report', access: 'private', blobUrl: `https://blob.exemplo/${h.stamp}.png`, pathname: `report/${id('lucas')}/x.png`, contentType: 'image/png', size: 10 } });
      const squad = await h.call('lucas', 'POST', '/reports', { targetType: 'TEAM', targetId: team.id, reason: 'CHEATING', description: 'Suspeita de emulador nas quedas do treino.', evidenceUrls: [`/files/${upload.id}`] });
      expect(Report.parse(squad.data)).toMatchObject({ targetLabel: `Squad Delta [${team.tag}]`, targetLink: `/minha-conta/squads/${team.id}` });
      squadReport = Report.parse(squad.data).id;
      expect(await db.upload.findUniqueOrThrow({ where: { id: upload.id } })).toMatchObject({ attachedType: 'REPORT', attachedId: squadReport });

      const match = await db.match.findFirstOrThrow({ where: { stageId } });
      const onMatch = await h.call('lucas', 'POST', '/reports', { targetType: 'MATCH', targetId: match.id, reason: 'FAKE_RESULT', description: 'O placar lançado não bate com o print.' });
      expect(Report.parse(onMatch.data).targetLabel).toContain(`Liga Clash ${h.stamp}`);
      expect(Report.parse(onMatch.data).targetLink).toBe(`/c/liga-${h.stamp}?aba=partidas`);
      expect((await h.call('lucas', 'POST', '/reports', { targetType: 'RESULT', targetId: match.id, reason: 'FAKE_RESULT', description: 'Resultado lançado errado pela organização.' })).status).toBe(201);
      expect((await h.call('lucas', 'POST', '/reports', { targetType: 'MATCH', targetId: 'nao-existe', reason: 'OTHER', description: 'Partida que não existe.' })).status).toBe(404);

      expect((await h.call('bianca', 'POST', '/reports', { targetType: 'USER', targetId: id('bianca'), reason: 'OTHER', description: 'Testando denunciar a mim mesma.' })).code).toBe('REPORT_SELF');
      expect((await h.call('p4', 'POST', '/reports', { targetType: 'TEAM', targetId: team.id, reason: 'OTHER', description: 'Denunciando o meu próprio squad.' })).code).toBe('REPORT_SELF');
      expect((await h.call(null, 'POST', '/reports', { targetType: 'USER', targetId: id('p3'), reason: 'OTHER', description: 'Sem login não denuncia.' })).status).toBe(401);
      for (let i = 0; i < 4; i += 1) expect((await h.call('bianca', 'POST', '/reports', { targetType: 'USER', targetId: id('p3'), reason: 'HARASSMENT', description: `Mais uma ofensa no chat (${i}).` })).status).toBe(201);
      expect((await h.call('bianca', 'POST', '/reports', { targetType: 'USER', targetId: id('p3'), reason: 'HARASSMENT', description: 'Sexta denúncia em aberto.' })).code).toBe('REPORT_LIMIT');

      const mine = z.array(Report).parse((await h.call('bianca', 'GET', '/me/reports')).data);
      expect(mine).toHaveLength(5);
      expect(mine.every((r) => r.reporterNickname === h.people.get('bianca')?.nickname)).toBe(true);
    });

    it('fila do Admin: abertas primeiro e quem responde pelo alvo (no squad, o capitão)', async () => {
      const page = numberedPage(AdminReport).parse((await h.call('ana', 'GET', `/admin/reports?targetUserId=${id('p4')}`)).data);
      expect(page.items.map((r) => r.id)).toEqual([squadReport]);
      expect(page.items[0]).toMatchObject({ targetType: 'TEAM', targetUserId: id('p4'), targetUserStatus: 'ACTIVE', reporterId: id('lucas') });
      const open = numberedPage(AdminReport).parse((await h.call('ana', 'GET', '/admin/reports?status=OPEN')).data);
      expect(open.items.every((r) => r.status === 'OPEN')).toBe(true);
    });

    it('ação rápida: sancionar a partir da denúncia fecha a denúncia e audita as duas coisas', async () => {
      const res = await h.call('ana', 'POST', `/admin/users/${id('p4')}/sanctions`, { type: 'SUSPENSION', days: 7, reason: 'Uso de emulador confirmado', reportId: squadReport });
      expect(res.status).toBe(201);
      expect(SanctionResult.parse(res.data).sanction.reportId).toBe(squadReport);
      expect(await db.report.findUniqueOrThrow({ where: { id: squadReport } })).toMatchObject({ status: 'ACTIONED', handledById: id('ana'), resolution: 'Suspensão aplicada: Uso de emulador confirmado' });
      expect(await lastAudit(db, 'USER_SANCTIONED', { entityId: id('p4') })).toMatchObject({ after: { denuncia: squadReport } });
      expect(await lastAudit(db, 'REPORT_HANDLED', { entityId: squadReport })).toMatchObject({ before: { status: 'OPEN' }, after: { status: 'ACTIONED' } });
      expect((await h.call('ana', 'POST', `/admin/users/${id('p5')}/sanctions`, { type: 'WARNING', reason: 'Denúncia inexistente', reportId: 'rp_nao_existe' })).status).toBe(400);
      const view = z.array(Report).parse((await h.call('lucas', 'GET', '/me/reports')).data).find((r) => r.id === squadReport);
      expect(view).toMatchObject({ status: 'ACTIONED', handledByNickname: h.people.get('ana')?.nickname });
    });

    it('improcedente exige a explicação e avisa quem denunciou', async () => {
      const report = Report.parse((await h.call('lucas', 'POST', '/reports', { targetType: 'USER', targetId: id('p6'), reason: 'CHEATING', description: 'Abates impossíveis no celular.' })).data);
      expect((await h.call('ana', 'PATCH', `/admin/reports/${report.id}`, { status: 'DISMISSED' })).status).toBe(400);
      expect(AdminReport.parse((await h.call('ana', 'PATCH', `/admin/reports/${report.id}`, { status: 'IN_REVIEW' })).data).status).toBe('IN_REVIEW');
      const res = await h.call('ana', 'PATCH', `/admin/reports/${report.id}`, { status: 'DISMISSED', resolution: 'As gravações não mostram uso de emulador.' });
      expect(AdminReport.parse(res.data)).toMatchObject({ status: 'DISMISSED', handledByNickname: h.people.get('ana')?.nickname, resolution: 'As gravações não mostram uso de emulador.' });
      expect(await lastAudit(db, 'REPORT_HANDLED', { entityId: report.id })).toMatchObject({ actorId: id('ana'), before: { status: 'IN_REVIEW' }, after: { status: 'DISMISSED' }, reason: 'As gravações não mostram uso de emulador.' });
      expect(await db.notification.count({ where: { userId: id('lucas'), title: 'Sua denúncia foi considerada improcedente' } })).toBe(1);
      expect((await h.call('ana', 'PATCH', '/admin/reports/nao-existe', { status: 'IN_REVIEW' })).status).toBe(404);
    });

    it('lista as disputas escaladas (padrão) ou de outro estado', async () => {
      const match = await db.match.findFirstOrThrow({ where: { stageId } });
      const base = { matchId: match.id, openedById: id('p1'), reason: 'O placar enviado está invertido.' };
      const escalated = await db.dispute.create({ data: { ...base, status: 'ESCALATED', messages: { create: [{ authorId: id('p1'), body: 'Segue o print.' }, { authorId: id('camila'), body: 'Escalando para a administração.' }] } } });
      const open = await db.dispute.create({ data: { ...base, status: 'OPEN' } });
      await db.dispute.create({ data: { ...base, status: 'RESOLVED', resolution: 'Placar corrigido.' } });
      const list = z.array(Dispute).parse((await h.call('ana', 'GET', '/admin/disputes')).data);
      const mine = list.find((d) => d.id === escalated.id);
      expect(mine).toMatchObject({ tournamentId: t.liga, tournamentName: `Liga Clash ${h.stamp}`, openedByNickname: h.people.get('p1')?.nickname, status: 'ESCALATED' });
      expect(mine?.messages.map((m) => m.authorRole)).toEqual(['PARTICIPANT', 'STAFF']);
      expect(list.every((d) => d.status === 'ESCALATED')).toBe(true);
      expect(z.array(Dispute).parse((await h.call('ana', 'GET', '/admin/disputes?status=OPEN')).data).some((d) => d.id === open.id)).toBe(true);
      expect(AdminStats.parse((await h.call('rafael', 'GET', '/admin/stats?from=2026-01-01')).data).openDisputes).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Cancelar e arquivar (no fim: mudam o estado dos campeonatos) ──
  it('cancelar exige motivo; arquivar só finalizado ou cancelado; o público fica sabendo do cancelamento', async () => {
    expect((await h.call('ana', 'POST', `/admin/tournaments/${t.liga}/cancel`, {})).status).toBe(400);
    expect((await h.call('ana', 'POST', `/admin/tournaments/${t.liga}/archive`)).status).toBe(409);
    const cancelled = await h.call('ana', 'POST', `/admin/tournaments/${t.liga}/cancel`, { reason: 'Organização abandonou o evento' });
    expect(AdminTournament.parse(cancelled.data).status).toBe('CANCELLED');
    expect(await lastAudit(db, 'TOURNAMENT_STATUS_CHANGED', { tournamentId: t.liga })).toMatchObject({ before: { status: 'IN_PROGRESS' }, after: { status: 'CANCELLED' }, reason: 'Organização abandonou o evento' });
    expect((await h.call('ana', 'POST', `/admin/tournaments/${t.liga}/cancel`, { reason: 'De novo, sem efeito' })).status).toBe(409);
    expect((await h.call('ana', 'POST', `/admin/tournaments/${t.open8}/cancel`, { reason: 'Já terminou, não cancela' })).status).toBe(409);
    const archived = await h.call('ana', 'POST', `/admin/tournaments/${t.liga}/archive`);
    expect(AdminTournament.parse(archived.data).status).toBe('ARCHIVED');
    expect(await lastAudit(db, 'TOURNAMENT_STATUS_CHANGED', { tournamentId: t.liga })).toMatchObject({ before: { status: 'CANCELLED' }, after: { status: 'ARCHIVED' } });
    expect(await db.announcement.count({ where: { tournamentId: t.liga, title: 'Campeonato cancelado' } })).toBe(1);
    expect(await db.notification.count({ where: { userId: id('camila'), title: 'Campeonato cancelado pela administração' } })).toBe(1);
  });
});
