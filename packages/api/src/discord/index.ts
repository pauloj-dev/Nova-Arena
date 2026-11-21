/**
 * Bot do Discord (issue 121): peças sem rota — configuração, assinatura Ed25519 das interações, chamada à API do
 * Discord, os comandos (usados também pelo script de registro) e o agendamento dos avisos.
 *
 * Sem processo contínuo: o Discord chama `POST /discord/interactions` (webhook HTTP numa Vercel Function) e os avisos
 * saem por job do QStash (`/jobs/discord/*`), que tenta de novo sozinho. Sem `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` e
 * `DISCORD_BOT_TOKEN`, tudo aqui fica desligado sem quebrar nada.
 */
import { createHash, createPublicKey, randomInt, verify } from 'node:crypto';
import type { DiscordAnnouncementKind } from '@nova/schemas';
import type { AppContext } from '../context';
import type { Env } from '../env';

export const DISCORD_API = 'https://discord.com/api/v10';
export const DISCORD_ANNOUNCE_JOB_PATH = '/jobs/discord/announce';
export const DISCORD_REMINDER_JOB_PATH = '/jobs/discord/reminder';
/** Lembrete no canal: 15 minutos antes do horário da partida. */
export const REMINDER_MINUTES = 15;

/** Permissões que o bot pede ao entrar no servidor: ver canal (1024), enviar mensagem (2048) e incorporar link (16384). */
export const BOT_PERMISSIONS = String(1024 + 2048 + 16384);
/** "Gerenciar servidor" no Discord: só quem tem pode vincular o servidor a um campeonato. */
const MANAGE_GUILD = 0x20n;

type DiscordEnv = Pick<Env, 'DISCORD_APP_ID' | 'DISCORD_PUBLIC_KEY' | 'DISCORD_BOT_TOKEN'>;

export function discordConfigured(env: DiscordEnv): boolean {
  return Boolean(env.DISCORD_APP_ID && env.DISCORD_PUBLIC_KEY && env.DISCORD_BOT_TOKEN);
}

export function discordInstallUrl(env: DiscordEnv): string | null {
  if (!discordConfigured(env)) return null;
  const params = new URLSearchParams({ client_id: env.DISCORD_APP_ID as string, scope: 'bot applications.commands', permissions: BOT_PERMISSIONS });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// ── Assinatura das interações (Ed25519) ──────────────────────────────
/** Prefixo DER (SPKI) de uma chave pública Ed25519 crua de 32 bytes. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Confere `X-Signature-Ed25519` sobre `X-Signature-Timestamp` + corpo cru, com a chave pública da aplicação. Qualquer
 * coisa fora do formato vale como assinatura inválida (o Discord exige 401 nesses casos).
 */
export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string | undefined, timestamp: string | undefined, rawBody: string): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + rawBody, 'utf8'), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export function hasManageGuild(permissions: string | undefined): boolean {
  if (!permissions || !/^\d+$/.test(permissions)) return false;
  return (BigInt(permissions) & MANAGE_GUILD) === MANAGE_GUILD;
}

// ── Código de vínculo ────────────────────────────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código curto, sem letras que confundem (0/O, 1/I): `NA-XXXX-XXXX`. */
export function newLinkCode(): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `NA-${part()}-${part()}`;
}

export function normalizeLinkCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(normalizeLinkCode(code)).digest('hex');
}

// ── Comandos (fonte única: rota e script de registro) ────────────────
/** Tipos de opção do Discord: 1 = subcomando, 3 = texto. */
export const DISCORD_COMMANDS = [
  {
    name: 'nova-arena',
    description: 'Campeonatos da Nova Arena',
    description_localizations: { 'pt-BR': 'Campeonatos da Nova Arena' },
    dm_permission: true,
    options: [
      {
        type: 1,
        name: 'vincular',
        description: 'Liga este canal a um campeonato (organização). Os avisos passam a sair aqui.',
        options: [{ type: 3, name: 'codigo', description: 'Código gerado na operação do campeonato, na Nova Arena', required: true, min_length: 6, max_length: 20 }],
      },
      { type: 1, name: 'checkin', description: 'Faz o check-in da sua próxima partida (conta do Discord vinculada à Nova Arena).' },
      { type: 1, name: 'proxima', description: 'Mostra a sua próxima partida.' },
    ],
  },
] as const;

// ── Mensagens no canal ───────────────────────────────────────────────
/** Escapa a formatação do Discord em nomes digitados por pessoas (squad, campeonato). */
export function discordEscape(text: string): string {
  return text.replace(/([\\*_~`|])/g, '\\$1').replace(/@/g, '@\u200b');
}

/** `<t:1700000000:F>`: o Discord mostra no fuso de quem lê. */
export function discordTime(date: Date, style: 'F' | 'f' | 't' | 'R' = 'f'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export interface DiscordPostResult {
  ok: boolean;
  status: number;
}

/** Envia uma mensagem num canal (sem menções: nem `@everyone` nem pessoas são avisados). */
export async function postChannelMessage(env: DiscordEnv, channelId: string, content: string, fetcher: typeof fetch = fetch): Promise<DiscordPostResult> {
  const res = await fetcher(`${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN as string}`, 'Content-Type': 'application/json', 'User-Agent': 'NovaArenaBot (https://novaarena.gg, 1.0)' },
    body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
  });
  return { ok: res.ok, status: res.status };
}

/** Corpo do job `/jobs/discord/announce`. */
export interface DiscordAnnounceJob {
  tournamentId: string;
  kind: DiscordAnnouncementKind;
  content: string;
}

/** Corpo do job `/jobs/discord/reminder` (mesmo formato do job de check-in: reagendar invalida o antigo). */
export interface DiscordReminderJob {
  matchId: string;
  scheduledAt: string;
}

/** O campeonato tem canal do Discord ativo? (Sem bot configurado, nem consulta o banco.) */
async function activeLink(c: AppContext, tournamentId: string): Promise<boolean> {
  if (!discordConfigured(c.get('env'))) return false;
  const link = await c.get('deps').db().discordLink.findUnique({ where: { tournamentId }, select: { channelId: true, linkedAt: true } });
  return Boolean(link?.channelId && link.linkedAt);
}

/**
 * Aviso no canal vinculado, pela fila (o QStash tenta de novo se o Discord falhar). Chamado depois do commit, junto
 * de `notify`/`publish`. Nunca lança: falha vai para o log e não desfaz a ação.
 */
export async function announceDiscord(c: AppContext, tournamentId: string, kind: DiscordAnnouncementKind, content: string, dedupKey: string): Promise<void> {
  try {
    if (!(await activeLink(c, tournamentId))) return;
    const body: DiscordAnnounceJob = { tournamentId, kind, content };
    await c.get('deps').queue(c.get('env'), c.get('log')).schedule({ path: DISCORD_ANNOUNCE_JOB_PATH, body, at: c.get('deps').now(), dedupId: `discord-${kind.toLowerCase()}-${dedupKey}`.slice(0, 180) });
  } catch (error) {
    c.get('log').error('falha ao agendar aviso no Discord', { kind, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Lembrete "partida em 15 minutos" no canal. Reagendar cria outra mensagem; a antiga encontra outro horário e não faz nada. */
export async function scheduleDiscordReminder(c: AppContext, match: { id: string; scheduledAt: Date | null }, tournamentId: string): Promise<void> {
  try {
    if (!match.scheduledAt || !(await activeLink(c, tournamentId))) return;
    const at = new Date(match.scheduledAt.getTime() - REMINDER_MINUTES * 60_000);
    if (match.scheduledAt.getTime() <= c.get('deps').now().getTime()) return;
    const body: DiscordReminderJob = { matchId: match.id, scheduledAt: match.scheduledAt.toISOString() };
    await c.get('deps').queue(c.get('env'), c.get('log')).schedule({ path: DISCORD_REMINDER_JOB_PATH, body, at, dedupId: `discord-reminder-${match.id}-${match.scheduledAt.getTime()}` });
  } catch (error) {
    c.get('log').error('falha ao agendar lembrete no Discord', { matchId: match.id, error: error instanceof Error ? error.message : String(error) });
  }
}

export function siteUrlOf(c: AppContext): string {
  return (c.get('env').NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');
}
