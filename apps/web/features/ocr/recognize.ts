/**
 * OCR no navegador (issue 123): o `tesseract.js` só é baixado quando a pessoa clica em "Ler o print" (`import()`
 * dinâmico — nada entra no pacote principal). A imagem não sai do aparelho: o reconhecimento roda num Web Worker.
 * Na primeira leitura, o navegador baixa o motor e o idioma (alguns MB, depois ficam em cache).
 *
 * No protótipo (API simulada), `window.__novaOcr` pode substituir o reconhecimento — é o que os testes E2E usam para
 * ser determinísticos.
 */
import { isModuleMocked } from '@/shared/api/mode';
import type { OcrLine, OcrResult } from './parse';

export type OcrProgress = (progress: number, status: string) => void;

export type Recognizer = (image: Blob, onProgress?: OcrProgress) => Promise<OcrResult>;

declare global {
  interface Window {
    /** Só no protótipo: reconhecimento falso para testes. */
    __novaOcr?: Recognizer;
  }
}

/** Estrutura mínima do resultado do Tesseract que usamos (blocos → parágrafos → linhas). */
interface TesseractPage {
  text: string;
  confidence: number;
  blocks: { paragraphs: { lines: { text: string; confidence: number }[] }[] }[] | null;
}

export function toOcrResult(page: TesseractPage): OcrResult {
  const lines: OcrLine[] = (page.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ text: l.text.trim(), confidence: l.confidence })))).filter((l) => l.text.length > 0);
  return { text: page.text, lines, confidence: page.confidence };
}

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Baixando o leitor',
  'initializing tesseract': 'Preparando o leitor',
  'loading language traineddata': 'Baixando o idioma',
  'initializing api': 'Preparando o leitor',
  'recognizing text': 'Lendo o print',
};

/** Reconhecimento real com o Tesseract, carregado sob demanda. */
export const tesseractRecognizer: Recognizer = async (image, onProgress) => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, STATUS[m.status] ?? 'Lendo o print'),
  });
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return toOcrResult(data as unknown as TesseractPage);
  } finally {
    await worker.terminate();
  }
};

/** O reconhecedor deste ambiente: o falso do protótipo, se houver, ou o Tesseract. */
export const recognizeImage: Recognizer = (image, onProgress) => {
  if (typeof window !== 'undefined' && window.__novaOcr && isModuleMocked('competition')) return window.__novaOcr(image, onProgress);
  return tesseractRecognizer(image, onProgress);
};
