import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

/**
 * Pós-lançamento: leitura do print com OCR (issue 123, flag `resultOcr`) e lançamento de resultados sem conexão
 * (issue 125). O OCR de verdade (Tesseract) tem teste próprio em Node (`features/ocr/recognize.real.test.ts`); aqui o
 * reconhecimento é trocado por `window.__novaOcr` para o teste não depender de baixar o leitor.
 */

const COPA = 'tn_copa_ff';
const S1 = 'tn_copa_ff_s1';
const LIGA = '/c/liga-semanal-clash-royale?aba=partidas';
const PRINT = resolve(__dirname, '../features/ocr/fixtures/queda-br.png');
const PRINT_DUEL = resolve(__dirname, '../features/ocr/fixtures/duelo.png');

interface ApiMatch {
  id: string;
  kind: 'DUEL' | 'LOBBY';
  status: string;
  participants: { registrationId: string | null; name: string }[];
}

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ m, p, b }) => {
      const res = await fetch(`/api/v1${p}`, { method: m, headers: b === undefined ? {} : { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
      const text = await res.text();
      return { status: res.status, data: (text ? JSON.parse(text) : null) as never };
    },
    { m: method, p: path, b: body },
  );
}

async function ok<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const res = await api<T>(page, method, path, body);
  expect(res.status, `${method} ${path} → ${JSON.stringify(res.data)}`).toBeLessThan(300);
  return res.data;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'a página não pode rolar na horizontal').toBeLessThanOrEqual(1);
}

/** Liga a flag experimental como Super Admin (a flag vale no protótipo inteiro). */
async function enableOcr(page: Page): Promise<void> {
  await loginAs(page, 'u_rafael');
  await ok(page, 'PUT', '/admin/flags/resultOcr', { enabled: true });
}

/** Fecha as inscrições da Copa e confirma a chave: devolve a primeira queda. */
async function firstDrop(page: Page): Promise<ApiMatch> {
  await ok(page, 'POST', `/tournaments/${COPA}/close-registration`);
  await ok(page, 'POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'e2e-pos-b' });
  await ok(page, 'POST', `/stages/${S1}/confirm`);
  const bracket = await ok<{ matches: ApiMatch[] }>(page, 'GET', `/stages/${S1}/bracket`);
  return bracket.matches.find((m) => m.kind === 'LOBBY') as ApiMatch;
}

/** Reconhecimento falso: devolve este texto como se tivesse lido o print. */
async function stubOcr(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    (window as unknown as { __novaOcr: unknown }).__novaOcr = async (_image: Blob, onProgress?: (p: number, s: string) => void) => {
      onProgress?.(1, 'Lendo o print');
      return { text: t, confidence: 90, lines: t.split('\n').map((line) => ({ text: line, confidence: 90 })) };
    };
  }, text);
}

const card = (page: Page, matchId: string): Locator => page.locator(`[data-match-id="${matchId}"]`);
const openDrop = async (page: Page, drop: ApiMatch) => {
  await page.goto(`/organizador/campeonatos/${COPA}?aba=partidas`);
  await waitForApp(page);
  await card(page, drop.id).getByRole('button', { name: /Lançar resultado/ }).click();
  await expect(page.getByTestId('result-panel')).toBeVisible();
};

test.describe('leitura do print (OCR, experimental)', () => {
  test('organização: lê o print da queda, marca os valores e só valida depois da conferência', async ({ page }) => {
    await enableOcr(page);
    await loginAs(page, 'u_camila');
    const drop = await firstDrop(page);
    const [alfa, bravo, charlie] = drop.participants.map((p) => p.name) as [string, string, string];
    await openDrop(page, drop);
    await stubOcr(page, `RESULTADO DA QUEDA\n#1 ${charlie} 12 kills\n#2 ${alfa} 7 kills\n#3 ${bravo} 0 kills`);

    await page.getByRole('button', { name: 'Ler o print' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ler o print (experimental)' });
    await dialog.getByLabel('Escolher imagem do print').setInputFiles(PRINT);
    await expect(dialog.getByRole('img', { name: 'Prévia do print escolhido' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Ler o print' }).click();
    await expect(dialog.getByTestId('ocr-row')).toHaveCount(3);
    await expect(dialog.getByText('Lido do print').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: 'Usar estes valores' }).click();
    await expect(dialog).toHaveCount(0);

    // Preenchido e marcado, mas nada foi gravado.
    await expect(page.getByRole('textbox', { name: `Colocação de ${charlie}` })).toHaveValue('1');
    await expect(page.getByRole('textbox', { name: `Kills de ${alfa}` })).toHaveValue('7');
    await expect(page.getByTestId('ocr-mark')).toHaveCount(6);
    expect((await ok<ApiMatch>(page, 'GET', `/matches/${drop.id}`)).status).not.toBe('VALIDATED');

    await page.getByRole('button', { name: 'Validar queda' }).click();
    await expect(page.getByText('Marque que conferiu os valores lidos do print antes de validar.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Conferi os valores lidos do print' })).toBeFocused();
    await page.getByRole('checkbox', { name: 'Conferi os valores lidos do print' }).click();
    await page.getByRole('button', { name: 'Validar queda' }).click();
    await expect(page.getByTestId('server-points')).toContainText(charlie);
    await expectNoHorizontalScroll(page);
  });

  test('participante: lê o placar do print no envio de resultado', async ({ page }) => {
    await enableOcr(page);
    await loginAs(page, 'u_bianca');
    await page.goto(LIGA);
    await waitForApp(page);
    const matches = await ok<ApiMatch[]>(page, 'GET', '/tournaments/tn_liga_cr/matches?mine=1');
    const match = matches.find((m) => m.status !== 'VALIDATED' && m.participants.every((p) => p.registrationId)) as ApiMatch;
    const rival = match.participants.find((p) => p.name !== 'Bianca')?.name as string;
    await stubOcr(page, `FIM DE JOGO\nBianca 2 x 1 ${rival}`);

    await card(page, match.id).getByRole('button', { name: 'Enviar resultado' }).click();
    const send = page.getByRole('dialog', { name: 'Enviar resultado' });
    await send.getByRole('button', { name: 'Ler o print' }).click();
    const ocr = page.getByRole('dialog', { name: 'Ler o print (experimental)' });
    await ocr.getByLabel('Escolher imagem do print').setInputFiles(PRINT_DUEL);
    await ocr.getByRole('button', { name: 'Ler o print' }).click();
    await ocr.getByRole('button', { name: 'Usar estes valores' }).click();
    await expect(ocr).toHaveCount(0);
    await expect(send.getByLabel('Placar de Bianca (você)')).toHaveValue('2');
    await expect(send.getByLabel(`Placar de ${rival}`)).toHaveValue('1');
    await expect(send.getByTestId('ocr-mark')).toHaveCount(2);
    await expect(send.getByRole('checkbox', { name: 'Conferi os valores lidos do print' })).not.toBeChecked();
    await expectNoHorizontalScroll(page);
  });

  test('sem a flag, o botão não aparece', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const drop = await firstDrop(page);
    await openDrop(page, drop);
    await expect(page.getByRole('button', { name: 'Validar queda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ler o print' })).toHaveCount(0);
  });
});

test.describe('resultados offline', () => {
  test('sem conexão, a queda fica guardada no aparelho e vai sozinha quando a conexão volta', async ({ page, context }) => {
    await loginAs(page, 'u_camila');
    const drop = await firstDrop(page);
    const names = drop.participants.map((p) => p.name);
    await openDrop(page, drop);
    for (const [i, name] of names.entries()) {
      await page.getByRole('textbox', { name: `Colocação de ${name}` }).fill(String(i + 1));
      await page.getByRole('textbox', { name: `Kills de ${name}` }).fill(String(names.length - i));
    }

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Validar queda' }).click();
    await expect(page.getByTestId('saved-offline')).toContainText('Guardado neste aparelho');
    await page.getByRole('button', { name: 'Voltar para as partidas' }).first().click();

    const panel = page.getByTestId('pending-results');
    await expect(panel).toContainText('Resultados pendentes de envio');
    await expect(panel).toContainText('Você está sem conexão');
    await expect(panel.getByTestId('pending-status')).toHaveText('Aguardando conexão');
    await expectNoHorizontalScroll(page);

    await context.setOffline(false);
    await expect(page.getByText('Resultado guardado foi enviado')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(card(page, drop.id)).toHaveAttribute('data-status', 'VALIDATED');
  });

  test('conflito: outra pessoa lançou antes — mostra com clareza e deixa ver o resultado atual ou descartar', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const drop = await firstDrop(page);
    // Outra pessoa da organização lança a queda.
    await ok(page, 'PUT', `/matches/${drop.id}/result`, { entries: drop.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 1 })) });
    // E neste aparelho havia um lançamento da mesma queda guardado sem conexão.
    await page.evaluate(
      async ({ match, entries }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('nova-arena-offline', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('pending-results', { keyPath: 'idempotencyKey' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('pending-results', 'readwrite');
          tx.objectStore('pending-results').put({ idempotencyKey: 'e2e-conflito', matchId: match, tournamentId: 'tn_copa_ff', stageId: 'tn_copa_ff_s1', label: 'Copa · Queda 1', payload: { entries, evidenceUrls: [] }, createdAt: new Date().toISOString(), status: 'PENDING', error: null, attempts: 0 });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { match: drop.id, entries: drop.participants.map((p, i) => ({ registrationId: p.registrationId, placement: drop.participants.length - i, kills: 5 })) },
    );

    await page.goto(`/organizador/campeonatos/${COPA}?aba=partidas`);
    await waitForApp(page);
    const panel = page.getByTestId('pending-results');
    await expect(panel.getByTestId('pending-status')).toHaveText('Conflito');
    await expect(panel.getByRole('alert')).toContainText('Outra pessoa já lançou o resultado desta partida');
    await expectNoHorizontalScroll(page);

    await panel.getByRole('button', { name: 'Ver resultado atual' }).click();
    await expect(page.getByTestId('result-history')).toContainText('Resultado lançado');
    await page.getByRole('button', { name: 'Voltar para as partidas' }).first().click();

    await panel.getByRole('button', { name: 'Descartar o resultado guardado de Copa · Queda 1' }).click();
    await panel.getByRole('button', { name: 'Confirmar descarte' }).click();
    await expect(panel).toHaveCount(0);
  });
});

export type { DemoUser };
