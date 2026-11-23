/**
 * LGPD (issue #115) contra o Postgres: exportação dos dados pessoais e exclusão com anonimização
 * (docs/modelo-de-dados.md). Critério de aceite: a conta excluída some dos perfis e os campeonatos antigos
 * continuam íntegros (inscrição, partida, resultado e auditoria intocados).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { DATA_EXPORT_FORMAT, DeletionCheck, PersonalDataExport, isDeletedNickname } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/crypto';
import { createHarness, lastAudit, type Harness } from './fixtures/admin';

const url = process.env.TEST_DATABASE_URL;
const PHRASE = 'EXCLUIR MINHA CONTA';

describe.skipIf(!url)('LGPD: exportar e excluir a conta (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  const id = (key: string) => h.people.get(key)?.id ?? '';
  let gameId = '';
  let modeId = '';
  let modelId = '';

  async function tournament(owner: string, status: 'IN_PROGRESS' | 'FINISHED' | 'REGISTRATION_OPEN', name: string) {
    return db.tournament.create({ data: { slug: `lg-${name.toLowerCase().replace(/\W+/g, '-')}-${h.stamp}`, name, gameId, gameModeId: modeId, ownerId: id(owner), status, participantType: 'SOLO', maxParticipants: 8 } });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    h = createHarness(db, 'lg');
    for (const key of ['bia', 'caio', 'duda', 'org', 'only']) await h.makeUser(key, key === 'org' ? ['ORGANIZER'] : []);
    await db.user.update({ where: { id: id('bia') }, data: { passwordHash: await hashPassword('senhaForte#2026'), bio: 'Jogo de Free Fire desde 2019', birthDate: new Date('2000-05-10T00:00:00Z') } });
    const game = await db.game.create({
      data: { slug: `lg-${h.stamp}`, name: `Jogo LG ${h.stamp}`, requiredAccountFields: [{ key: 'playerId', label: 'ID' }], modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    gameId = game.id;
    modeId = game.modes[0]?.id ?? '';
    modelId = game.scoringModels[0]?.id ?? '';
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('exporta os dados pessoais num JSON para download, sem segredos', async () => {
    await db.gameAccount.create({ data: { userId: id('bia'), gameId, fields: { playerId: '998877' }, externalKey: '998877' } });
    await db.notification.create({ data: { userId: id('bia'), type: 'ANNOUNCEMENT', title: 'Bem-vinda', body: 'Olá!' } });
    const res = await h.call('bia', 'POST', '/me/export');
    expect(res.status).toBe(200);
    expect(res.res.headers.get('content-disposition')).toMatch(/^attachment; filename="nova-arena-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.res.headers.get('cache-control')).toContain('no-store');
    const data = PersonalDataExport.parse(res.data);
    expect(data.format).toBe(DATA_EXPORT_FORMAT);
    expect(data.account).toMatchObject({ id: id('bia'), email: h.people.get('bia')?.email, bio: 'Jogo de Free Fire desde 2019', birthDate: '2000-05-10' });
    expect(data.sections.idsDeJogo).toEqual([expect.objectContaining({ fields: { playerId: '998877' } })]);
    expect(data.sections.notificacoes).toEqual([expect.objectContaining({ title: 'Bem-vinda' })]);
    expect(data.sections.sessoes?.length).toBeGreaterThan(0);
    const text = JSON.stringify(data);
    for (const secret of ['passwordHash', 'refreshTokenHash', 'secretEnc', 'recoveryCodesHash', 'familyId', 'p256dh']) expect(text).not.toContain(secret);
    // Visitante: 401.
    expect((await h.call(null, 'POST', '/me/export')).status).toBe(401);
  });

  it('o download de uma exportação gerada em job é só do dono', async () => {
    const record = await db.dataExport.create({ data: { userId: id('bia'), status: 'READY', blobUrl: 'https://exemplo.private.blob.vercel-storage.com/x.json', size: 10, readyAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    expect((await h.call('caio', 'GET', `/me/exports/${record.id}/download`)).status).toBe(404);
    // A dona chega até a loja (aqui sem Blob configurado: 503, nunca o arquivo de outra pessoa).
    expect((await h.call('bia', 'GET', `/me/exports/${record.id}/download`)).code).toBe('UPLOADS_UNAVAILABLE');
    const list = (await h.call('bia', 'GET', '/me/exports')).data as { id: string; downloadUrl: string }[];
    expect(list.map((e) => e.id)).toContain(record.id);
    expect(((await h.call('caio', 'GET', '/me/exports')).data as unknown[]).length).toBe(0);
  });

  it('não deixa excluir quem organiza campeonato em andamento, está inscrito em um aberto ou é o único Super Admin', async () => {
    const t = await tournament('org', 'IN_PROGRESS', 'Liga Ativa');
    const check = DeletionCheck.parse((await h.call('org', 'GET', '/me/deletion')).data);
    expect(check).toMatchObject({ canDelete: false, hasPassword: false });
    expect(check.blockers[0]).toMatchObject({ code: 'OWNS_ACTIVE_TOURNAMENTS', items: [{ label: 'Liga Ativa', href: `/organizador/campeonatos/${t.id}` }] });
    expect((await h.call('org', 'DELETE', '/me', { confirmation: PHRASE })).code).toBe('OWNS_ACTIVE_TOURNAMENTS');

    const open = await tournament('org', 'REGISTRATION_OPEN', 'Copa Aberta');
    await db.registration.create({ data: { tournamentId: open.id, userId: id('duda'), status: 'CONFIRMED' } });
    expect(DeletionCheck.parse((await h.call('duda', 'GET', '/me/deletion')).data).blockers.map((b) => b.code)).toEqual(['ACTIVE_REGISTRATIONS']);

    const supers = await db.userRole.count({ where: { role: 'SUPER_ADMIN', user: { status: 'ACTIVE' } } });
    if (supers === 0) {
      await db.userRole.create({ data: { userId: id('only'), role: 'SUPER_ADMIN' } });
      expect(DeletionCheck.parse((await h.call('only', 'GET', '/me/deletion')).data).blockers.map((b) => b.code)).toEqual(['LAST_SUPER_ADMIN']);
      await db.userRole.delete({ where: { userId_role: { userId: id('only'), role: 'SUPER_ADMIN' } } });
    }
  });

  it('pede a senha (quem tem) e a frase de confirmação', async () => {
    expect((await h.call('bia', 'DELETE', '/me', { confirmation: 'sim' })).code).toBe('VALIDATION');
    expect((await h.call('bia', 'DELETE', '/me', { confirmation: PHRASE })).code).toBe('VALIDATION');
    expect((await h.call('bia', 'DELETE', '/me', { password: 'errada123', confirmation: PHRASE })).code).toBe('INVALID_PASSWORD');
    expect((await db.user.findUniqueOrThrow({ where: { id: id('bia') } })).status).toBe('ACTIVE');
  });

  it('excluir anonimiza a conta, apaga o pessoal e mantém campeonatos, resultados e auditoria íntegros', async () => {
    const bia = h.people.get('bia');
    // Histórico: campeonato encerrado com inscrição, partida, resultado e uma prova de disputa resolvida.
    const t = await tournament('org', 'FINISHED', 'Copa Antiga');
    const reg = await db.registration.create({ data: { tournamentId: t.id, userId: id('bia'), status: 'CONFIRMED' } });
    const other = await db.registration.create({ data: { tournamentId: t.id, userId: id('caio'), status: 'CONFIRMED' } });
    const stage = await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Final', format: 'SINGLE_ELIM', scoringModelId: modelId, tiebreakers: ['points'] } });
    const match = await db.match.create({ data: { stageId: stage.id, nodeId: 'r1m1', round: 1, position: 1, status: 'VALIDATED', participants: { create: [{ registrationId: reg.id, slot: 1, score: 2, isWinner: true, points: 3 }, { registrationId: other.id, slot: 2, score: 1, isWinner: false, points: 0 }] } } });
    const kept = await db.upload.create({ data: { ownerId: id('bia'), purpose: 'evidence', access: 'private', blobUrl: `https://lg.private.blob/${h.stamp}-prova.png`, pathname: 'p', contentType: 'image/png', size: 10, attachedType: 'MATCH', attachedId: match.id, attachedAt: new Date() } });
    const submission = await db.resultSubmission.create({ data: { matchId: match.id, submittedById: id('bia'), payload: {}, evidenceUrls: [`/api/v1/files/${kept.id}`], status: 'APPROVED' } });
    await db.dispute.create({ data: { matchId: match.id, submissionId: submission.id, openedById: id('caio'), reason: 'Placar errado', status: 'RESOLVED', resolution: 'Mantido' } });
    const avatar = await db.upload.create({ data: { ownerId: id('bia'), purpose: 'avatar', blobUrl: `https://lg.public.blob/${h.stamp}-avatar.png`, pathname: 'a', contentType: 'image/png', size: 10, attachedType: 'USER', attachedId: id('bia'), attachedAt: new Date() } });
    await db.user.update({ where: { id: id('bia') }, data: { avatarUrl: avatar.blobUrl } });
    // Squads: capitania passa ao membro mais antigo; sem membros, arquivado.
    const shared = await db.team.create({ data: { name: 'Squad LG', tag: `L${h.stamp}`.slice(0, 8), captainId: id('bia'), members: { create: [{ userId: id('bia'), role: 'CAPTAIN', joinedAt: new Date(Date.now() - 3000) }, { userId: id('duda'), joinedAt: new Date(Date.now() - 2000) }, { userId: id('caio'), joinedAt: new Date(Date.now() - 1000) }] } } });
    const solo = await db.team.create({ data: { name: 'Solo LG', tag: `S${h.stamp}`.slice(0, 8), captainId: id('bia'), members: { create: [{ userId: id('bia'), role: 'CAPTAIN' }] } } });
    await db.follow.create({ data: { userId: id('bia'), targetType: 'TOURNAMENT', targetId: t.id } });
    const auditsBefore = await db.auditLog.count({ where: { actorId: id('bia') } });

    const res = await h.call('bia', 'DELETE', '/me', { password: 'senhaForte#2026', confirmation: 'excluir minha conta' });
    expect(res.status).toBe(204);
    expect(res.res.headers.getSetCookie().some((c) => c.startsWith('na_at=;'))).toBe(true);

    const after = await db.user.findUniqueOrThrow({ where: { id: id('bia') } });
    expect(isDeletedNickname(after.nickname)).toBe(true);
    expect(after).toMatchObject({ status: 'DELETED', passwordHash: null, bio: null, avatarUrl: null, birthDate: null, emailVerified: false, socials: {} });
    expect(after.email).not.toBe(bia?.email);
    expect(after.deletedAt).not.toBeNull();
    // Apagados.
    expect(await db.session.count({ where: { userId: id('bia') } })).toBe(0);
    expect(await db.gameAccount.count({ where: { userId: id('bia') } })).toBe(0);
    expect(await db.notification.count({ where: { userId: id('bia') } })).toBe(0);
    expect(await db.follow.count({ where: { userId: id('bia') } })).toBe(0);
    expect(await db.upload.findUnique({ where: { id: avatar.id } })).toBeNull();
    // Mantidos: prova de disputa resolvida, inscrição, partida e resultado.
    expect(await db.upload.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(await db.registration.findUniqueOrThrow({ where: { id: reg.id } })).toMatchObject({ userId: id('bia'), status: 'CONFIRMED' });
    expect((await db.matchParticipant.findFirstOrThrow({ where: { matchId: match.id, registrationId: reg.id } })).isWinner).toBe(true);
    expect(await db.resultSubmission.count({ where: { id: submission.id } })).toBe(1);
    // Squads.
    expect(await db.team.findUniqueOrThrow({ where: { id: shared.id } })).toMatchObject({ captainId: id('duda'), archivedAt: null });
    expect((await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: shared.id, userId: id('duda') } } })).role).toBe('CAPTAIN');
    expect((await db.team.findUniqueOrThrow({ where: { id: solo.id } })).archivedAt).not.toBeNull();
    // Auditoria: nada mudou, só ganhou o registro da exclusão (sem dado pessoal).
    expect(await db.auditLog.count({ where: { actorId: id('bia'), action: { not: 'ACCOUNT_DELETED' } } })).toBe(auditsBefore);
    const audit = await lastAudit(db, 'ACCOUNT_DELETED', { entityId: id('bia') });
    expect(audit).toMatchObject({ actorId: id('bia'), entityLabel: after.nickname, before: null, after: { status: 'DELETED' }, reason: 'Pedido do titular (LGPD)' });

    // Some do site: perfil 404, a sessão antiga não vale e o login é recusado.
    expect((await h.call(null, 'GET', `/users/${bia?.nickname}`)).status).toBe(404);
    expect((await h.call('bia', 'GET', '/me')).data).toBeNull();
    expect((await h.call(null, 'POST', '/auth/login', { email: bia?.email, password: 'senhaForte#2026' })).status).toBe(401);
  });
});
