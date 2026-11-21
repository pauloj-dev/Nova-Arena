/**
 * Registra (ou atualiza) os comandos do bot do Discord da Nova Arena (issue 121): `/nova-arena vincular`, `checkin` e
 * `proxima`. A lista vem de `packages/api/src/discord/index.ts` (a mesma que a rota de interações atende).
 *
 * Uso (Node 22.18+ roda TypeScript direto):
 *
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node ops/discord/register-commands.mts
 *   DISCORD_GUILD_ID=... (opcional): registra só naquele servidor — aparece na hora, bom para testar.
 *   --dry-run: só mostra o que seria enviado, sem chamar o Discord.
 *
 * Sem `DISCORD_GUILD_ID`, os comandos são globais (o Discord pode levar alguns minutos para mostrar). O `PUT`
 * substitui a lista inteira: rodar de novo é seguro.
 */
import process from 'node:process';
import { DISCORD_API, DISCORD_COMMANDS } from '../../packages/api/src/discord/index.ts';

const dryRun = process.argv.includes('--dry-run');
const appId = process.env.DISCORD_APP_ID?.trim();
const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (dryRun) {
  console.log(JSON.stringify(DISCORD_COMMANDS, null, 2));
  process.exit(0);
}
if (!appId || !token) {
  console.error('Defina DISCORD_APP_ID e DISCORD_BOT_TOKEN (Discord Developer Portal → sua aplicação).');
  process.exit(1);
}

const url = guildId ? `${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands` : `${DISCORD_API}/applications/${appId}/commands`;
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(DISCORD_COMMANDS),
});
if (!res.ok) {
  console.error(`O Discord recusou o registro (HTTP ${res.status}): ${await res.text()}`);
  process.exit(1);
}
const saved = (await res.json()) as { name: string }[];
console.log(`Comandos registrados ${guildId ? `no servidor ${guildId}` : 'globalmente'}: ${saved.map((c) => `/${c.name}`).join(', ')}`);
console.log('Lembre de configurar a "Interactions Endpoint URL" da aplicação: <SITE_URL>/api/v1/discord/interactions');
