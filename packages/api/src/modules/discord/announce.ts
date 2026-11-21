/**
 * Avisos do bot do Discord chamados pelos módulos de competição (issue 121), depois do commit, junto de
 * `notify`/`publish`. Só montam o texto e põem na fila (`announceDiscord`); nunca lançam. Arquivo separado do módulo
 * de rotas para não criar dependência circular com `competition/*`.
 */
import type { AppContext } from '../../context';
import { announceDiscord, discordEscape, siteUrlOf } from '../../discord';

/** Resultado lançado ou corrigido (inclui W.O.). */
export async function announceResult(c: AppContext, input: { tournamentId: string; tournamentName: string; slug: string; matchId: string; label: string; corrected?: boolean; walkover?: boolean }): Promise<void> {
  const title = input.walkover ? 'W.O. aplicado' : input.corrected ? 'Resultado corrigido' : 'Resultado lançado';
  await announceDiscord(c, input.tournamentId, 'RESULT_POSTED', `📊 **${title}** — ${discordEscape(input.label)} · ${discordEscape(input.tournamentName)}\nTabela e chave atualizadas: ${siteUrlOf(c)}/c/${input.slug}?aba=partidas`, `${input.matchId}-${c.get('deps').now().getTime()}`);
}

/** Chave confirmada (primeira fase ou fase nova). */
export async function announceBracket(c: AppContext, input: { tournamentId: string; tournamentName: string; slug: string; stageId: string; stageName: string; first: boolean }): Promise<void> {
  const title = input.first ? 'A chave saiu!' : `Nova fase: ${discordEscape(input.stageName)}`;
  await announceDiscord(c, input.tournamentId, 'BRACKET_RELEASED', `🗂️ **${title}** ${discordEscape(input.tournamentName)} — confira os confrontos: ${siteUrlOf(c)}/c/${input.slug}?aba=chave`, input.stageId);
}

/** Campeonato encerrado, com o pódio. */
export async function announceChampion(c: AppContext, input: { tournamentId: string; tournamentName: string; slug: string; places: { place: number; name: string }[] }): Promise<void> {
  const medal = ['🥇', '🥈', '🥉'];
  const podium = input.places
    .slice(0, 3)
    .map((p) => `${medal[p.place - 1] ?? `${p.place}º`} ${discordEscape(p.name)}`)
    .join('\n');
  await announceDiscord(c, input.tournamentId, 'CHAMPION', `🏆 **${discordEscape(input.tournamentName)} terminou!** Campeão: **${discordEscape(input.places[0]?.name ?? '—')}**\n${podium}\n${siteUrlOf(c)}/c/${input.slug}`, input.tournamentId);
}
