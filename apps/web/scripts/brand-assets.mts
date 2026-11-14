/**
 * Gera os arquivos estáticos da marca a partir do vetor (`shared/brand/logoPaths.ts`) e das cores de
 * `packages/ui/src/styles/tokens.css`. Rode de novo sempre que o símbolo ou as cores mudarem:
 *
 *   node apps/web/scripts/brand-assets.mts
 *
 * Saída (versionada):
 * - public/brand/nova-arena-simbolo.svg           símbolo para fundo claro
 * - public/brand/nova-arena-simbolo-negativo.svg  símbolo para fundo escuro
 * - public/brand/nova-arena-simbolo-1024.png      PNG em alta, fundo transparente (redes sociais, imprensa)
 * - app/icon.svg                                  favicon (navegadores atuais)
 * - app/favicon.ico                               favicon 16, 32 e 48 px (navegadores antigos)
 * - app/apple-icon.png                            ícone de 180 px da tela inicial do iPhone
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADIENTS, LETTER_A_LEG, LETTER_A_STROKE, LETTER_N, LOGO_VIEWBOX, ORBIT_BACK, ORBIT_FRONT } from '../shared/brand/logoPaths.ts';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// O sharp já vem com o Next (dependência opcional dele): carrega pelo caminho do Next, sem dependência nova.
const requireFromNext = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
const sharp = requireFromNext('sharp') as typeof import('sharp');

// ── Cores, lidas dos tokens ──────────────────────────────────────────
const tokens = readFileSync(resolve(web, '../../packages/ui/src/styles/tokens.css'), 'utf8');
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!match?.[1]) throw new Error(`Token ${name} não encontrado em tokens.css`);
  return match[1];
}
const glow = token('--brand-glow');
const mid = token('--brand-mid');
const deep = token('--brand-deep');
const ink = token('--brand-ink');
const inkOnDark = '#ecfdf5'; // = --logo-ink do tema escuro (o mesmo --text do tema escuro)

// ── SVG ─────────────────────────────────────────────────────────────
function mark(nColor: string, prefix: string): string {
  const { back, front, stroke } = GRADIENTS;
  const stops = (a: number) => `<stop offset="0" stop-color="${glow}"/><stop offset="${a}" stop-color="${mid}"/><stop offset="1" stop-color="${deep}"/>`;
  return [
    '<defs>',
    `<radialGradient id="${prefix}b" gradientUnits="userSpaceOnUse" cx="${back.cx}" cy="${back.cy}" r="${back.r}">${stops(0.55)}</radialGradient>`,
    `<radialGradient id="${prefix}f" gradientUnits="userSpaceOnUse" cx="${front.cx}" cy="${front.cy}" r="${front.r}">${stops(0.6)}</radialGradient>`,
    `<linearGradient id="${prefix}s" gradientUnits="userSpaceOnUse" x1="${stroke.x1}" y1="${stroke.y1}" x2="${stroke.x2}" y2="${stroke.y2}">${stops(0.65)}</linearGradient>`,
    '</defs>',
    `<path d="${ORBIT_BACK}" fill="url(#${prefix}b)"/>`,
    `<path d="${LETTER_N}" fill="${nColor}"/>`,
    `<path d="${LETTER_A_STROKE}" fill="url(#${prefix}s)"/>`,
    `<path d="${LETTER_A_LEG}" fill="${nColor}"/>`,
    `<path d="${ORBIT_FRONT}" fill="url(#${prefix}f)"/>`,
  ].join('');
}

const symbol = (nColor: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" role="img" aria-label="Nova Arena">${mark(nColor, 'na')}</svg>\n`;

/** Ícone quadrado: placa escura com cantos arredondados e o símbolo em negativo, centralizado. */
function appIcon(size: number, radius: number): string {
  const [vx, vy, vw, vh] = LOGO_VIEWBOX.split(' ').map(Number) as [number, number, number, number];
  const pad = size * 0.08;
  const scale = (size - pad * 2) / vw;
  const tx = pad - vx * scale;
  const ty = (size - vh * scale) / 2 - vy * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${ink}"/><g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">${mark(inkOnDark, 'ic')}</g></svg>\n`;
}

/** ICO com PNGs dentro (aceito por todos os navegadores desde o IE Vista). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const out = (path: string) => {
  const full = resolve(web, path);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};

writeFileSync(out('public/brand/nova-arena-simbolo.svg'), symbol(ink));
writeFileSync(out('public/brand/nova-arena-simbolo-negativo.svg'), symbol(inkOnDark));
await sharp(Buffer.from(symbol(ink)), { density: 300 }).resize({ width: 1024 }).png().toFile(out('public/brand/nova-arena-simbolo-1024.png'));

const iconSvg = appIcon(512, 112);
writeFileSync(out('app/icon.svg'), iconSvg);
await sharp(Buffer.from(appIcon(180, 0)), { density: 300 }).resize(180, 180).png().toFile(out('app/apple-icon.png'));
const icoPngs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await sharp(Buffer.from(iconSvg), { density: 300 }).resize(size, size).png().toBuffer() })));
writeFileSync(out('app/favicon.ico'), ico(icoPngs));

console.log('Arquivos da marca gerados em apps/web/public/brand e apps/web/app.');
