/**
 * Convite por link para a equipe de um campeonato (ORG-10): o responsável gera um link de co-organizador ou de
 * moderador e manda para quem vai ajudar. Mesma segurança do convite de papel (`admin/roles.ts`):
 *
 * - O token **só existe na resposta da criação**; o banco guarda o hash. A auditoria nunca leva o token.
 * - Expirado, revogado ou esgotado responde 410 e não muda nada. O limite de usos vale sob concorrência: o uso é
 *   contado num `UPDATE` condicional dentro da mesma transação que põe a pessoa na equipe.
 * - Aceitar segue as mesmas regras de adicionar pelo apelido (`staffCandidateBlock`).
 */
import { audited, withAudit } from '@nova/db';
import { AcceptStaffInviteResponse, CreateStaffInviteInput, MyStaffTournament, StaffInvitePreview, TournamentStaffInvite, type StaffInviteState } from '@nova/schemas';
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '../../auth/crypto';
import { siteUrl } from '../../auth/email-tokens';
import { requireSession } from '../../auth/session';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { conflict, HttpProblem, notFound } from '../../errors';
import { messages } from '../../messages/pt-BR';
import { notify } from '../../notify';
import { nicknames } from '../admin/shared';
import { auditCtx, CLOSED_FOR_STAFF, loadTournament, ownerAccess, ROLE_LABEL, staffCandidateBlock, type StaffCandidateBlock } from './index';

const HOUR_MS = 3600_000;
const VALIDITY_MS: Record<CreateStaffInviteInput['validity'], number> = { '1h': HOUR_MS, '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS };
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

type InviteRow = { id: string; tournamentId: string; role: 'CO_ORGANIZER' | 'MODERATOR'; maxUses: number; uses: number; expiresAt: Date; revokedAt: Date | null; createdById: string; createdAt: Date };

function inviteState(invite: InviteRow, now: Date): StaffInviteState {
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (invite.uses >= invite.maxUses) return 'EXHAUSTED';
  return 'VALID';
}

function toInvite(invite: InviteRow, names: Map<string, string>, now: Date, link: string | null = null): TournamentStaffInvite {
  return {
    id: invite.id,
    tournamentId: invite.tournamentId,
    role: invite.role,
    link,
    maxUses: invite.maxUses,
    uses: invite.uses,
    state: inviteState(invite, now),
    createdByNickname: names.get(invite.createdById) ?? 'Nova Arena',
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

const INVALID_INVITE: Record<Exclude<StaffInviteState, 'VALID'>, { title: string; code: string }> = {
  EXPIRED: { title: 'Este convite expirou. Peça um novo link a quem convidou você.', code: 'INVITE_EXPIRED' },
  REVOKED: { title: 'Este convite foi cancelado por quem o criou.', code: 'INVITE_REVOKED' },
  EXHAUSTED: { title: 'Este convite já foi usado o número máximo de vezes.', code: 'INVITE_EXHAUSTED' },
};

/** Mensagens do aceite, falando com quem abriu o link. */
const ACCEPT_BLOCK: Record<StaffCandidateBlock, string> = {
  USER_NOT_ACTIVE: 'Sua conta está suspensa ou banida e não pode entrar na equipe.',
  ALREADY_OWNER: 'Você já é responsável por este campeonato.',
  ALREADY_STAFF: 'Você já faz parte da equipe deste campeonato.',
  STAFF_IS_REGISTERED: 'Você está inscrito neste campeonato. Quem joga não pode fazer parte da equipe do evento.',
};

async function findByToken(c: AppContext, token: string) {
  const invite = token.length >= 8 && token.length <= 200 ? await c.get('deps').db().tournamentStaffInvite.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!invite) throw notFound('Convite');
  return invite;
}

export const staffInvites = new Hono<AppEnv>();

/** Links ativos e antigos do campeonato (sem o token). Só o responsável (ou o Admin), como a equipe. */
staffInvites.get('/tournaments/:id/staff-invites', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'ver os convites da equipe');
  const rows = await db.tournamentStaffInvite.findMany({ where: { tournamentId: t.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  const names = await nicknames(db, rows.map((r) => r.createdById));
  const now = c.get('deps').now();
  return respond(c, z.array(TournamentStaffInvite), rows.map((r) => toInvite(r, names, now)));
});

staffInvites.post('/tournaments/:id/staff-invites', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'mudar a equipe do evento');
  const input = await body(c, CreateStaffInviteInput);
  if (CLOSED_FOR_STAFF.includes(t.status)) throw conflict('Este campeonato já foi encerrado: a equipe do evento não muda mais.', 'TOURNAMENT_READ_ONLY');
  const now = c.get('deps').now();
  // 48 caracteres hexadecimais; só o hash vai para o banco.
  const token = randomBytes(24).toString('hex');
  const ctx = await auditCtx(c);
  const invite = await withAudit(db, ctx, async (tx) => {
    const created = await tx.tournamentStaffInvite.create({
      data: { tournamentId: t.id, role: input.role, tokenHash: sha256(token), maxUses: input.maxUses, expiresAt: new Date(now.getTime() + VALIDITY_MS[input.validity]), createdById: ctx.actorId },
    });
    // O token nunca entra na auditoria.
    await audited(tx, {
      action: 'INVITE_CREATED',
      entityType: 'TournamentStaffInvite',
      entityId: created.id,
      entityLabel: `${t.name} · convite de ${ROLE_LABEL[input.role]}`,
      tournamentId: t.id,
      after: { papel: ROLE_LABEL[input.role], validade: input.validity, usos: created.maxUses },
    });
    return created;
  });
  const names = await nicknames(db, [invite.createdById]);
  return respond(c, TournamentStaffInvite, toInvite(invite, names, now, siteUrl(c, `/equipe/convite/${token}`)), 201);
});

staffInvites.delete('/tournaments/:id/staff-invites/:inviteId', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'mudar a equipe do evento');
  const id = c.req.param('inviteId');
  const invite = isUuid(id) ? await db.tournamentStaffInvite.findFirst({ where: { id, tournamentId: t.id } }) : null;
  if (!invite) throw notFound('Convite');
  const now = c.get('deps').now();
  const state = inviteState(invite, now);
  if (state === 'REVOKED') throw conflict('Este convite já foi revogado.', 'INVITE_REVOKED');
  const saved = await withAudit(db, await auditCtx(c), async (tx) => {
    const { count } = await tx.tournamentStaffInvite.updateMany({ where: { id: invite.id, revokedAt: null }, data: { revokedAt: now } });
    if (count === 0) throw conflict('Este convite já foi revogado.', 'INVITE_REVOKED');
    await audited(tx, {
      action: 'INVITE_REVOKED',
      entityType: 'TournamentStaffInvite',
      entityId: invite.id,
      entityLabel: `${t.name} · convite de ${ROLE_LABEL[invite.role]}`,
      tournamentId: t.id,
      before: { estado: state, usos: `${invite.uses}/${invite.maxUses}` },
      after: { estado: 'REVOKED' },
    });
    return tx.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } });
  });
  return respond(c, TournamentStaffInvite, toInvite(saved, await nicknames(db, [saved.createdById]), now));
});

/** Público: qual campeonato, qual papel, quem convidou e se ainda vale (a tela mostra antes do login). */
staffInvites.get('/staff-invites/:token', async (c) => {
  const invite = await findByToken(c, c.req.param('token'));
  const db = c.get('deps').db();
  const t = await db.tournament.findUniqueOrThrow({ where: { id: invite.tournamentId }, select: { id: true, slug: true, name: true, game: { select: { name: true } } } });
  const names = await nicknames(db, [invite.createdById]);
  return respond(c, StaffInvitePreview, {
    tournament: { id: t.id, slug: t.slug, name: t.name, gameName: t.game.name },
    role: invite.role,
    state: inviteState(invite, c.get('deps').now()),
    invitedBy: names.get(invite.createdById) ?? 'Nova Arena',
    expiresAt: invite.expiresAt.toISOString(),
  });
});

staffInvites.post('/staff-invites/:token/accept', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const invite = await findByToken(c, c.req.param('token'));
  // Convite inválido: 410 e nada muda (ninguém entra na equipe, `uses` intacto).
  const state = inviteState(invite, now);
  if (state !== 'VALID') throw new HttpProblem(410, INVALID_INVITE[state].title, INVALID_INVITE[state].code);
  const t = await loadTournament(db, invite.tournamentId);
  if (CLOSED_FOR_STAFF.includes(t.status)) throw conflict('Este campeonato já foi encerrado: a equipe do evento não muda mais.', 'TOURNAMENT_READ_ONLY');
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { id: true, nickname: true, status: true, emailVerified: true } });
  if (!user.emailVerified) throw new HttpProblem(403, 'Confirme seu e-mail antes de aceitar o convite.', 'EMAIL_NOT_VERIFIED');
  const block = await staffCandidateBlock(db, t, user);
  if (block) throw conflict(ACCEPT_BLOCK[block], block);

  try {
    await withAudit(db, { ...(await auditCtx(c)), reason: 'Convite da equipe aceito' }, async (tx) => {
      // Conta o uso só se o convite ainda vale **agora** (limite de usos sob concorrência: um UPDATE condicional por vez).
      const { count } = await tx.tournamentStaffInvite.updateMany({
        where: { id: invite.id, revokedAt: null, expiresAt: { gt: now }, uses: { lt: tx.tournamentStaffInvite.fields.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (count === 0) {
        const current = await tx.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } });
        const later = inviteState(current, now);
        const which = later === 'VALID' ? 'EXHAUSTED' : later;
        throw new HttpProblem(410, INVALID_INVITE[which].title, INVALID_INVITE[which].code);
      }
      await tx.tournamentStaff.create({ data: { tournamentId: t.id, userId: user.id, role: invite.role, addedById: invite.createdById } });
      await audited(tx, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, after: { adicionou: user.nickname, papel: ROLE_LABEL[invite.role], convite: invite.id } });
    });
  } catch (error) {
    // Dois aceites da mesma pessoa ao mesmo tempo: a chave da equipe decide (e o uso não é contado).
    if (isUniqueViolation(error)) throw conflict(ACCEPT_BLOCK.ALREADY_STAFF, 'ALREADY_STAFF');
    throw error;
  }
  // Quem criou o link fica sabendo que alguém entrou por ele.
  await notify(c, [invite.createdById], { type: 'ANNOUNCEMENT', title: messages.tournaments.staff.joinedByLink.title(user.nickname), body: messages.tournaments.staff.joinedByLink.body(t.name, ROLE_LABEL[invite.role]), link: `/organizador/campeonatos/${t.id}?aba=equipe` });
  return respond(c, AcceptStaffInviteResponse, { tournamentId: t.id, slug: t.slug, role: invite.role });
});

/** Campeonatos em que faço parte da equipe (inclusive quem não tem o papel de organizador). */
staffInvites.get('/me/staff-tournaments', async (c) => {
  const session = await requireSession(c);
  const rows = await c
    .get('deps')
    .db()
    .tournamentStaff.findMany({
      where: { userId: session.userId },
      include: { tournament: { select: { id: true, slug: true, name: true, status: true, startsAt: true, updatedAt: true, game: { select: { name: true } } } } },
    });
  rows.sort((a, b) => b.tournament.updatedAt.getTime() - a.tournament.updatedAt.getTime());
  return respond(
    c,
    z.array(MyStaffTournament),
    rows.map((r) => ({ id: r.tournament.id, slug: r.tournament.slug, name: r.tournament.name, status: r.tournament.status, gameName: r.tournament.game.name, startsAt: r.tournament.startsAt?.toISOString() ?? null, role: r.role })),
  );
});

