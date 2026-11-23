// @vitest-environment node
/**
 * Leitura de verdade com o Tesseract (issue 123), sobre as imagens inventadas de `fixtures/` (geradas por
 * `scripts/ocr-fixtures.mts`). Baixa o idioma na primeira vez (precisa de internet) e guarda numa pasta temporária.
 * Fica de fora da execução padrão (é lento e depende de rede): rode com `OCR_REAL=1`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseBrDrop, parseDuel } from './parse';
import { toOcrResult } from './recognize';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
const cache = mkdtempSync(join(tmpdir(), 'nova-ocr-'));
afterAll(() => rmSync(cache, { recursive: true, force: true }));

async function read(image: Buffer) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { cachePath: cache });
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return toOcrResult(data as unknown as Parameters<typeof toOcrResult>[0]);
  } finally {
    await worker.terminate();
  }
}

describe.runIf(process.env.OCR_REAL === '1')('OCR real nas imagens de exemplo', () => {
  it('queda BR: colocação e kills das quatro equipes', { timeout: 180_000 }, async () => {
    const result = await read(fixture('queda-br.png'));
    const { suggestions } = parseBrDrop(result, [
      { registrationId: 'a', name: 'Squad Alfa', tag: null },
      { registrationId: 'b', name: 'Squad Bravo', tag: null },
      { registrationId: 'c', name: 'Squad Charlie', tag: null },
      { registrationId: 'd', name: 'Squad Delta', tag: null },
    ]);
    expect(Object.fromEntries(suggestions.map((s) => [s.registrationId, [s.placement, s.kills]]))).toEqual({ a: [2, 7], b: [4, 0], c: [1, 12], d: [3, 3] });
  });

  it('duelo: placar de cada lado', { timeout: 180_000 }, async () => {
    const result = await read(fixture('duelo.png'));
    const scores = parseDuel(
      result,
      [
        { registrationId: 'a', name: 'Bianca', tag: null },
        { registrationId: 'b', name: 'Lucas', tag: null },
      ],
      3,
    );
    expect(scores.map((s) => s.score)).toEqual([2, 1]);
  });
});
