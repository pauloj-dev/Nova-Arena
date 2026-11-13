/**
 * Gerador pequeno de QR Code (ISO/IEC 18004, "Model 2"), só com o que o 2FA precisa:
 * modo byte, correção de erro nível M, versões 1 a 15 (até 412 bytes) e escolha automática da máscara.
 * Existe para não trazer uma biblioteca só para desenhar o endereço `otpauth://`.
 */

/** Códigos de correção por bloco e número de blocos, nível M, por versão (índice 0 não é usado). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
const MAX_VERSION = ECC_PER_BLOCK.length - 1;
/** Bits do nível M na informação de formato. */
const FORMAT_LEVEL_M = 0;

export type QrMatrix = boolean[][];

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0);
}

// ── Reed-Solomon sobre GF(2^8), polinômio 0x11D ──────────────────────
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 255;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Divide em blocos, calcula a correção de cada um e intercala os bytes na ordem em que vão para a matriz. */
function addErrorCorrection(data: number[], version: number): number[] {
  const numBlocks = BLOCKS[version] ?? 1;
  const eccLen = ECC_PER_BLOCK[version] ?? 0;
  const raw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i += 1) {
    const chunk = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += chunk.length;
    const ecc = rsRemainder(chunk, divisor);
    if (i < numShort) chunk.push(0);
    blocks.push(chunk.concat(ecc));
  }
  const result: number[] = [];
  const longest = blocks[0]?.length ?? 0;
  for (let i = 0; i < longest; i += 1) {
    blocks.forEach((block, j) => {
      // O byte de preenchimento dos blocos curtos não entra.
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i] ?? 0);
    });
  }
  return result;
}

/** Cabeçalho do modo byte + dados + terminador + bytes de preenchimento, até a capacidade da versão. */
function encodeBytes(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    out.push(byte);
  }
  return out;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((size - 13) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(
    readonly version: number,
    readonly size: number,
  ) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  get(x: number, y: number): boolean {
    return this.modules[y]?.[x] ?? false;
  }
  private set(x: number, y: number, dark: boolean): void {
    const row = this.modules[y];
    if (row && x >= 0 && x < this.size) row[x] = dark;
  }
  private setFunction(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.set(x, y, dark);
    const row = this.reserved[y];
    if (row) row[x] = true;
  }
  private isReserved(x: number, y: number): boolean {
    return this.reserved[y]?.[x] ?? false;
  }

  drawFunctionPatterns(): void {
    const { size } = this;
    for (let i = 0; i < size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }
    const align = alignmentPositions(this.version, size);
    const last = align.length - 1;
    align.forEach((ax, i) => {
      align.forEach((ay, j) => {
        // Os três cantos com o padrão de posição não levam padrão de alinhamento.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) this.setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    this.drawFormat(0);
    this.drawVersion();
  }

  drawFormat(mask: number): void {
    const { size } = this;
    const data = (FORMAT_LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Coloca os bytes em ziguezague, de baixo para cima a partir do canto inferior direito. */
  drawCodewords(data: number[]): void {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isReserved(x, y) && i < data.length * 8) {
            this.set(x, y, (((data[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) !== 0);
            i += 1;
          }
        }
      }
    }
  }

  /** Aplicar a mesma máscara duas vezes desfaz (XOR). */
  applyMask(mask: number): void {
    const fn = MASKS[mask];
    if (!fn) return;
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (!this.isReserved(x, y) && fn(x, y)) this.set(x, y, !this.get(x, y));
      }
    }
  }

  /** Pontuação de penalidade da norma: quanto menor, mais fácil de ler. */
  penalty(): number {
    const { size } = this;
    let result = 0;
    const line = (at: (i: number) => boolean) => {
      // Sequências de 5 ou mais módulos iguais.
      let run = 1;
      for (let i = 1; i < size; i += 1) {
        if (at(i) === at(i - 1)) {
          run += 1;
          if (run === 5) result += 3;
          else if (run > 5) result += 1;
        } else run = 1;
      }
      // Padrão parecido com o de posição (1:1:3:1:1 com 4 claros de um dos lados).
      const bits = Array.from({ length: size }, (_, i) => (at(i) ? '1' : '0')).join('');
      for (const pattern of ['10111010000', '00001011101']) {
        for (let from = bits.indexOf(pattern); from >= 0; from = bits.indexOf(pattern, from + 1)) result += 40;
      }
    };
    for (let y = 0; y < size; y += 1) line((i) => this.get(i, y));
    for (let x = 0; x < size; x += 1) line((i) => this.get(x, i));
    // Blocos 2×2 da mesma cor.
    let dark = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const c = this.get(x, y);
        if (c) dark += 1;
        if (x + 1 < size && y + 1 < size && c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) result += 3;
      }
    }
    // Equilíbrio entre claros e escuros.
    const total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }
}

/** Matriz do QR Code (verdadeiro = módulo escuro), sem a margem. */
export function qrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  // 4 bits de modo + contador (1 ou 2 bytes) + dados.
  while (version <= MAX_VERSION && Math.ceil((4 + (version <= 9 ? 8 : 16) + bytes.length * 8) / 8) > dataCodewords(version)) version += 1;
  if (version > MAX_VERSION) throw new Error('Texto longo demais para o QR Code');

  const grid = new Grid(version, version * 4 + 17);
  grid.drawFunctionPatterns();
  grid.drawCodewords(addErrorCorrection(encodeBytes(bytes, version), version));

  let best = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    grid.applyMask(mask);
    grid.drawFormat(mask);
    const penalty = grid.penalty();
    if (penalty < bestPenalty) {
      best = mask;
      bestPenalty = penalty;
    }
    grid.applyMask(mask);
  }
  grid.applyMask(best);
  grid.drawFormat(best);
  return grid.modules.map((row) => [...row]);
}

/**
 * SVG do QR Code, com margem de 4 módulos. Sempre preto sobre branco, nos dois temas:
 * leitor de QR precisa do contraste máximo e não entende código claro sobre fundo escuro.
 */
export function qrSvg(text: string, opts: { margin?: number } = {}): string {
  const matrix = qrMatrix(text);
  const margin = opts.margin ?? 4;
  const size = matrix.length + margin * 2;
  let path = '';
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + margin},${y + margin}h1v1h-1z`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>`;
}
