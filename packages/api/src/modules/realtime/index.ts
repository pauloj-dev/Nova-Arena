/**
 * Módulo `realtime` (issue #97, ADR-005, plano §2.3): `POST /realtime/token` emite o "token request" assinado do
 * Ably com **só os canais permitidos** para quem pede. A API só publica (REST, `src/realtime.ts`); o navegador
 * assina com este token e busca os dados na API quando um evento chega.
 *
 * Canais e quem assina (só `subscribe`, nunca publicar):
 * - `tournament:*` — qualquer pessoa, inclusive visitante (eventos públicos, sem dado sensível);
 * - `user:{id}` — só o dono (notificações e sessão derrubada);
 * - `match:{id}` — só quem joga a partida (solo ou no elenco do squad) e a organização do campeonato (dono,
 *   co-organizador, moderador) e Admin. A tela pede os canais de partida que quer em `channels`; os que a pessoa
 *   não pode ver são descartados.
 *
 * Sem `ABLY_API_KEY`: 503 `REALTIME_UNAVAILABLE` — a tela fica em "Reconectando…" e atualiza a cada 10 s (CT-10).
 */
import { ACTIVE_REGISTRATION_STATUSES, RealtimeTokenInput, RealtimeTokenRequest } from '@nova/schemas';
import type { PrismaClient, Role } from '@nova/db';
import { Rest } from 'ably';
import { Hono } from 'hono';
import { body, respond, type AppEnv } from '../../context';
import { HttpProblem } from '../../errors';
import { currentRoles, isAdmin } from '../../auth/rbac';
import { currentSession } from '../../auth/session';
import { findMatch } from '../../competition/bracket';

/** Validade do token: o SDK pede outro sozinho antes de vencer (chamando esta rota de novo). */
export const TOKEN_TTL_MS = 60 * 60_000;
const MATCH_CHANNEL = /^match:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type Capability = Record<string, ['subscribe']>;

/** Mapa de permissões do Ably para quem pede (pura: testada sem banco nem Ably). */
export function buildCapability(userId: string | null, matchIds: readonly string[]): Capability {
  const capability: Capability = { 'tournament:*': ['subscribe'] };
  if (userId) capability[`user:${userId}`] = ['subscribe'];
  for (const id of matchIds) capability[`match:${id}`] = ['subscribe'];
  return capability;
}

/** Das partidas pedidas, as que a pessoa pode assinar: joga nela ou é da organização (ou Admin). */
export async function allowedMatches(db: PrismaClient, viewer: { userId: string; roles: readonly Role[] }, requested: readonly string[]): Promise<string[]> {
  const ids = [...new Set(requested.map((ch) => MATCH_CHANNEL.exec(ch)?.[1]?.toLowerCase()).filter((id): id is string => Boolean(id)))];
  const allowed: string[] = [];
  for (const id of ids) {
    const found = await findMatch(db, id);
    if (!found) continue;
    const tournament = found.stage.tournament;
    if (isAdmin(viewer.roles) || tournament.ownerId === viewer.userId) {
      allowed.push(id);
      continue;
    }
    const staff = await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: viewer.userId } }, select: { role: true } });
    if (staff) {
      allowed.push(id);
      continue;
    }
    const reg = await db.registration.findFirst({
      where: { tournamentId: tournament.id, status: { in: [...ACTIVE_REGISTRATION_STATUSES] }, OR: [{ userId: viewer.userId }, { members: { some: { userId: viewer.userId } } }] },
      select: { id: true },
    });
    if (reg && found.node.slots.some((s) => s.entrantId === reg.id)) allowed.push(id);
  }
  return allowed;
}

export const realtime = new Hono<AppEnv>();

realtime.post('/realtime/token', async (c) => {
  const key = c.get('env').ABLY_API_KEY;
  if (!key) throw new HttpProblem(503, 'O tempo real está indisponível. A página continua atualizando sozinha.', 'REALTIME_UNAVAILABLE');
  // Corpo opcional: sem ele, só os canais padrão.
  const input = c.req.header('content-type')?.includes('application/json') ? await body(c, RealtimeTokenInput) : {};
  const session = await currentSession(c);
  const matches = session && input.channels?.length ? await allowedMatches(c.get('deps').db(), { userId: session.userId, roles: await currentRoles(c) }, input.channels) : [];
  const capability = buildCapability(session?.userId ?? null, matches);
  // Sem `clientId`: o navegador só assina (não publica nem usa presença), e a mesma conexão continua valendo
  // quando a pessoa entra ou sai — o Ably não deixa trocar o `clientId` de uma conexão aberta.
  const tokenRequest = await new Rest({ key }).auth.createTokenRequest({
    capability: JSON.stringify(capability),
    ttl: TOKEN_TTL_MS,
    timestamp: c.get('deps').now().getTime(),
  });
  c.header('Cache-Control', 'private, no-store');
  return respond(c, RealtimeTokenRequest, tokenRequest as RealtimeTokenRequest);
});
