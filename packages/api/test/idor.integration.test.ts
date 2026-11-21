/**
 * IDOR (issue #113, OWASP A01): uma pessoa logada tenta ler ou mudar os recursos de outra pelo id. Percorre todos os
 * recursos com dono — inscrição, squad, convite, notificações, envios de resultado, disputas, sala da partida,
 * arquivos privados, denúncias, aparelhos (sessões), 2FA, IDs de jogo (perfil privado), exportação LGPD e a área do
 * organizador — e confere que a resposta nunca é 2xx **e** que nada mudou no banco.
 *
 * Personagens: `dona` (participante dona dos recursos), `rival` (adversária na partida, para os recursos que ela
 * pode ver de direito), `intrusa` (sem relação nenhuma), `org` (organiza o campeonato) e `org2` (outro organizador).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './fixtures/admin';

const url = process.env.TEST_DATABASE_URL;

interface Attempt {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: () => string;
  body?: unknown;
  /** Quem tenta (padrão: a intrusa). */
  as?: string;
}

describe.skipIf(!url)('IDOR: ninguém lê nem muda o que é de outra pessoa (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  const id = (key: string) => h.people.get(key)?.id ?? '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    h = createHarness(db, 'id');
    for (const key of ['dona', 'rival', 'intrusa', 'amiga']) await h.makeUser(key, []);
    for (const key of ['org', 'org2']) await h.makeUser(key, ['ORGANIZER']);

    const game = await db.game.create({
      data: { slug: `id-${h.stamp}`, name: `Jogo ID ${h.stamp}`, requiredAccountFields: [{ key: 'playerId', label: 'ID' }], modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    ids.game = game.id;
    await db.gameAccount.create({ data: { userId: id('dona'), gameId: game.id, fields: { playerId: '445566' }, externalKey: '445566' } });

    // Campeonato em andamento do `org`, com a partida dona × rival.
    const t = await db.tournament.create({ data: { slug: `id-copa-${h.stamp}`, name: 'Copa IDOR', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: id('org'), status: 'IN_PROGRESS', participantType: 'SOLO', maxParticipants: 8 } });
    ids.tournament = t.id;
    const open = await db.tournament.create({ data: { slug: `id-aberta-${h.stamp}`, name: 'Copa Aberta IDOR', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: id('org'), status: 'REGISTRATION_OPEN', participantType: 'SOLO', maxParticipants: 8 } });
    ids.openRegistration = (await db.registration.create({ data: { tournamentId: open.id, userId: id('dona'), status: 'CONFIRMED' } })).id;
    const reg = await db.registration.create({ data: { tournamentId: t.id, userId: id('dona'), status: 'CONFIRMED' } });
    const rival = await db.registration.create({ data: { tournamentId: t.id, userId: id('rival'), status: 'CONFIRMED' } });
    ids.registration = reg.id;
    const stage = await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } });
    const match = await db.match.create({ data: { stageId: stage.id, nodeId: 'r1m1', round: 1, position: 1, status: 'AWAITING_VALIDATION', lobbyCodeEnc: null, participants: { create: [{ registrationId: reg.id, slot: 1 }, { registrationId: rival.id, slot: 2 }] } } });
    ids.match = match.id;
    const evidence = await db.upload.create({ data: { ownerId: id('dona'), purpose: 'evidence', access: 'private', blobUrl: `https://id.private.blob/${h.stamp}-prova.png`, pathname: 'p', contentType: 'image/png', size: 10, attachedType: 'MATCH', attachedId: match.id, attachedAt: new Date() } });
    ids.evidence = evidence.id;
    const submission = await db.resultSubmission.create({ data: { matchId: match.id, submittedById: id('dona'), payload: { entries: [{ registrationId: reg.id, score: 2 }, { registrationId: rival.id, score: 1 }], winnerRegistrationId: reg.id, submittedByRegistrationId: reg.id, opponentRegistrationId: rival.id, tournamentId: t.id, tournamentName: t.name, stageId: stage.id, matchLabel: 'Final' }, evidenceUrls: [`/api/v1/files/${evidence.id}`], status: 'PENDING' } });
    ids.submission = submission.id;
    ids.dispute = (await db.dispute.create({ data: { matchId: match.id, submissionId: submission.id, openedById: id('rival'), reason: 'O placar enviado está errado', status: 'OPEN' } })).id;

    // Squad da dona, com convite pendente para a amiga.
    const team = await db.team.create({ data: { name: 'Squad da Dona', tag: `D${h.stamp}`.slice(0, 8), captainId: id('dona'), members: { create: [{ userId: id('dona'), role: 'CAPTAIN' }, { userId: id('rival') }] } } });
    ids.team = team.id;
    ids.inviteCode = `I${h.stamp}`.slice(0, 6);
    ids.teamInvite = (await db.teamInvite.create({ data: { teamId: team.id, invitedUserId: id('amiga'), code: ids.inviteCode, expiresAt: new Date(Date.now() + 3600_000), createdById: id('dona') } })).id;

    ids.notification = (await db.notification.create({ data: { userId: id('dona'), type: 'ANNOUNCEMENT', title: 'Só para a dona', body: 'Particular' } })).id;
    const reportFile = await db.upload.create({ data: { ownerId: id('dona'), purpose: 'report', access: 'private', blobUrl: `https://id.private.blob/${h.stamp}-denuncia.png`, pathname: 'r', contentType: 'image/png', size: 10 } });
    const report = await db.report.create({ data: { reporterId: id('dona'), targetType: 'USER', targetId: id('rival'), targetLabel: 'rival', reason: 'HARASSMENT', description: 'Ofensas no chat da partida.', evidenceUrls: [`/api/v1/files/${reportFile.id}`], targetOwnerUserId: id('rival') } });
    await db.upload.update({ where: { id: reportFile.id }, data: { attachedType: 'REPORT', attachedId: report.id, attachedAt: new Date() } });
    ids.reportFile = reportFile.id;
    ids.sessionFamily = (await db.session.findFirstOrThrow({ where: { userId: id('dona') } })).familyId;
    ids.export = (await db.dataExport.create({ data: { userId: id('dona'), status: 'READY', blobUrl: `https://id.private.blob/${h.stamp}-export.json`, size: 10, expiresAt: new Date(Date.now() + 3600_000) } })).id;
    await db.twoFactor.create({ data: { userId: id('dona'), secretEnc: 'cifrado', enabledAt: new Date(), recoveryCodesHash: [] } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const ATTEMPTS: Attempt[] = [
    // Inscrição
    { label: 'cancelar a inscrição de outra pessoa', method: 'DELETE', path: () => `/registrations/${ids.openRegistration}` },
    { label: 'confirmar presença no elenco de outra pessoa', method: 'POST', path: () => `/registrations/${ids.openRegistration}/confirm` },
    { label: 'recusar o elenco de outra pessoa', method: 'POST', path: () => `/registrations/${ids.openRegistration}/decline` },
    { label: 'desistir pela inscrição de outra pessoa (rota da organização)', method: 'POST', path: () => `/registrations/${ids.registration}/withdraw`, body: { kind: 'WITHDRAWN', reason: 'Desisto por ela' } },
    { label: 'analisar inscrição de campeonato alheio (outro organizador)', method: 'PATCH', path: () => `/registrations/${ids.openRegistration}`, body: { action: 'reject', reason: 'Recusada à toa' }, as: 'org2' },
    // Squad e convite
    { label: 'renomear o squad de outra pessoa', method: 'PATCH', path: () => `/teams/${ids.team}`, body: { name: 'Squad Roubado' } },
    { label: 'apagar o squad de outra pessoa', method: 'DELETE', path: () => `/teams/${ids.team}` },
    { label: 'convidar para o squad de outra pessoa', method: 'POST', path: () => `/teams/${ids.team}/invites`, body: { kind: 'link' } },
    { label: 'tomar a capitania', method: 'POST', path: () => `/teams/${ids.team}/transfer-captain`, body: () => ({ userId: id('intrusa') }) },
    { label: 'remover membro do squad alheio', method: 'DELETE', path: () => `/teams/${ids.team}/members/${id('rival')}` },
    { label: 'mudar membro do squad alheio para reserva', method: 'PATCH', path: () => `/teams/${ids.team}/members/${id('rival')}`, body: { isSub: true } },
    { label: 'revogar convite do squad alheio', method: 'DELETE', path: () => `/team-invites/${ids.teamInvite}` },
    { label: 'aceitar convite feito para outra pessoa', method: 'POST', path: () => `/team-invites/${ids.inviteCode}/accept` },
    // Notificações
    { label: 'marcar como lida a notificação de outra pessoa', method: 'POST', path: () => `/notifications/${ids.notification}/read` },
    // Envio de resultado e disputa
    { label: 'ver o envio de resultado de uma partida alheia', method: 'GET', path: () => `/submissions/${ids.submission}` },
    { label: 'confirmar o envio de uma partida alheia', method: 'POST', path: () => `/submissions/${ids.submission}/confirm` },
    { label: 'contestar o envio de uma partida alheia', method: 'POST', path: () => `/submissions/${ids.submission}/dispute`, body: { reason: 'Contestação de quem não jogou', evidenceUrls: ['https://exemplo.com/x.png'] } },
    { label: 'revisar o envio sem ser da organização', method: 'PATCH', path: () => `/submissions/${ids.submission}`, body: { action: 'approve' } },
    { label: 'ver o envio pela partida', method: 'GET', path: () => `/matches/${ids.match}/submission` },
    { label: 'ver a sala (código) de uma partida alheia', method: 'GET', path: () => `/matches/${ids.match}/lobby` },
    { label: 'ver a disputa de outras pessoas', method: 'GET', path: () => `/disputes/${ids.dispute}` },
    { label: 'escrever na disputa de outras pessoas', method: 'POST', path: () => `/disputes/${ids.dispute}/messages`, body: { body: 'Me meto na conversa' } },
    { label: 'resolver a disputa sem ser da organização', method: 'POST', path: () => `/disputes/${ids.dispute}/resolve`, body: { resolution: 'Resolvido pela intrusa' } },
    { label: 'escalar a disputa sem ser da organização', method: 'POST', path: () => `/disputes/${ids.dispute}/escalate`, body: { reason: 'Escalando à toa' } },
    { label: 'lançar o resultado sem ser da organização', method: 'PUT', path: () => `/matches/${ids.match}/result`, body: { entries: [] } },
    // Arquivos privados (prova e denúncia)
    { label: 'abrir a prova de uma partida alheia', method: 'GET', path: () => `/files/${ids.evidence}` },
    { label: 'abrir o anexo da denúncia de outra pessoa', method: 'GET', path: () => `/files/${ids.reportFile}` },
    { label: 'a pessoa denunciada abre o anexo da denúncia', method: 'GET', path: () => `/files/${ids.reportFile}`, as: 'rival' },
    // Conta: aparelhos, 2FA (só do próprio), IDs de jogo, exportação LGPD
    { label: 'encerrar um aparelho de outra pessoa', method: 'DELETE', path: () => `/me/sessions/${ids.sessionFamily}` },
    { label: 'zerar o 2FA de outra pessoa pela rota do Admin', method: 'POST', path: () => `/admin/users/${id('dona')}/2fa/reset`, body: { reason: 'Tentativa' } },
    { label: 'ver os IDs de jogo (perfil privado) sem relação', method: 'GET', path: () => `/users/${h.people.get('dona')?.nickname}/game-accounts` },
    { label: 'baixar a exportação LGPD de outra pessoa', method: 'GET', path: () => `/me/exports/${ids.export}/download` },
    // Organizador
    { label: 'abrir o painel de um campeonato alheio', method: 'GET', path: () => `/organizer/tournaments/${ids.tournament}`, as: 'org2' },
    { label: 'editar um campeonato alheio', method: 'PATCH', path: () => `/tournaments/${ids.tournament}`, body: { name: 'Copa Tomada' }, as: 'org2' },
    { label: 'baixar a lista de inscritos (com contatos) de um campeonato alheio', method: 'GET', path: () => `/tournaments/${ids.tournament}/registrations.csv`, as: 'org2' },
    { label: 'ver a auditoria de um campeonato alheio', method: 'GET', path: () => `/tournaments/${ids.tournament}/audit-logs`, as: 'org2' },
    { label: 'cancelar um campeonato alheio', method: 'POST', path: () => `/tournaments/${ids.tournament}/cancel`, body: { reason: 'Cancelando o dos outros' }, as: 'org2' },
  ];

  it.each(ATTEMPTS.map((a) => [a.label, a] as const))('%s → recusado', async (_label, attempt) => {
    const payload = typeof attempt.body === 'function' ? (attempt.body as () => unknown)() : attempt.body;
    const res = await h.call(attempt.as ?? 'intrusa', attempt.method, attempt.path(), payload);
    expect(res.status, `${attempt.method} ${attempt.path()} respondeu ${res.status} ${res.code ?? ''}`).toBeGreaterThanOrEqual(400);
    // Recusa por permissão ou por "não existe para você": nunca 2xx, nunca erro do servidor.
    expect([401, 403, 404, 409]).toContain(res.status);
  });

  it('nada mudou no banco depois das tentativas', async () => {
    expect(await db.registration.findUniqueOrThrow({ where: { id: ids.openRegistration } })).toMatchObject({ status: 'CONFIRMED' });
    expect(await db.registration.findUniqueOrThrow({ where: { id: ids.registration } })).toMatchObject({ status: 'CONFIRMED' });
    expect(await db.team.findUniqueOrThrow({ where: { id: ids.team } })).toMatchObject({ name: 'Squad da Dona', captainId: id('dona'), archivedAt: null });
    expect(await db.teamMember.count({ where: { teamId: ids.team } })).toBe(2);
    expect((await db.teamInvite.findUniqueOrThrow({ where: { id: ids.teamInvite } })).status).toBe('PENDING');
    expect((await db.notification.findUniqueOrThrow({ where: { id: ids.notification } })).readAt).toBeNull();
    expect((await db.resultSubmission.findUniqueOrThrow({ where: { id: ids.submission } })).status).toBe('PENDING');
    expect(await db.dispute.findUniqueOrThrow({ where: { id: ids.dispute } })).toMatchObject({ status: 'OPEN', escalatedAt: null });
    expect(await db.disputeMessage.count({ where: { disputeId: ids.dispute } })).toBe(0);
    expect(await db.session.count({ where: { familyId: ids.sessionFamily, revokedAt: null } })).toBe(1);
    expect((await db.twoFactor.findUniqueOrThrow({ where: { userId: id('dona') } })).enabledAt).not.toBeNull();
    expect(await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).toMatchObject({ name: 'Copa IDOR', status: 'IN_PROGRESS' });
  });

  it('listas pessoais só trazem o que é da própria pessoa', async () => {
    const notifications = (await h.call('intrusa', 'GET', '/notifications')).data as { items?: { id: string }[] } | { id: string }[];
    const list = Array.isArray(notifications) ? notifications : (notifications.items ?? []);
    expect(list.map((n) => n.id)).not.toContain(ids.notification);
    const regs = (await h.call('intrusa', 'GET', '/me/registrations')).data as { id: string }[] | { items: { id: string }[] };
    expect(JSON.stringify(regs)).not.toContain(ids.registration);
    expect(JSON.stringify((await h.call('intrusa', 'GET', '/me/reports')).data)).not.toContain('Ofensas no chat');
    expect(JSON.stringify((await h.call('intrusa', 'GET', '/me/disputes')).data)).not.toContain(ids.dispute);
    expect(JSON.stringify((await h.call('intrusa', 'GET', '/me/exports')).data)).not.toContain(ids.export);
    expect(JSON.stringify((await h.call('intrusa', 'GET', '/me/sessions')).data)).not.toContain(ids.sessionFamily);
    // O perfil público nunca traz e-mail, nascimento nem IDs de jogo.
    const profile = JSON.stringify((await h.call('intrusa', 'GET', `/users/${h.people.get('dona')?.nickname}`)).data);
    for (const leak of [h.people.get('dona')?.email ?? '@', '445566', 'birthDate']) expect(profile).not.toContain(leak);
  });

  it('quem tem direito continua vendo (controle positivo)', async () => {
    expect((await h.call('dona', 'GET', `/submissions/${ids.submission}`)).status).toBe(200);
    expect((await h.call('rival', 'GET', `/disputes/${ids.dispute}`)).status).toBe(200);
    expect((await h.call('org', 'GET', `/organizer/tournaments/${ids.tournament}`)).status).toBe(200);
    expect((await h.call('org', 'GET', `/users/${h.people.get('dona')?.nickname}/game-accounts`)).status).toBe(200);
  });
});
