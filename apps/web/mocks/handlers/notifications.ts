/**
 * Módulo `notifications` da API simulada: lista, contador, leitura e preferências (PAR-10, F2.10).
 * As notificações são gravadas por `notify()` (`mocks/notify.ts`), chamado pelos outros módulos.
 */
import { http, type HttpHandler } from 'msw';
import { NotificationPreferencesInput, NotificationType, type Notification, type NotificationPreference } from '@nova/schemas';
import { collection, db, nowIso, save, type DbFollow } from '../db';
import { badRequest, body, handle, json, notFound, paginate, param, query, requireUser, url } from '../http';
import { notificationPreferences, notifications, type DbNotification } from '../notify';

export const moduleName = 'notifications';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/**
 * Quem segue um campeonato ou um jogo (RN-15). Os módulos que publicam algo público
 * (comunicado, início, avanço de fase, campeão, inscrições abertas) somam estes usuários
 * aos destinatários de `notify()`.
 */
export function followersOf(targetType: DbFollow['targetType'], targetId: string): string[] {
  return [...new Set(db().follows.filter((f) => f.targetType === targetType && f.targetId === targetId).map((f) => f.userId))];
}

// ── Dados de demonstração ────────────────────────────────────────────
/** Marcas do que já foi semeado de forma preguiçosa (a coleção `notifications` nasce vazia em `notify.ts`). */
const seedMarks = () => collection<{ key: string; at: string }>('notificationSeedMarks');
const DEMO_MARK = 'demo-notifications-v1';

interface DemoNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  /** Há quanto tempo foi criada. */
  ago: number;
  read: boolean;
}

const DEMO: DemoNotification[] = [
  { userId: 'u_bianca', type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Sua partida das quartas da Liga Semanal Clash Royale 1v1 começa em breve. Faça o check-in para não levar W.O.', link: '/c/liga-semanal-clash-royale?aba=partidas', ago: 10 * MIN, read: false },
  { userId: 'u_bianca', type: 'ANNOUNCEMENT', title: 'Quartas de final hoje', body: 'Liga Semanal Clash Royale 1v1: as quartas começam às 20h. Façam check-in a partir das 19h30.', link: '/c/liga-semanal-clash-royale', ago: 3 * HOUR, read: false },
  { userId: 'u_bianca', type: 'TEAM_INVITE', title: 'Convite para o Squad Bravo', body: 'Você foi convidada para entrar no squad. O convite vale por 2 dias.', link: '/minha-conta/squads', ago: DAY, read: false },
  { userId: 'u_bianca', type: 'QUALIFIED', title: 'Você avançou para as quartas', body: 'Vitória nas oitavas da Liga Semanal Clash Royale 1v1. Confira o próximo confronto na chave.', link: '/c/liga-semanal-clash-royale?aba=chave', ago: 25 * HOUR, read: true },
  { userId: 'u_bianca', type: 'REGISTRATION_CONFIRMED', title: 'Inscrição confirmada', body: 'Sua vaga na Liga Semanal Clash Royale 1v1 está garantida.', link: '/c/liga-semanal-clash-royale', ago: 2 * DAY, read: true },
  { userId: 'u_bianca', type: 'ELIMINATED', title: 'Open 8 Ball Pool terminou', body: 'O campeonato foi encerrado. Veja a classificação final e o pódio.', link: '/c/open-8-ball-pool?aba=classificacao', ago: 20 * DAY, read: true },
  { userId: 'u_lucas', type: 'REGISTRATION_CONFIRMED', title: 'Inscrição confirmada', body: 'O Squad Alfa está inscrito no Arena Contra Squad 4v4.', link: '/c/arena-contra-squad-4v4', ago: 2 * HOUR, read: false },
  { userId: 'u_lucas', type: 'ANNOUNCEMENT', title: 'Inscrições abertas!', body: 'Copa Nova FF — Squad: confirme todos os membros do squad para garantir a vaga.', link: '/c/copa-nova-ff-squad', ago: 2 * DAY, read: false },
  { userId: 'u_lucas', type: 'TEAM_INVITE', title: 'Convite aceito', body: 'Um jogador entrou no Squad Alfa pelo seu link de convite.', link: '/minha-conta/squads/t_alfa', ago: 5 * DAY, read: true },
];

/** Semeia as notificações de demonstração uma única vez por banco (idempotente). */
function ensureDemoSeed(): void {
  const marks = seedMarks();
  if (marks.some((m) => m.key === DEMO_MARK)) return;
  const now = Date.now();
  const list = notifications();
  const known = new Set(db().users.map((u) => u.id));
  DEMO.forEach((n, i) => {
    if (!known.has(n.userId)) return;
    const createdAt = new Date(now - n.ago).toISOString();
    list.push({ id: `n_demo_${i + 1}`, userId: n.userId, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read ? new Date(now - n.ago + 5 * MIN).toISOString() : null, inApp: true, emailQueued: false, createdAt });
  });
  marks.push({ key: DEMO_MARK, at: nowIso() });
  save();
}

// ── Conversões ───────────────────────────────────────────────────────
function toNotification(n: DbNotification): Notification {
  return { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt };
}

/**
 * Registro que só existe por causa do e-mail: o tipo estava desligado "no site" quando a notificação
 * foi criada. `notify()` grava esses registros já lidos (com `readAt` anterior ou igual a `createdAt`),
 * e é por isso que dá para reconhecê-los aqui — uma leitura de verdade sempre acontece depois da criação.
 */
function isEmailOnly(n: DbNotification): boolean {
  // Registros novos trazem `inApp`; os antigos (sem o campo) são reconhecidos por terem nascido lidos.
  if (typeof n.inApp === 'boolean') return !n.inApp;
  return n.readAt !== null && n.readAt <= n.createdAt;
}

/** As notificações do usuário que aparecem no site, mais recentes primeiro. */
function mine(userId: string): DbNotification[] {
  return notifications()
    .filter((n) => n.userId === userId && !isEmailOnly(n))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Uma linha por tipo, na ordem do contrato. Sem registro = ligado nos dois canais. */
function preferencesOf(userId: string): NotificationPreference[] {
  const saved = notificationPreferences().filter((p) => p.userId === userId);
  return NotificationType.options.map((type) => {
    // Avisos da moderação ficam sempre ligados.
    if (type === 'SANCTION') return { type, inApp: true, email: true };
    const pref = saved.find((p) => p.type === type);
    return { type, inApp: pref?.inApp ?? true, email: pref?.email ?? true };
  });
}

export const handlers: HttpHandler[] = [
  http.get(
    url('/notifications/unread-count'),
    handle(() => {
      const user = requireUser();
      ensureDemoSeed();
      return json({ count: mine(user.id).filter((n) => n.readAt === null).length });
    }),
  ),

  http.post(
    url('/notifications/read-all'),
    handle(() => {
      const user = requireUser();
      const at = nowIso();
      for (const n of notifications()) if (n.userId === user.id && n.readAt === null) n.readAt = at;
      save();
      return json({ count: 0 });
    }),
  ),

  http.get(
    url('/notifications'),
    handle(({ request }) => {
      const user = requireUser();
      ensureDemoSeed();
      const q = query(request);
      const onlyUnread = q.get('unread') === '1' || q.get('unread') === 'true';
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(q.get('limit') ?? '', 10) || PAGE_SIZE));
      const list = mine(user.id).filter((n) => !onlyUnread || n.readAt === null);
      const page = paginate(list, q.get('cursor'), limit);
      return json({ items: page.items.map(toNotification), nextCursor: page.nextCursor, total: page.total });
    }),
  ),

  http.post(
    url('/notifications/:id/read'),
    handle(({ params }) => {
      const user = requireUser();
      // Só o dono enxerga a notificação: a de outra pessoa "não existe".
      const n = notifications().find((x) => x.id === param(params, 'id') && x.userId === user.id);
      if (!n) throw notFound('Notificação');
      if (n.readAt === null) {
        n.readAt = nowIso();
        save();
      }
      return json(toNotification(n));
    }),
  ),

  // ── Preferências ───────────────────────────────────────────────────
  http.get(
    url('/me/notification-preferences'),
    handle(() => json(preferencesOf(requireUser().id))),
  ),

  http.put(
    url('/me/notification-preferences'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, NotificationPreferencesInput);
      if (input.preferences.some((p) => p.type === 'SANCTION' && (!p.inApp || !p.email))) {
        throw badRequest('Os avisos da moderação não podem ser desligados.', 'SANCTION_ALWAYS_ON');
      }
      const all = notificationPreferences();
      for (const p of input.preferences) {
        if (p.type === 'SANCTION') continue;
        const existing = all.find((x) => x.userId === user.id && x.type === p.type);
        if (existing) Object.assign(existing, { inApp: p.inApp, email: p.email });
        else all.push({ userId: user.id, type: p.type, inApp: p.inApp, email: p.email });
      }
      save();
      return json(preferencesOf(user.id));
    }),
  ),
];
