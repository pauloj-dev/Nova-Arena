/**
 * Módulo `privacy` da API simulada (issue #115, LGPD): exportar e excluir os dados pessoais. Mesmas rotas, mensagens
 * e códigos da API real (`packages/api/src/modules/privacy`). No protótipo a exportação sai sempre na hora.
 */
import {
  ACTIVE_TOURNAMENT_STATUSES,
  DATA_EXPORT_FORMAT,
  DELETED_NICKNAME_PREFIX,
  DeleteAccountInput,
  type DeletionBlocker,
  type DeletionCheck,
  type PersonalDataExport,
} from '@nova/schemas';
import { http, type HttpHandler } from 'msw';
import { audit } from '../audit';
import { db, nowIso, save, setSessionUserId } from '../db';
import { badRequest, conflict, handle, HttpProblem, json, noContent, requireUser, url, body } from '../http';
import { notifications } from '../notify';

export const moduleName = 'privacy';

const OPEN_REGISTRATION = ['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST'];

function blockersOf(userId: string): DeletionBlocker[] {
  const d = db();
  const blockers: DeletionBlocker[] = [];
  const owned = d.tournaments.filter((t) => t.ownerId === userId && ACTIVE_TOURNAMENT_STATUSES.includes(t.status));
  if (owned.length > 0) {
    blockers.push({
      code: 'OWNS_ACTIVE_TOURNAMENTS',
      message: 'Você organiza campeonatos em andamento. Encerre, cancele ou passe a organização para outra pessoa antes de excluir a conta.',
      items: owned.map((t) => ({ label: t.name, href: `/organizador/campeonatos/${t.id}` })),
    });
  }
  const active = new Set(d.tournaments.filter((t) => ACTIVE_TOURNAMENT_STATUSES.includes(t.status)).map((t) => t.id));
  const regs = d.registrations.filter((r) => OPEN_REGISTRATION.includes(r.status) && active.has(r.tournamentId) && (r.userId === userId || r.members.some((m) => m.userId === userId)));
  if (regs.length > 0) {
    blockers.push({
      code: 'ACTIVE_REGISTRATIONS',
      message: 'Você está inscrito em campeonatos que ainda não terminaram. Cancele as inscrições (ou espere o fim) antes de excluir a conta.',
      items: regs.map((r) => {
        const t = d.tournaments.find((x) => x.id === r.tournamentId);
        return { label: t?.name ?? 'Campeonato', href: t ? `/c/${t.slug}` : null };
      }),
    });
  }
  const me = d.users.find((u) => u.id === userId);
  if (me?.roles.includes('SUPER_ADMIN') && d.users.filter((u) => u.status === 'ACTIVE' && u.roles.includes('SUPER_ADMIN')).length <= 1) {
    blockers.push({ code: 'LAST_SUPER_ADMIN', message: 'Você é o único Super Admin. Passe o papel para outra pessoa antes de excluir a conta.', items: [] });
  }
  return blockers;
}

/** Hash curto e estável do id (o mesmo formato da API real: `removido-<8 hex>`). */
function anonymousNickname(userId: string): string {
  let h = 2166136261;
  for (const ch of userId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${DELETED_NICKNAME_PREFIX}${h.toString(16).padStart(8, '0').slice(0, 8)}`;
}

export const handlers: HttpHandler[] = [
  http.post(
    url('/me/export'),
    handle(() => {
      const user = requireUser();
      const d = db();
      const { password: _password, ...account } = user;
      void _password;
      const data: PersonalDataExport = {
        format: DATA_EXPORT_FORMAT,
        generatedAt: nowIso(),
        account: account as unknown as Record<string, unknown>,
        sections: {
          idsDeJogo: user.gameAccounts.map((g) => ({ ...g })),
          inscricoes: d.registrations.filter((r) => r.userId === user.id || r.members.some((m) => m.userId === user.id)).map((r) => ({ id: r.id, tournament: d.tournaments.find((t) => t.id === r.tournamentId)?.name ?? null, status: r.status, createdAt: r.createdAt })),
          squads: d.teams.filter((t) => t.members.some((m) => m.userId === user.id)).map((t) => ({ name: t.name, tag: t.tag, isCaptain: t.captainId === user.id })),
          seguindo: d.follows.filter((f) => f.userId === user.id).map((f) => ({ ...f })),
          notificacoes: notifications()
            .filter((n) => n.userId === user.id)
            .map((n) => ({ type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })),
        },
      };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="nova-arena-meus-dados-${data.generatedAt.slice(0, 10)}.json"` } });
    }),
  ),

  http.get(
    url('/me/exports'),
    handle(() => {
      requireUser();
      return json([]);
    }),
  ),

  http.get(
    url('/me/deletion'),
    handle(() => {
      const user = requireUser();
      const blockers = blockersOf(user.id);
      const check: DeletionCheck = { canDelete: blockers.length === 0, blockers, hasPassword: Boolean(user.password) };
      return json(check);
    }),
  ),

  http.delete(
    url('/me'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, DeleteAccountInput);
      if (user.password) {
        if (!input.password) throw badRequest('Confira os campos destacados.', 'VALIDATION', { password: 'Informe a sua senha' });
        if (input.password !== user.password) throw new HttpProblem(400, 'Senha incorreta.', 'INVALID_PASSWORD', { password: 'Senha incorreta.' });
      }
      const blockers = blockersOf(user.id);
      if (blockers[0]) throw conflict(blockers[0].message, blockers[0].code);

      const d = db();
      const nickname = anonymousNickname(user.id);
      // Squads: capitania ao membro mais antigo; sem membros, o squad sai da lista dele.
      for (const team of d.teams.filter((t) => t.captainId === user.id)) {
        const heir = [...team.members].filter((m) => m.userId !== user.id).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
        if (heir) {
          team.captainId = heir.userId;
          heir.role = 'CAPTAIN';
        }
      }
      for (const team of d.teams) team.members = team.members.filter((m) => m.userId !== user.id || team.captainId === user.id);
      d.follows = d.follows.filter((f) => f.userId !== user.id);
      const list = notifications();
      list.splice(0, list.length, ...list.filter((n) => n.userId !== user.id));
      Object.assign(user, {
        status: 'DELETED',
        nickname,
        email: `${nickname}@conta-excluida.invalid`,
        password: '',
        emailVerified: false,
        birthDate: '',
        avatarUrl: null,
        country: null,
        state: null,
        bio: null,
        socials: {},
        timezone: null,
        gameAccounts: [],
        oauthLinks: [],
        otherDevices: [],
        twoFactorEnabled: false,
        roles: ['PARTICIPANT'],
        organizerLimits: null,
      });
      audit(user, { action: 'ACCOUNT_DELETED', entityType: 'User', entityId: user.id, entityLabel: nickname, before: null, after: { status: 'DELETED' }, reason: 'Pedido do titular (LGPD)' });
      save();
      setSessionUserId(null);
      return noContent();
    }),
  ),
];
