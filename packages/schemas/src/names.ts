/**
 * Filtro de nomes (issue #72, lacuna): apelido, nome e tag de squad não podem ser ofensivos nem se passar
 * pela plataforma. Mesma regra na tela, na API simulada e na API real.
 *
 * Como funciona, para não barrar nome inocente ("computador" tem "puta" no meio):
 * - o nome é normalizado (minúsculas, sem acento, `0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`);
 * - é quebrado em pedaços por separador (`._-`) e por troca de maiúscula ("PutaMerda");
 * - palavras curtas só contam como pedaço inteiro; as longas e inconfundíveis contam em qualquer lugar.
 *
 * A lista é curta de propósito: o que escapar vai para a denúncia e a moderação.
 */

/** Ofensas que só barram como pedaço inteiro (podem aparecer dentro de palavras comuns). */
const OFFENSIVE_WORDS = new Set([
  'puta', 'puto', 'porra', 'merda', 'bosta', 'foda', 'fodase', 'cu', 'cuzao', 'viado', 'veado', 'bicha', 'traveco',
  'fdp', 'vsf', 'pqp', 'tnc', 'otario', 'babaca', 'vadia', 'piranha', 'corno', 'retardado', 'mongol',
  'fuck', 'fucker', 'shit', 'bitch', 'cunt', 'dick', 'whore', 'slut', 'fag', 'nazi', 'estupro', 'estuprador',
]);

/** Ofensas inconfundíveis: barram mesmo no meio do nome. */
const OFFENSIVE_ANYWHERE = ['caralho', 'buceta', 'arrombad', 'filhodaputa', 'putaria', 'hitler', 'nigger', 'nigga', 'faggot', 'pedofil', 'heilhitler', 'siegheil'];

/** Quem pode parecer a própria plataforma ou a equipe. */
const RESERVED_ANYWHERE = ['novaarena', 'administrador', 'administracao', 'moderador', 'moderacao', 'suporte', 'oficial', 'official'];
const RESERVED_WORDS = new Set(['admin', 'adm', 'mod', 'staff', 'equipe', 'root', 'sistema', 'system', 'support', 'null', 'undefined', 'api', 'www']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch);
}

/** "PutaMerda_99" → ["puta", "merda"]; "Nova.Arena" → ["nova", "arena"]. */
function pieces(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/)
    .map(normalize)
    .filter(Boolean);
}

export type NameKind = 'nickname' | 'team' | 'tag';

/** Motivo para recusar o nome, em texto para a pessoa, ou `null` se pode usar. */
export function nameBlockReason(value: string, kind: NameKind = 'nickname'): string | null {
  const whole = normalize(value).replace(/[^a-z]/g, '');
  const parts = pieces(value);
  const offensive = parts.some((p) => OFFENSIVE_WORDS.has(p)) || OFFENSIVE_WORDS.has(whole) || OFFENSIVE_ANYWHERE.some((w) => whole.includes(w));
  if (offensive) return 'Esse nome não é permitido. Escolha outro, sem palavrões ou ofensas.';
  // Squads podem ter "Arena" ou "Nova" no nome; só apelidos e tags não podem imitar a equipe.
  const reservedWord = kind === 'team' ? false : parts.some((p) => RESERVED_WORDS.has(p)) || RESERVED_WORDS.has(whole);
  if (reservedWord || RESERVED_ANYWHERE.some((w) => whole.includes(w))) return 'Esse nome é reservado para a equipe da Nova Arena. Escolha outro.';
  return null;
}
