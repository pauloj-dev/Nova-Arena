/**
 * LGPD (issue #115, RNF-10): o que a pessoa pode levar e o que some quando ela exclui a conta.
 *
 * **Exportação** (`buildPersonalExport`): tudo o que é dela, tabela por tabela, sem segredo (hash de senha, segredo
 * do 2FA, tokens, chaves do push). Outras pessoas aparecem só pelo apelido.
 *
 * **Exclusão** (`anonymizeAccount`), conforme docs/modelo-de-dados.md, "Exclusão de conta (LGPD) × histórico imutável":
 * - `User`: `status = DELETED`, `deletedAt`; e-mail, apelido, avatar, bio, redes, país, fuso e nascimento trocados
 *   por valores anônimos (`removido-<hash>`).
 * - Sessões, OAuth, 2FA, tokens de e-mail, IDs de jogo, preferências, notificações, seguidos, push, pedidos de
 *   organizador, limites, equipe de campeonatos e exportações: apagados.
 * - Papéis de Admin/organizador revogados (o gatilho de `user_roles` audita); fica só PARTICIPANT.
 * - Squads de que era capitão: a capitania passa ao membro mais antigo; sem membros, o squad é arquivado.
 * - Arquivos no Blob: avatar, denúncias e provas apagados, **exceto** as provas de disputas resolvidas (retenção).
 *   Logos, banners e capas ficam: são do squad/campeonato/jogo, não da pessoa.
 * - Inscrições, partidas, resultados, tabelas, denúncias feitas e sanções: mantidos, apontando para a conta
 *   anonimizada. `AuditLog` e `ResultEvent` não mudam (só ganham o registro `ACCOUNT_DELETED`).
 */
import { audited, revokeRole, withAudit, type PrismaClient, type Tx } from '@nova/db';
import { ACTIVE_TOURNAMENT_STATUSES, DATA_EXPORT_FORMAT, DELETED_NICKNAME_PREFIX, type DeletionBlocker, type PersonalDataExport } from '@nova/schemas';
import { createHash, randomBytes } from 'node:crypto';
import type { AuditContext } from '@nova/db';

/** Campos que nunca saem no arquivo exportado. */
const SECRET_KEYS = new Set(['passwordHash', 'refreshTokenHash', 'secretEnc', 'recoveryCodesHash', 'tokenHash', 'p256dh', 'auth', 'familyId', 'replacedById', 'sessionVersion', 'nicknameKey']);

/** Linha do banco → JSON simples: datas em ISO, BigInt em texto e sem campos secretos. */
export function clean(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(clean);
  // `Decimal` do Prisma (pontos, placar): número.
  if (value && typeof value === 'object' && typeof (value as { toFixed?: unknown }).toFixed === 'function') return Number(String(value));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) if (!SECRET_KEYS.has(key)) out[key] = clean(v);
    return out;
  }
  return value;
}

const rows = (list: unknown[]) => list.map((r) => clean(r) as Record<string, unknown>);

/** Quantas linhas a exportação teria (decide entre responder na hora ou gerar num job). */
export async function exportSize(db: PrismaClient, userId: string): Promise<number> {
  const counts = await Promise.all([
    db.session.count({ where: { userId } }),
    db.notification.count({ where: { userId } }),
    db.productEvent.count({ where: { userId } }),
    db.registration.count({ where: { userId } }),
    db.registrationMember.count({ where: { userId } }),
    db.playerStat.count({ where: { userId } }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

export async function buildPersonalExport(db: PrismaClient, userId: string, now: Date): Promise<PersonalDataExport> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: { select: { role: true, grantedAt: true } }, twoFactor: { select: { enabledAt: true } } } });
  const [sessions, oauth, gameAccounts, registrations, rosters, teams, stats, submissions, disputes, disputeMessages, reports, sanctions, notifications, preferences, follows, achievements, uploads, organizerRequests, events, push, owned, staff] = await Promise.all([
    db.session.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true, ip: true, userAgent: true, twoFactorVerified: true } }),
    db.oAuthAccount.findMany({ where: { userId }, select: { provider: true, email: true, emailVerified: true, createdAt: true } }),
    db.gameAccount.findMany({ where: { userId }, select: { fields: true, createdAt: true, updatedAt: true, game: { select: { name: true, slug: true } } } }),
    db.registration.findMany({ where: { userId }, select: { id: true, status: true, seed: true, checkedInAt: true, rulesAcceptedAt: true, statusReason: true, createdAt: true, tournament: { select: { name: true, slug: true } } } }),
    db.registrationMember.findMany({ where: { userId }, select: { registrationId: true, isSub: true, isCaptain: true, confirmedAt: true, createdAt: true, registration: { select: { status: true, tournament: { select: { name: true, slug: true } }, team: { select: { name: true, tag: true } } } } } }),
    db.teamMember.findMany({ where: { userId }, select: { role: true, isSub: true, joinedAt: true, team: { select: { name: true, tag: true, archivedAt: true } } } }),
    db.playerStat.findMany({ where: { userId }, select: { stats: true, matchParticipant: { select: { matchId: true, points: true } } } }),
    db.resultSubmission.findMany({ where: { submittedById: userId }, select: { matchId: true, payload: true, evidenceUrls: true, status: true, rejectReason: true, createdAt: true } }),
    db.dispute.findMany({ where: { openedById: userId }, select: { matchId: true, reason: true, evidenceUrls: true, status: true, resolution: true, createdAt: true, resolvedAt: true } }),
    db.disputeMessage.findMany({ where: { authorId: userId }, select: { disputeId: true, body: true, evidenceUrls: true, createdAt: true } }),
    db.report.findMany({ where: { reporterId: userId }, select: { targetType: true, targetLabel: true, reason: true, description: true, evidenceUrls: true, status: true, resolution: true, createdAt: true } }),
    db.sanction.findMany({ where: { userId }, select: { type: true, reason: true, startsAt: true, endsAt: true, liftedAt: true } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { type: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    db.notificationPreference.findMany({ where: { userId } }),
    db.follow.findMany({ where: { userId }, select: { targetType: true, targetId: true, createdAt: true } }),
    db.achievement.findMany({ where: { userId }, select: { type: true, gameId: true, tournamentId: true, awardedAt: true } }),
    db.upload.findMany({ where: { ownerId: userId }, select: { purpose: true, access: true, contentType: true, size: true, attachedType: true, createdAt: true } }),
    db.organizerRequest.findMany({ where: { userId }, select: { justification: true, status: true, reviewReason: true, createdAt: true, reviewedAt: true } }),
    db.productEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { name: true, props: true, createdAt: true } }),
    db.pushSubscription.findMany({ where: { userId }, select: { userAgent: true, createdAt: true, lastUsedAt: true } }),
    db.tournament.findMany({ where: { ownerId: userId }, select: { name: true, slug: true, status: true, createdAt: true } }),
    db.tournamentStaff.findMany({ where: { userId }, select: { role: true, tournament: { select: { name: true, slug: true } } } }),
  ]);
  return {
    format: DATA_EXPORT_FORMAT,
    generatedAt: now.toISOString(),
    account: clean({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      nickname: user.nickname,
      birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
      guardianConsentAt: user.guardianConsentAt,
      avatarUrl: user.avatarUrl,
      country: user.country,
      state: user.state,
      bio: user.bio,
      socials: user.socials,
      timezone: user.timezone,
      status: user.status,
      roles: user.roles,
      twoFactorEnabled: Boolean(user.twoFactor?.enabledAt),
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    }) as Record<string, unknown>,
    sections: {
      sessoes: rows(sessions),
      loginSocial: rows(oauth),
      idsDeJogo: rows(gameAccounts),
      inscricoes: rows(registrations),
      elencos: rows(rosters),
      squads: rows(teams),
      estatisticas: rows(stats),
      resultadosEnviados: rows(submissions),
      disputasAbertas: rows(disputes),
      mensagensEmDisputas: rows(disputeMessages),
      denunciasFeitas: rows(reports),
      sancoesRecebidas: rows(sanctions),
      notificacoes: rows(notifications),
      preferenciasDeNotificacao: rows(preferences),
      seguindo: rows(follows),
      conquistas: rows(achievements),
      arquivosEnviados: rows(uploads),
      pedidosDeOrganizador: rows(organizerRequests),
      eventosDeUso: rows(events),
      avisosNoCelular: rows(push),
      campeonatosOrganizados: rows(owned),
      equipeDeCampeonatos: rows(staff),
    },
  };
}

// ── Exclusão ─────────────────────────────────────────────────────────

const OPEN_REGISTRATION: ('PENDING_MEMBERS' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'WAITLIST')[] = ['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST'];

/** O que impede excluir a conta agora. */
export async function deletionBlockers(db: PrismaClient, userId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];
  const owned = await db.tournament.findMany({ where: { ownerId: userId, status: { in: ACTIVE_TOURNAMENT_STATUSES } }, select: { id: true, name: true }, take: 20 });
  if (owned.length > 0) {
    blockers.push({
      code: 'OWNS_ACTIVE_TOURNAMENTS',
      message: 'Você organiza campeonatos em andamento. Encerre, cancele ou passe a organização para outra pessoa antes de excluir a conta.',
      items: owned.map((t) => ({ label: t.name, href: `/organizador/campeonatos/${t.id}` })),
    });
  }
  const regs = await db.registration.findMany({
    where: {
      status: { in: OPEN_REGISTRATION },
      tournament: { status: { in: ACTIVE_TOURNAMENT_STATUSES } },
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    select: { tournament: { select: { name: true, slug: true } } },
    take: 20,
  });
  if (regs.length > 0) {
    blockers.push({
      code: 'ACTIVE_REGISTRATIONS',
      message: 'Você está inscrito em campeonatos que ainda não terminaram. Cancele as inscrições (ou espere o fim) antes de excluir a conta.',
      items: regs.map((r) => ({ label: r.tournament.name, href: `/c/${r.tournament.slug}` })),
    });
  }
  const isSuper = await db.userRole.findUnique({ where: { userId_role: { userId, role: 'SUPER_ADMIN' } } });
  if (isSuper) {
    const supers = await db.userRole.count({ where: { role: 'SUPER_ADMIN', user: { status: 'ACTIVE' } } });
    if (supers <= 1) blockers.push({ code: 'LAST_SUPER_ADMIN', message: 'Você é o único Super Admin. Passe o papel para outra pessoa antes de excluir a conta.', items: [] });
  }
  return blockers;
}

/** Apelido anônimo estável para a conta (17 caracteres: cabe no limite do apelido). */
export const anonymousNickname = (userId: string) => `${DELETED_NICKNAME_PREFIX}${createHash('sha256').update(userId).digest('hex').slice(0, 8)}`;

/** Endereço da prova como ele aparece nos envios e disputas (privado: `/api/v1/files/:id`; público: o do Blob). */
const evidenceRef = (u: { id: string; access: string; blobUrl: string }) => (u.access === 'private' ? `/api/v1/files/${u.id}` : u.blobUrl);

/** Provas que ficam (disputa resolvida): o endereço aparece numa disputa resolvida, nas mensagens dela ou no envio. */
async function retainedEvidence(tx: Tx, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const resolved = await tx.dispute.findMany({
    where: {
      status: 'RESOLVED',
      OR: [{ evidenceUrls: { hasSome: refs } }, { messages: { some: { evidenceUrls: { hasSome: refs } } } }, { submission: { evidenceUrls: { hasSome: refs } } }],
    },
    select: { evidenceUrls: true, messages: { select: { evidenceUrls: true } }, submission: { select: { evidenceUrls: true } } },
  });
  const kept = new Set<string>();
  for (const d of resolved) for (const url of [...d.evidenceUrls, ...d.messages.flatMap((m) => m.evidenceUrls), ...(d.submission?.evidenceUrls ?? [])]) kept.add(url);
  return kept;
}

const KEEP_PURPOSES = new Set(['team-logo', 'banner', 'game-cover']);

export interface DeletionOutcome {
  nickname: string;
  /** Arquivos a apagar do Blob depois do commit. */
  blobs: { url: string; access: string }[];
}

export async function anonymizeAccount(db: PrismaClient, ctx: AuditContext, userId: string, now: Date): Promise<DeletionOutcome> {
  const nickname = anonymousNickname(userId);
  return withAudit(db, ctx, async (tx) => {
    // Squads de que era capitão.
    const captainOf = await tx.team.findMany({ where: { captainId: userId, archivedAt: null }, select: { id: true } });
    for (const team of captainOf) {
      const heir = await tx.teamMember.findFirst({ where: { teamId: team.id, userId: { not: userId } }, orderBy: { joinedAt: 'asc' } });
      if (heir) {
        await tx.team.update({ where: { id: team.id }, data: { captainId: heir.userId } });
        await tx.teamMember.update({ where: { teamId_userId: { teamId: team.id, userId: heir.userId } }, data: { role: 'CAPTAIN' } });
      } else {
        await tx.team.update({ where: { id: team.id }, data: { archivedAt: now } });
      }
    }
    await tx.teamMember.deleteMany({ where: { userId } });
    await tx.teamInvite.updateMany({ where: { invitedUserId: userId, status: 'PENDING' }, data: { status: 'REVOKED' } });

    // Papéis elevados (o gatilho de `user_roles` grava ROLE_REVOKED com o autor desta transação).
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'] as const) await revokeRole(tx, userId, role);

    // Arquivos: apaga os pessoais, guarda as provas de disputas resolvidas e o que é de squad/campeonato/jogo.
    const uploads = await tx.upload.findMany({ where: { ownerId: userId }, select: { id: true, purpose: true, access: true, blobUrl: true } });
    const evidence = uploads.filter((u) => u.purpose === 'evidence');
    const kept = await retainedEvidence(
      tx,
      evidence.flatMap((u) => [evidenceRef(u), u.blobUrl]),
    );
    const doomed = uploads.filter((u) => !KEEP_PURPOSES.has(u.purpose) && !(u.purpose === 'evidence' && (kept.has(evidenceRef(u)) || kept.has(u.blobUrl))));
    if (doomed.length > 0) await tx.upload.deleteMany({ where: { id: { in: doomed.map((u) => u.id) } } });
    const exports = await tx.dataExport.findMany({ where: { userId, blobUrl: { not: null } }, select: { blobUrl: true } });

    // Dados de acesso e preferências.
    await tx.session.deleteMany({ where: { userId } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.emailToken.deleteMany({ where: { userId } });
    await tx.gameAccount.deleteMany({ where: { userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.follow.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.organizerRequest.deleteMany({ where: { userId } });
    await tx.organizerLimits.deleteMany({ where: { userId } });
    await tx.tournamentStaff.deleteMany({ where: { userId } });
    await tx.dataExport.deleteMany({ where: { userId } });

    // A conta fica, anônima: inscrições, resultados e tabelas continuam íntegros.
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletedAt: now,
        email: `${nickname}.${randomBytes(4).toString('hex')}@conta-excluida.invalid`,
        nickname,
        nicknameKey: nickname,
        passwordHash: null,
        emailVerified: false,
        birthDate: null,
        guardianConsentAt: null,
        avatarUrl: null,
        country: null,
        state: null,
        bio: null,
        socials: {},
        timezone: null,
        lastSeenAt: null,
        sessionVersion: { increment: 1 },
      },
    });
    await audited(tx, { action: 'ACCOUNT_DELETED', entityType: 'User', entityId: userId, entityLabel: nickname, before: null, after: { status: 'DELETED' } });

    return {
      nickname,
      blobs: [...doomed.map((u) => ({ url: u.blobUrl, access: u.access })), ...exports.map((e) => ({ url: e.blobUrl as string, access: 'private' }))],
    };
  });
}
