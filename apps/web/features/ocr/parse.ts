/**
 * Leitura do print do resultado (issue 123, experimental): transforma o texto que o OCR achou na imagem em
 * **sugestões** para o formulário — colocação e kills por equipe numa queda de Battle Royale, ou o placar de cada
 * lado num duelo. Funções puras, testadas com textos de exemplo.
 *
 * Nada aqui grava resultado: a tela mostra o que foi lido, destaca cada valor e só usa depois da conferência humana.
 */

/** Uma linha lida pelo OCR, com a confiança de 0 a 100 (como o Tesseract devolve). */
export interface OcrLine {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  /** Confiança média da página, de 0 a 100. */
  confidence: number;
}

/** Equipe (ou jogador) da partida que o print pode citar. */
export interface OcrCandidate {
  registrationId: string;
  name: string;
  tag: string | null;
}

export interface BrSuggestion {
  registrationId: string;
  placement: number | null;
  kills: number | null;
  /** A colocação veio da ordem das linhas (o print não mostrava o número). */
  placementInferred: boolean;
  /** 0 a 1: confiança do OCR na linha × semelhança do nome. */
  confidence: number;
  /** Texto da linha de onde os números saíram. */
  source: string;
}

export interface BrParseResult {
  suggestions: BrSuggestion[];
  /** Linhas com números que não bateram com nenhuma equipe (a pessoa confere à mão). */
  unmatched: string[];
}

export interface DuelSuggestion {
  registrationId: string;
  score: number | null;
  confidence: number;
  source: string | null;
}

/** Abaixo disso, a tela pede atenção redobrada ("Conferir"). */
export const LOW_CONFIDENCE = 0.7;
/** Semelhança mínima entre o texto e o nome para considerar que a linha é daquela equipe. */
const MIN_SIMILARITY = 0.6;

/** Minúsculas, sem acento, só letras, números e espaço simples. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** 1 = igual; 0 = nada a ver. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ratio = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  // O nome inteiro dentro do texto (ou o contrário, com pelo menos 4 letras) vale quase como igual.
  const contains = (long: string, short: string) => short.length >= 4 && ` ${long} `.includes(` ${short} `);
  return Math.max(ratio, contains(x, y) || contains(y, x) ? 0.9 : 0);
}

/** Palavras que estão no nome de todas as equipes (ex.: "Squad"): não ajudam a diferenciar uma da outra. */
export function commonWords(candidates: OcrCandidate[]): Set<string> {
  if (candidates.length < 2) return new Set();
  const sets = candidates.map((c) => new Set(normalize(c.name).split(' ').filter(Boolean)));
  return new Set([...(sets[0] ?? [])].filter((w) => sets.every((set) => set.has(w))));
}

function withoutWords(text: string, words: Set<string>): string {
  if (words.size === 0) return text;
  const kept = normalize(text)
    .split(' ')
    .filter((w) => w && !words.has(w))
    .join(' ');
  // Nome feito só da palavra comum: compara como está.
  return kept || text;
}

/** Quanto o texto de uma linha lembra a equipe: pelo nome (sem as palavras comuns a todas) ou pela tag. */
export function candidateScore(text: string, candidate: OcrCandidate, ignore: Set<string> = new Set()): number {
  const words = normalize(text).split(' ');
  const tag = candidate.tag ? normalize(candidate.tag) : '';
  const byTag = tag.length >= 2 && words.includes(tag) ? 0.95 : 0;
  return Math.max(similarity(withoutWords(text, ignore), withoutWords(candidate.name, ignore)), byTag);
}

/** Confusões comuns do OCR em números: O → 0, l/I/| → 1, S → 5, B → 8 (só em palavra que já tem dígito). */
function fixDigits(token: string): string {
  const core = /^(#?)([\dOolI|SB]+)([.,:)]?)$/.exec(token);
  if (!core || !/\d/.test(core[2] ?? '')) return token;
  return `${core[1]}${(core[2] ?? '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')}${core[3]}`;
}

interface Token {
  text: string;
  value: number | null;
  /** Número escrito como ordinal ou com marca de posição: "1º", "#1", "1st". */
  ordinal: boolean;
}

const KILL_WORDS = /^(kills?|abates?|elims?|eliminac(ao|oes)|elim|k)$/;
const NOISE_WORDS = /^(pts?|pontos?|points?|lugar|posicao|pos|colocacao|top|rank)$/;

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const fixed = fixDigits(raw);
      const ordinal = /^#\d+$|^\d+(º|°|ª|st|nd|rd|th)$/i.test(fixed);
      const digits = /^#?(\d{1,3})(º|°|ª|st|nd|rd|th)?[.,:)]?$/i.exec(fixed);
      return { text: raw, value: digits ? Number.parseInt(digits[1] ?? '', 10) : null, ordinal };
    });
}

interface LineReading {
  line: OcrLine;
  index: number;
  name: string;
  placement: number | null;
  kills: number | null;
}

/**
 * Uma linha da tabela de resultado: o nome (o que não é número nem palavra de unidade), o número antes do nome
 * (colocação) e o depois (kills). Com um número só, decide pela posição ou pela palavra "kills"/"abates".
 */
function readLine(line: OcrLine, index: number): LineReading | null {
  const tokens = tokenize(line.text);
  const nameIdx = tokens.map((t, i) => (t.value === null && !KILL_WORDS.test(normalize(t.text)) && !NOISE_WORDS.test(normalize(t.text)) && normalize(t.text) ? i : -1)).filter((i) => i >= 0);
  const numbers = tokens.map((t, i) => ({ ...t, i })).filter((t) => t.value !== null);
  if (nameIdx.length === 0 || numbers.length === 0) return null;
  const first = nameIdx[0] ?? 0;
  const last = nameIdx[nameIdx.length - 1] ?? 0;
  const name = nameIdx.map((i) => tokens[i]?.text ?? '').join(' ');
  const before = numbers.filter((n) => n.i < first);
  const after = numbers.filter((n) => n.i > last);
  const killWordNear = (n: { i: number }) => [tokens[n.i - 1], tokens[n.i + 1]].some((t) => t && KILL_WORDS.test(normalize(t.text)));
  let placement: number | null = before.find((n) => n.ordinal)?.value ?? before[0]?.value ?? null;
  let kills: number | null = after.find((n) => killWordNear(n))?.value ?? after[after.length - 1]?.value ?? null;
  // Número antes do nome que é kills (ex.: "12 kills Alfa"), ou ordinal depois do nome.
  if (placement !== null && before.every((n) => killWordNear(n)) && kills === null) {
    kills = placement;
    placement = null;
  }
  const ordinalAfter = after.find((n) => n.ordinal);
  if (placement === null && ordinalAfter) {
    placement = ordinalAfter.value;
    const rest = after.filter((n) => n !== ordinalAfter);
    kills = rest.find((n) => killWordNear(n))?.value ?? rest[rest.length - 1]?.value ?? null;
  }
  return { line, index, name, placement, kills };
}

/** Linhas do texto bruto (quando o OCR não devolveu linhas com confiança). */
export function linesFromText(text: string, confidence = 80): OcrLine[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, confidence }));
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Queda de Battle Royale: cada equipe da sala ganha a colocação e as kills da linha em que o nome (ou a tag)
 * aparece. Cada linha serve a uma equipe só, pela melhor semelhança. Colocação fora da sala ou kills absurdas
 * são descartadas. Se o print não mostra a colocação, usa a ordem das linhas — marcada como "inferida".
 */
export function parseBrDrop(result: Pick<OcrResult, 'lines' | 'text'>, candidates: OcrCandidate[]): BrParseResult {
  const lines = result.lines.length > 0 ? result.lines : linesFromText(result.text);
  const readings = lines.map(readLine).filter((r): r is LineReading => r !== null);
  const pairs: { reading: LineReading; candidate: OcrCandidate; score: number }[] = [];
  const ignore = commonWords(candidates);
  for (const reading of readings) {
    for (const candidate of candidates) {
      const score = candidateScore(reading.name, candidate, ignore);
      if (score >= MIN_SIMILARITY) pairs.push({ reading, candidate, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.reading.index - b.reading.index);
  const usedLines = new Set<number>();
  const chosen = new Map<string, { reading: LineReading; score: number }>();
  for (const pair of pairs) {
    if (usedLines.has(pair.reading.index) || chosen.has(pair.candidate.registrationId)) continue;
    usedLines.add(pair.reading.index);
    chosen.set(pair.candidate.registrationId, { reading: pair.reading, score: pair.score });
  }

  const roomSize = candidates.length;
  const anyPlacement = [...chosen.values()].some((c) => c.reading.placement !== null);
  const byOrder = [...chosen.entries()].sort((a, b) => a[1].reading.index - b[1].reading.index).map(([id]) => id);
  const suggestions: BrSuggestion[] = candidates.flatMap((candidate) => {
    const hit = chosen.get(candidate.registrationId);
    if (!hit) return [];
    const { reading, score } = hit;
    let placement = reading.placement !== null && reading.placement >= 1 && reading.placement <= roomSize ? reading.placement : null;
    const inferred = !anyPlacement && placement === null;
    if (inferred) placement = byOrder.indexOf(candidate.registrationId) + 1;
    const kills = reading.kills !== null && reading.kills >= 0 && reading.kills <= 99 ? reading.kills : null;
    return [
      {
        registrationId: candidate.registrationId,
        placement,
        kills,
        placementInferred: inferred,
        confidence: clamp01((reading.line.confidence / 100) * score * (inferred ? 0.8 : 1)),
        source: reading.line.text,
      },
    ];
  });
  fillPlacementGaps(suggestions, chosen, roomSize);
  const unmatched = readings.filter((r) => !usedLines.has(r.index)).map((r) => r.line.text);
  return { suggestions, unmatched };
}

/**
 * Uma colocação que o OCR não leu (ex.: "#1" virou "al") sai das vizinhas: entre a linha do 2º e nada antes, é o
 * 1º; entre o 3º e o 5º, é o 4º. Só quando o número está livre e cabe entre as vizinhas. Fica marcada como inferida.
 */
function fillPlacementGaps(suggestions: BrSuggestion[], chosen: Map<string, { reading: LineReading }>, roomSize: number): void {
  const ordered = [...suggestions].sort((a, b) => (chosen.get(a.registrationId)?.reading.index ?? 0) - (chosen.get(b.registrationId)?.reading.index ?? 0));
  const used = new Set(ordered.map((s) => s.placement).filter((p): p is number => p !== null));
  ordered.forEach((s, i) => {
    if (s.placement !== null) return;
    const prev = ordered.slice(0, i).reverse().find((x) => x.placement !== null)?.placement ?? 0;
    const next = ordered.slice(i + 1).find((x) => x.placement !== null)?.placement ?? roomSize + 1;
    if (prev === 0 && next === roomSize + 1) return;
    const guess = prev > 0 ? prev + 1 : next - 1;
    if (guess >= 1 && guess <= roomSize && guess > prev && guess < next && !used.has(guess)) {
      s.placement = guess;
      s.placementInferred = true;
      s.confidence *= 0.8;
      used.add(guess);
    }
  });
}

const SCORE_PAIR = /(\d{1,3})\s*(?:x|X|×|-|–|:|a)\s*(\d{1,3})/;

/** Posição (no texto todo) onde o nome do lado aparece melhor; -1 se não aparece. */
function positionOf(lines: OcrLine[], candidate: OcrCandidate, ignore: Set<string>): { line: number; score: number } {
  let best = { line: -1, score: 0 };
  lines.forEach((line, i) => {
    const words = line.text.split(/\s+/);
    // Janela de palavras do tamanho do nome: acha o nome no meio do placar ("Alfa 3 x 1 Beta").
    const size = Math.max(1, candidate.name.split(/\s+/).length);
    for (let start = 0; start < words.length; start += 1) {
      const piece = words.slice(start, start + size).join(' ');
      const score = candidateScore(piece, candidate, ignore);
      if (score > best.score) best = { line: i * 1000 + start, score };
    }
  });
  return best.score >= MIN_SIMILARITY ? best : { line: -1, score: 0 };
}

/**
 * Duelo: placar dos dois lados. Procura "3 x 1" (ou 3-1, 3:1) e liga o primeiro número ao lado que aparece
 * primeiro no print; sem esse formato, usa a linha de cada nome com um número só.
 */
export function parseDuel(result: Pick<OcrResult, 'lines' | 'text'>, sides: [OcrCandidate, OcrCandidate], bestOf = 1): DuelSuggestion[] {
  const lines = result.lines.length > 0 ? result.lines : linesFromText(result.text);
  const valid = (n: number) => n >= 0 && n <= (bestOf > 1 ? Math.ceil(bestOf / 2) : 999);
  const ignore = commonWords(sides);
  const where = sides.map((side) => positionOf(lines, side, ignore)) as [{ line: number; score: number }, { line: number; score: number }];
  const empty = sides.map((s) => ({ registrationId: s.registrationId, score: null, confidence: 0, source: null }));

  const pairLine = lines.find((l) => SCORE_PAIR.test(l.text.replace(/[Oo](?=\s*[x×:-])/g, '0')));
  if (pairLine) {
    const m = SCORE_PAIR.exec(pairLine.text.replace(/[Oo](?=\s*[x×:-])/g, '0'));
    const first = Number(m?.[1]);
    const second = Number(m?.[2]);
    // Sem os nomes no print, vale a ordem da partida (lado A x lado B), com confiança menor.
    const aFirst = where[0].line === -1 || where[1].line === -1 ? true : where[0].line <= where[1].line;
    const named = where[0].line !== -1 && where[1].line !== -1;
    const conf = clamp01((pairLine.confidence / 100) * (named ? Math.min(where[0].score, where[1].score) : 0.6));
    const [scoreA, scoreB] = aFirst ? [first, second] : [second, first];
    return [
      { registrationId: sides[0].registrationId, score: valid(scoreA) ? scoreA : null, confidence: conf, source: pairLine.text },
      { registrationId: sides[1].registrationId, score: valid(scoreB) ? scoreB : null, confidence: conf, source: pairLine.text },
    ];
  }

  return sides.map((side, i) => {
    const pos = where[i];
    if (!pos || pos.line === -1) return empty[i] as DuelSuggestion;
    const line = lines[Math.floor(pos.line / 1000)];
    const value = line ? tokenize(line.text).find((t) => t.value !== null)?.value ?? null : null;
    if (!line || value === null || !valid(value)) return empty[i] as DuelSuggestion;
    return { registrationId: side.registrationId, score: value, confidence: clamp01((line.confidence / 100) * pos.score), source: line.text };
  });
}
