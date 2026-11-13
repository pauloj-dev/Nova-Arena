import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, loginAs, test } from './fixtures';

/** Chama a API simulada de dentro da página (a sessão é a de quem está logado). */
async function api<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ path: p, init: i }) => {
      const res = await fetch(`/api/v1${p}`, {
        method: i?.method ?? 'GET',
        headers: i?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: i?.body === undefined ? undefined : JSON.stringify(i.body),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data: data as never };
    },
    { path, init },
  );
}

const stepTitle = (page: Page) => page.getByTestId('wizard-step-title');
const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar', exact: true });

/** Linha de uma inscrição: linha da tabela (desktop) ou cartão (celular) — só a que está visível. */
const registrationRow = (page: Page, name: string) => page.locator('tbody tr:visible, ul[aria-label^="Inscrições de"] > li:visible').filter({ hasText: name });

async function startBlank(page: Page, name: string) {
  await page.goto('/organizador/novo');
  await page.getByRole('button', { name: 'Começar do zero' }).click();
  await expect(stepTitle(page)).toHaveText('Informações');
  await page.getByLabel('Nome do campeonato').fill(name);
}

async function draftId(page: Page): Promise<string> {
  // O rascunho passa a existir (e o endereço vira o de edição) assim que o campeonato tem nome.
  await expect(page).toHaveURL(/\/organizador\/campeonatos\/[^/]+\/editar$/);
  const id = /campeonatos\/([^/]+)\/editar/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

test.describe('organizador — criar e publicar', () => {
  test('cria um campeonato de Free Fire Squad com 3 fases (grupos BR → mata-mata → final BR) e publica', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const name = 'Copa E2E Squad';
    await startBlank(page, name);
    await page.getByRole('textbox', { name: 'Descrição' }).fill('Três fases: grupos, mata-mata 4v4 e final em Battle Royale.');
    await continuar(page).click();

    // Jogo e modo
    await expect(stepTitle(page)).toHaveText('Jogo e modo');
    const id = await draftId(page);
    await page.getByRole('radio', { name: /Free Fire/ }).check();
    await page.getByRole('radio', { name: /^Squad/ }).check();
    await continuar(page).click();

    // Inscrições: os padrões já servem (48 vagas, datas futuras, fuso explícito)
    await expect(stepTitle(page)).toHaveText('Inscrições');
    await expect(page.getByLabel(/Número de vagas/)).toHaveValue('48');
    await expect(page.getByLabel(/Início do campeonato/)).not.toHaveValue('');
    await expect(page.getByText('(horário de Brasília)').first()).toBeVisible();
    await continuar(page).click();

    // Fases: a sugestão traz grupos BR + final; falta o mata-mata no meio
    await expect(stepTitle(page)).toHaveText('Fases');
    await expect(page.getByTestId('stage-card-0')).toContainText('Fase de grupos');
    await expect(page.getByTestId('stage-card-1')).toContainText('Grande Final');

    await page.getByRole('button', { name: 'Adicionar fase' }).click();
    const added = page.getByTestId('stage-card-2');
    await added.getByLabel('Nome da fase').fill('Mata-mata 4v4');
    await added.getByRole('radio', { name: /Equipe x Equipe/ }).check();
    await expect(added.getByLabel('Série de cada confronto')).toHaveValue('3');
    // Alternativa de teclado ao arrastar: o botão "mover para cima"
    await page.getByRole('button', { name: 'Mover a fase Mata-mata 4v4 para cima' }).click();
    await expect(page.getByTestId('stage-card-1')).toContainText('Mata-mata 4v4');
    await expect(page.getByTestId('stage-card-2')).toContainText('Grande Final');
    await expect(page.getByTestId('stage-card-1').getByLabel('Quantos vencedores avançam')).toHaveValue('2');

    // Fase 1: top 2 de cada um dos 4 grupos = 8 no mata-mata
    await page.getByTestId('stage-card-0').getByRole('button', { name: /Fase 1: Fase de grupos/ }).click();
    const groups = page.getByTestId('stage-card-0');
    await expect(groups.getByLabel('Número de grupos')).toHaveValue('4');
    await groups.getByLabel('Quantos avançam de cada grupo').fill('2');
    await expect(groups).toContainText('avançam 8');
    await expect(page.getByText('3 fases · configuração válida para as vagas do campeonato.')).toBeVisible();
    await continuar(page).click();

    // Pontuação: um bloco por fase, com o modelo padrão do jogo e a prévia
    await expect(stepTitle(page)).toHaveText('Pontuação');
    await expect(page.getByLabel('Modelo de pontuação')).toHaveCount(3);
    await expect(page.getByTestId('scoring-example').first()).toBeVisible();
    await continuar(page).click();

    await expect(stepTitle(page)).toHaveText('Regras');
    await expect(page.getByRole('textbox', { name: 'Regulamento' })).toContainText('Regras gerais');
    await continuar(page).click();

    // Revisão e publicar
    await expect(stepTitle(page)).toHaveText('Revisão e publicar');
    await expect(page.getByText('Tudo pronto. Confira o resumo e publique quando quiser.')).toBeVisible();
    await page.getByRole('button', { name: 'Publicar campeonato' }).click();
    await expect(page).toHaveURL(new RegExp(`/organizador/campeonatos/${id}$`));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Inscrições abertas').first()).toBeVisible();

    // O campeonato está publicado, com as 3 fases do PRD §10.4
    const detail = await api<{ status: string; slug: string; stages: { format: string; qualification: { type: string; n: number } | null }[] }>(page, `/tournaments/${id}`);
    expect(detail.data.status).toBe('REGISTRATION_OPEN');
    expect(detail.data.stages.map((s) => s.format)).toEqual(['GROUPS', 'TEAM_VS_TEAM', 'BATTLE_ROYALE']);
    expect(detail.data.stages.map((s) => s.qualification?.n ?? null)).toEqual([2, 2, null]);
    const listed = await api<{ items: { id: string }[] }>(page, `/tournaments?q=${encodeURIComponent(name)}`);
    expect(listed.data.items.map((t) => t.id)).toContain(id);

    // E aparece na vitrine e na página pública, quando essas rotas existem (são de outra frente)
    const showcase = await page.goto(`/campeonatos?q=${encodeURIComponent(name)}`);
    if (showcase && showcase.status() < 400) await expect(page.getByText(name).first()).toBeVisible();
    const publicPage = await page.goto(`/c/${detail.data.slug}`);
    if (publicPage && publicPage.status() < 400) await expect(page.getByRole('heading', { name }).first()).toBeVisible();
  });

  test('personalizar a pontuação de uma fase cria um modelo só do organizador', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/novo');
    await page.getByRole('button', { name: 'Usar o modelo CR 1v1 — Mata-mata MD3' }).click();
    await page.getByLabel('Nome do campeonato').fill('Copa Personalizada');
    await continuar(page).click();
    const id = await draftId(page);
    await continuar(page).click();
    await continuar(page).click();
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Pontuação');
    await expect(page.getByLabel('Modelo de pontuação')).toHaveValue('sm_cr_padrao');

    await page.getByRole('button', { name: 'Personalizar pontuação' }).click();
    const dialog = page.getByRole('dialog', { name: 'Personalizar pontuação' });
    await dialog.getByRole('button', { name: 'Salvar pontuação' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Modelo de pontuação')).not.toHaveValue('sm_cr_padrao');
    await expect(page.getByLabel('Modelo de pontuação').locator('option:checked')).toContainText('(personalizado)');
    await expect(page.getByRole('button', { name: 'Editar pontuação personalizada' })).toBeVisible();

    await expect(page.getByTestId('save-indicator')).toContainText(/Salvo às/);
    const detail = await api<{ stages: { scoringModelId: string }[] }>(page, `/tournaments/${id}`);
    const modelId = detail.data.stages[0]?.scoringModelId;
    const games = await api<{ id: string; scoringModels: { id: string; ownerId: string | null; matchType: string }[] }[]>(page, '/games');
    const model = games.data.find((g) => g.id === 'g_clashroyale')?.scoringModels.find((m) => m.id === modelId);
    expect(model).toMatchObject({ ownerId: 'u_camila', matchType: 'DUEL' });
  });

  test('banner: recusa arquivo que não é imagem e mostra a prévia de uma imagem válida', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await startBlank(page, 'Copa com Banner');
    await page.getByTestId('banner-input').setInputFiles({ name: 'regras.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByText('Escolha uma imagem PNG, JPG ou WebP.')).toBeVisible();

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('banner-input').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('img', { name: 'Prévia do banner do campeonato' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remover banner' })).toBeVisible();

    // Link de transmissão fora da Twitch e do YouTube é apontado no campo
    await page.getByRole('button', { name: 'Adicionar link' }).click();
    await page.getByRole('textbox', { name: 'Link de transmissão 1' }).fill('https://exemplo.com/ao-vivo');
    await expect(page.getByText('Só aceitamos links da Twitch e do YouTube').first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Link de transmissão 1' }).fill('https://www.twitch.tv/novaarena');
    await expect(page.getByText('Só aceitamos links da Twitch e do YouTube')).toHaveCount(0);

    const id = await draftId(page);
    await expect(page.getByTestId('save-indicator')).toContainText(/Salvo às/);
    const detail = await api<{ bannerUrl: string | null; streamUrls: string[] }>(page, `/tournaments/${id}`);
    expect(detail.data.bannerUrl).toMatch(/^data:image\//);
    expect(detail.data.streamUrls).toEqual(['https://www.twitch.tv/novaarena']);
  });

  test('fechar o assistente no passo 4 e voltar retoma o rascunho', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const name = 'Rascunho Retomado';
    await startBlank(page, name);
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Jogo e modo');
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Inscrições');
    await page.getByLabel(/Número de vagas/).fill('24');
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Fases');
    await expect(page.getByTestId('stage-card-0')).toBeVisible();
    await expect(page.getByTestId('save-indicator')).toContainText(/Salvo às \d{1,2}h/);

    await page.getByRole('button', { name: 'Salvar e sair' }).click();
    await expect(page).toHaveURL(/\/organizador\/campeonatos$/);
    await page.getByRole('link', { name: `Continuar rascunho de ${name}` }).click();

    await expect(stepTitle(page)).toHaveText('Fases');
    await expect(page.getByTestId('stage-card-0')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page.getByLabel(/Número de vagas/)).toHaveValue('24');
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page.getByLabel('Nome do campeonato')).toHaveValue(name);
  });

  test('criar a partir do modelo "FF Squad — Grupos + Final BR" preenche as fases', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/novo');
    await page.getByRole('button', { name: 'Usar o modelo FF Squad — Grupos + Final BR' }).click();
    await expect(stepTitle(page)).toHaveText('Informações');
    await page.getByLabel('Nome do campeonato').fill('Copa do Modelo');
    await continuar(page).click();
    await expect(page.getByRole('radio', { name: /^Squad/ })).toBeChecked();
    await continuar(page).click();
    await expect(page.getByLabel(/Número de vagas/)).toHaveValue('48');
    await continuar(page).click();

    await expect(stepTitle(page)).toHaveText('Fases');
    await expect(page.getByTestId('stage-card-0')).toContainText('Fase de grupos');
    await expect(page.getByTestId('stage-card-1')).toContainText('Mata-mata 4v4');
    await expect(page.getByTestId('stage-card-2')).toContainText('Grande Final');
    await expect(page.getByText('3 fases · configuração válida para as vagas do campeonato.')).toBeVisible();
    await continuar(page).click();
    await continuar(page).click();
    await expect(page.getByRole('textbox', { name: 'Regulamento' })).toContainText('Regras gerais');
    await continuar(page).click();
    await expect(page.getByText('Tudo pronto. Confira o resumo e publique quando quiser.')).toBeVisible();
  });

  test('reordena fases e critérios de desempate arrastando pelo teclado e pelos botões', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/novo');
    await page.getByRole('button', { name: 'Usar o modelo FF Squad — Grupos + Final BR' }).click();
    await page.getByLabel('Nome do campeonato').fill('Copa Reordenada');
    await continuar(page).click();
    await continuar(page).click();
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Fases');

    // Arrastar e soltar (dnd-kit) pelo teclado: Espaço pega, seta move, Espaço solta.
    // No celular não há teclado: lá o caminho é o botão "mover para cima", a alternativa ao arrasto.
    if (test.info().project.name.startsWith('mobile')) {
      await page.getByRole('button', { name: 'Mover a fase Grande Final para cima' }).click();
    } else {
      const handle = page.getByRole('button', { name: 'Arrastar a fase Grande Final para reordenar' });
      await handle.focus();
      await page.keyboard.press('Space');
      await expect(handle).toHaveAttribute('aria-pressed', 'true');
      // Cada passo do arrasto é anunciado para leitores de tela. (A primeira seta pode só rolar a tela até o item.)
      await expect(async () => {
        await page.keyboard.press('ArrowUp');
        await expect(page.getByText('Grande Final foi para a posição 2 de 3.')).toBeAttached({ timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Space');
    }
    await expect(page.getByTestId('stage-card-1')).toContainText('Grande Final');
    await expect(page.getByTestId('stage-card-2')).toContainText('Mata-mata 4v4');
    // A fase que deixou de ser a última ganha regra de classificação; a nova última perde a dela
    await expect(page.getByTestId('stage-card-1')).toContainText('avançam 8');
    await expect(page.getByTestId('stage-card-2')).not.toContainText('avançam');

    // Desfaz: no desktop arrastando com o mouse; no celular, pelo botão
    if (test.info().project.name.startsWith('mobile')) {
      await page.getByRole('button', { name: 'Mover a fase Grande Final para baixo' }).click();
    } else {
      const from = await page.getByRole('button', { name: 'Arrastar a fase Grande Final para reordenar' }).boundingBox();
      const to = await page.getByTestId('stage-card-2').boundingBox();
      if (!from || !to) throw new Error('fases fora da tela');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 });
      await page.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 12 });
      await page.mouse.up();
    }
    await expect(page.getByTestId('stage-card-2')).toContainText('Grande Final');
    await expect(page.getByText('3 fases · configuração válida para as vagas do campeonato.')).toBeVisible();
    // Logo depois de soltar o arrasto com o mouse, a biblioteca de arrastar ignora cliques por um instante
    // (para o "soltar" não virar clique). Uma pessoa não clica tão rápido; o teste tenta de novo.
    await expect(async () => {
      if ((await page.getByTestId('stage-card-2').textContent())?.includes('(cópia)')) return;
      await page.getByRole('button', { name: 'Duplicar a fase Mata-mata 4v4', exact: true }).click();
      await expect(page.getByTestId('stage-card-2')).toContainText('Mata-mata 4v4 (cópia)', { timeout: 1500 });
    }).toPass();
    await page.getByRole('button', { name: 'Remover a fase Mata-mata 4v4 (cópia)' }).click();
    await page.getByRole('dialog', { name: 'Remover esta fase?' }).getByRole('button', { name: 'Remover fase' }).click();
    await expect(page.getByTestId('stage-card-2')).toContainText('Grande Final');
    await expect(page.getByTestId('stage-card-3')).toHaveCount(0);

    // Critérios de desempate: botões e arrastar pelo teclado
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Pontuação');
    const first = page.getByRole('list', { name: 'Critérios de desempate de Fase de grupos, em ordem' });
    await expect(first.getByRole('listitem').first()).toContainText('Pontos totais');
    await first.getByRole('button', { name: 'Mover Pontos totais para baixo' }).click();
    await expect(first.getByRole('listitem').nth(1)).toContainText('Pontos totais');
    if (test.info().project.name.startsWith('mobile')) {
      await first.getByRole('button', { name: 'Mover Pontos totais para cima' }).click();
    } else {
      const grip = first.getByRole('button', { name: 'Arrastar o critério Pontos totais' });
      await grip.focus();
      await page.keyboard.press('Space');
      await expect(grip).toHaveAttribute('aria-pressed', 'true');
      await expect(async () => {
        await page.keyboard.press('ArrowUp');
        await expect(page.getByText('Pontos totais foi para a posição 1 de', { exact: false })).toBeAttached({ timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Space');
    }
    await expect(first.getByRole('listitem').first()).toContainText('Pontos totais');
  });

  test('configuração inválida entre fases é apontada antes de publicar', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/novo');
    await page.getByRole('button', { name: 'Usar o modelo FF Squad — Grupos + Final BR' }).click();
    await page.getByLabel('Nome do campeonato').fill('Copa Inválida');
    await continuar(page).click();
    const id = await draftId(page);
    await continuar(page).click();
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Fases');

    // 48 squads em 2 grupos = 24 por grupo, mas a sala comporta 12
    const groups = page.getByTestId('stage-card-0');
    await groups.getByLabel('Número de grupos').fill('2');
    await expect(groups).toContainText('1 pendência');
    await expect(groups.getByText(/cada grupo teria até 24 equipes, mas a sala comporta 12/)).toBeVisible();

    // Não dá para seguir: o resumo do passo aponta a fase e o motivo
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Fases');
    await expect(page.getByTestId('step-issues')).toContainText('Fase de grupos: Com as 48 vagas do campeonato em 2 grupos');

    // A API também recusa publicar
    await expect(page.getByTestId('save-indicator')).toContainText(/Salvo às/);
    const publish = await api<{ code: string }>(page, `/tournaments/${id}/publish`, { method: 'POST' });
    expect(publish.status).toBe(400);
    expect(publish.data.code).toBe('INCOMPLETE');

    // Corrigido, segue em frente
    await groups.getByLabel('Número de grupos').fill('4');
    await expect(page.getByText('3 fases · configuração válida para as vagas do campeonato.')).toBeVisible();
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Pontuação');
  });
});

test.describe('organizador — permissões', () => {
  test('organizadora A não edita o campeonato do B (403 tratado na tela)', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos/tn_contra_squad/editar');
    await expect(page.getByRole('heading', { name: 'Este campeonato é de outra organização' })).toBeVisible();
    await page.goto('/organizador/campeonatos/tn_contra_squad');
    await expect(page.getByRole('heading', { name: 'Este campeonato é de outra organização' })).toBeVisible();

    const patch = await api(page, '/tournaments/tn_contra_squad', { method: 'PATCH', body: { name: 'Invadido' } });
    expect(patch.status).toBe(403);
    const cancel = await api(page, '/tournaments/tn_contra_squad/cancel', { method: 'POST', body: { reason: 'Porque sim' } });
    expect(cancel.status).toBe(403);
    const review = await api(page, '/registrations/r_1', { method: 'PATCH', body: { action: 'approve' } });
    expect([200, 409]).toContain(review.status); // r_1 é da Copa Nova FF, que é da própria Camila
    const csv = await api(page, '/tournaments/tn_contra_squad/registrations.csv');
    expect(csv.status).toBe(403);
  });

  test('participante sem papel de organizador em /organizador vê a página 403', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/organizador');
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
    const create = await api(page, '/tournaments', { method: 'POST', body: { name: 'Sem permissão' } });
    expect(create.status).toBe(403);
  });
});

test.describe('organizador — inscrições', () => {
  test('aprova a inscrição que aguardava na Arena Contra Squad 4v4', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_contra_squad?aba=inscricoes');
    await expect(registrationRow(page, 'Squad Puma')).toContainText('Aguardando aprovação');
    await page.getByRole('button', { name: 'Aprovar Squad Puma' }).click();
    await expect(page.getByText('Squad Puma aprovado')).toBeVisible();
    await expect(registrationRow(page, 'Squad Puma')).toContainText('Confirmada');
    await expect(page.getByRole('button', { name: 'Aprovar Squad Puma' })).toHaveCount(0);
  });

  test('aprova em lote as inscrições selecionadas', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_contra_squad?aba=inscricoes');
    await registrationRow(page, 'Squad Puma').getByRole('checkbox').check();
    await registrationRow(page, 'Squad Alfa').getByRole('checkbox').check();
    await expect(page.getByText('2 selecionados')).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar 1 selecionada' }).click();
    await expect(page.getByText('1 inscrição aprovada')).toBeVisible();
    await expect(registrationRow(page, 'Squad Puma')).toContainText('Confirmada');
  });

  test('recusar exige motivo', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_contra_squad?aba=inscricoes');
    await page.getByRole('button', { name: 'Recusar Squad Puma' }).click();
    const dialog = page.getByRole('dialog', { name: 'Recusar Squad Puma?' });
    await dialog.getByRole('button', { name: 'Recusar inscrição' }).click();
    await expect(dialog.getByText('Informe o motivo (pelo menos 3 letras)')).toBeVisible();
    await dialog.getByLabel('Motivo').fill('Squad com jogador banido.');
    await dialog.getByRole('button', { name: 'Recusar inscrição' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(registrationRow(page, 'Squad Puma')).toContainText('Recusada');
    await expect(registrationRow(page, 'Squad Puma')).toContainText('Squad com jogador banido.');
  });

  test('remover um inscrito da Copa eFootball Iniciantes promove o primeiro da lista de espera', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_efootball?aba=inscricoes');
    const waitlist = page.getByRole('list', { name: 'Lista de espera, em ordem' });
    await expect(waitlist.getByRole('listitem')).toHaveCount(2);
    await expect(waitlist.getByRole('listitem').first()).toContainText('ManuBR38');

    await page.getByRole('button', { name: 'Remover NinaFF30' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remover NinaFF30?' });
    await dialog.getByLabel('Motivo').fill('Pediu para sair.');
    await dialog.getByRole('button', { name: 'Remover inscrição' }).click();

    await expect(page.getByText('ManuBR38 saiu da lista de espera e ficou com a vaga.')).toBeVisible();
    await expect(registrationRow(page, 'ManuBR38')).toContainText('Confirmada');
    await expect(registrationRow(page, 'NinaFF30')).toContainText('Removida');
    await expect(waitlist.getByRole('listitem')).toHaveCount(1);
    await expect(waitlist.getByRole('listitem').first()).toContainText('EnzoX39');
  });

  test('importar CSV com uma linha inválida mostra a linha e o motivo', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_contra_squad?aba=inscricoes');
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar inscritos por CSV' });
    await expect(dialog.getByRole('button', { name: 'Baixar modelo de CSV' })).toBeVisible();

    const csv = ['nome;tag;contato', 'Squad Importado;IMPO;imp@exemplo.com', ';SEMN;', 'Squad Planilha;PLAN;'].join('\r\n');
    await dialog.getByTestId('csv-input').setInputFiles({ name: 'inscritos.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${csv}`, 'utf8') });

    await expect(dialog.getByText(/2 linhas prontas para importar e 1 com erro/)).toBeVisible();
    const bad = dialog.getByTestId('csv-line-3');
    await expect(bad).toContainText('3');
    await expect(bad).toContainText('Falta o nome.');
    await expect(dialog.getByTestId('csv-line-2')).toContainText('Pronta');

    await dialog.getByRole('button', { name: 'Importar 2 inscritos' }).click();
    const result = dialog.getByTestId('import-result');
    await expect(result).toContainText('2');
    await expect(result).toContainText('Inscritos criados');
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await expect(registrationRow(page, 'Squad Importado')).toContainText('Importada');
    await expect(registrationRow(page, 'Squad Planilha')).toContainText('Confirmada');
  });

  test('exportar CSV entrega o arquivo com BOM e ponto e vírgula', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_contra_squad?aba=inscricoes');
    await expect(registrationRow(page, 'Squad Alfa')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('inscritos-arena-contra-squad-4v4.csv');
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toContain('Nome;Tag;Tipo;Status;Membros confirmados');
    expect(text).toContain('Squad Alfa;ALFA;Squad;Confirmada;4/4');
    expect(text).toContain('Squad Puma');
    expect(text).toContain('Aguardando aprovação');
  });
});

test.describe('organizador — regras da API', () => {
  const future = (days: number) => new Date(Date.now() + days * 24 * 3600_000).toISOString();

  test('limite de campeonatos simultâneos é conferido ao publicar (RN-10)', async ({ page }) => {
    // O Diego pode ter 3 ativos e já tem 2 (Copa eFootball e Arena Contra Squad).
    await loginAs(page, 'u_diego');
    const create = (name: string) =>
      api<{ id: string }>(page, '/tournaments', { method: 'POST', body: { templateId: 'tpl_cr_md3', name, registrationClosesAt: future(5), startsAt: future(6) } });

    const third = await create('Terceiro Ativo');
    expect(third.status).toBe(201);
    const publishedThird = await api<{ status: string }>(page, `/tournaments/${third.data.id}/publish`, { method: 'POST' });
    expect(publishedThird.status).toBe(200);
    expect(publishedThird.data.status).toBe('REGISTRATION_OPEN');

    // Criar o rascunho continua liberado; publicar é que esbarra no limite.
    const fourth = await create('Quarto Ativo');
    expect(fourth.status).toBe(201);
    const blocked = await api<{ code: string; title: string }>(page, `/tournaments/${fourth.data.id}/publish`, { method: 'POST' });
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe('ORGANIZER_LIMIT');
    expect(blocked.data.title).toContain('limite é de 3');

    // E aparece na tela de revisão
    await page.goto(`/organizador/campeonatos/${fourth.data.id}/editar`);
    await expect(stepTitle(page)).toHaveText('Informações');
    for (let i = 0; i < 6; i += 1) await continuar(page).click();
    await page.getByRole('button', { name: 'Publicar campeonato' }).click();
    await expect(page.getByText(/o seu limite é de 3 ao mesmo tempo/)).toBeVisible();
  });

  test('ciclo de vida: só as transições da máquina de estados, e data futura deixa o campeonato só publicado', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const draft = await api<{ id: string; status: string }>(page, '/tournaments', {
      method: 'POST',
      body: { templateId: 'tpl_ef_grupos', name: 'Copa Agendada', registrationOpensAt: future(2), registrationClosesAt: future(5), startsAt: future(6) },
    });
    expect(draft.data.status).toBe('DRAFT');
    const id = draft.data.id;

    // Rascunho não abre nem fecha inscrições
    expect((await api(page, `/tournaments/${id}/open-registration`, { method: 'POST' })).status).toBe(409);
    expect((await api(page, `/tournaments/${id}/close-registration`, { method: 'POST' })).status).toBe(409);

    const published = await api<{ status: string }>(page, `/tournaments/${id}/publish`, { method: 'POST' });
    expect(published.data.status).toBe('PUBLISHED');
    expect((await api(page, `/tournaments/${id}/publish`, { method: 'POST' })).status).toBe(409);
    expect((await api(page, `/tournaments/${id}`, { method: 'DELETE' })).status).toBe(409);
    expect((await api(page, `/tournaments/${id}/close-registration`, { method: 'POST' })).status).toBe(409);
    expect((await api(page, `/tournaments/${id}`, { method: 'PATCH', body: { gameId: 'g_8ball' } })).status).toBe(409);

    // Na tela, só aparecem as ações que valem para "Publicado"
    await page.goto(`/organizador/campeonatos/${id}`);
    const actions = page.getByRole('group', { name: 'Ações do campeonato' });
    await expect(actions.getByRole('button', { name: 'Abrir inscrições agora' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Cancelar campeonato' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Encerrar inscrições' })).toHaveCount(0);
    await actions.getByRole('button', { name: 'Abrir inscrições agora' }).click();
    await expect(actions.getByRole('button', { name: 'Encerrar inscrições' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Abrir inscrições agora' })).toHaveCount(0);
    await actions.getByRole('button', { name: 'Encerrar inscrições' }).click();
    await expect(page.getByText('Inscrições encerradas').first()).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Encerrar inscrições' })).toHaveCount(0);

    // Cancelar exige motivo; cancelado não volta
    expect((await api(page, `/tournaments/${id}/cancel`, { method: 'POST', body: { reason: '' } })).status).toBe(400);
    expect((await api(page, `/tournaments/${id}/cancel`, { method: 'POST', body: { reason: 'Mudança de planos.' } })).status).toBe(200);
    expect((await api(page, `/tournaments/${id}/open-registration`, { method: 'POST' })).status).toBe(409);
    expect((await api(page, `/tournaments/${id}`, { method: 'PATCH', body: { name: 'Voltou' } })).status).toBe(409);
  });

  test('o HTML do organizador é limpo pela API antes de gravar', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const saved = await api<{ description: string; rules: string; prize: string }>(page, '/tournaments/tn_cr_2v2', {
      method: 'PATCH',
      body: {
        description: '<p onclick="alert(1)">Oi<script>alert(1)</script></p><img src=x onerror=alert(1)>',
        rules: '<h2>Regras</h2><a href="javascript:alert(1)">clique</a> <a href="https://novaarena.gg">site</a>',
        prize: '<b>R$ 100</b><iframe src="https://exemplo.com"></iframe>',
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.description).toBe('<p>Oi</p>');
    expect(saved.data.rules).toBe('<h2>Regras</h2>clique <a href="https://novaarena.gg" target="_blank" rel="noopener noreferrer nofollow">site</a>');
    expect(saved.data.prize).toBe('<b>R$ 100</b>');
    const badLink = await api<{ errors: Record<string, string> }>(page, '/tournaments/tn_cr_2v2', { method: 'PATCH', body: { streamUrls: ['https://exemplo.com/live'] } });
    expect(badLink.status).toBe(400);
    expect(badLink.data.errors['streamUrls.0']).toContain('Twitch');
  });

  test('campeonato publicado: a edição só é barrada pelo que ela mesma toca', async ({ page }) => {
    // A administração tira o eFootball do catálogo…
    await loginAs(page, 'u_ana');
    const off = await api(page, '/admin/games/g_efootball', { method: 'PATCH', body: { active: false } });
    expect(off.status).toBe(200);

    // …e a organização ainda consegue ajustar a página do campeonato que já estava publicado
    await loginAs(page, 'u_diego');
    const prize = await api<{ prize: string }>(page, '/tournaments/tn_efootball', { method: 'PATCH', body: { prize: 'Medalha no perfil.' } });
    expect(prize.status).toBe(200);
    expect(prize.data.prize).toBe('Medalha no perfil.');

    // Mas o que a edição toca continua sendo conferido: vagas abaixo das ocupadas, fases que deixam de fechar
    const fewer = await api<{ errors: Record<string, string> }>(page, '/tournaments/tn_efootball', { method: 'PATCH', body: { maxParticipants: 4 } });
    expect(fewer.status).toBe(400);
    expect(fewer.data.errors.maxParticipants).toContain('8 vagas ocupadas');
    const noRules = await api<{ errors: Record<string, string> }>(page, '/tournaments/tn_efootball', { method: 'PATCH', body: { rules: '<p></p>' } });
    expect(noRules.status).toBe(400);
    expect(noRules.data.errors.rules).toContain('regulamento');
    // Um rascunho novo desse jogo não publica
    const draft = await api<{ id: string }>(page, '/tournaments', { method: 'POST', body: { templateId: 'tpl_ef_grupos', name: 'Copa Fora do Catálogo', registrationClosesAt: future(5), startsAt: future(6) } });
    const publish = await api<{ code: string; errors: Record<string, string> }>(page, `/tournaments/${draft.data.id}/publish`, { method: 'POST' });
    expect(publish.status).toBe(400);
    expect(publish.data.errors.gameId).toContain('não está mais disponível');
  });

  test('fase que já começou não pode ser alterada', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const current = await api<{ stages: { id: string; name: string; format: string; scoringModelId: string; config: Record<string, unknown>; qualification: null; tiebreakers: string[]; seeding: string }[] }>(page, '/tournaments/tn_liga_cr');
    const stage = current.data.stages[0];
    expect(stage).toBeTruthy();
    const changed = await api<{ code: string }>(page, '/tournaments/tn_liga_cr', { method: 'PATCH', body: { stages: [{ ...stage, config: { ...stage?.config, bestOf: 5 } }] } });
    expect(changed.status).toBe(409);
    expect(changed.data.code).toBe('STAGE_LOCKED');
    const removed = await api<{ code: string }>(page, '/tournaments/tn_liga_cr', { method: 'PATCH', body: { stages: [] } });
    expect(removed.data.code).toBe('STAGE_LOCKED');
    // A página pública continua editável
    const page_ = await api(page, '/tournaments/tn_liga_cr', { method: 'PATCH', body: { prize: 'Troféu digital.' } });
    expect(page_.status).toBe(200);
  });
});

test.describe('organizador — painel, lista e modelos', () => {
  test('substituir um inscrito por alguém da lista de espera', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos/tn_efootball?aba=inscricoes');
    await page.getByRole('button', { name: 'Substituir VitorPro31' }).click();
    const dialog = page.getByRole('dialog', { name: 'Substituir VitorPro31' });
    await dialog.getByLabel('Quem entra no lugar').selectOption({ label: '2º da fila · EnzoX39' });
    await dialog.getByRole('button', { name: 'Substituir', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(registrationRow(page, 'EnzoX39').filter({ hasNotText: 'VitorPro31' })).toContainText('Confirmada');
    await expect(registrationRow(page, 'VitorPro31')).toContainText('Substituída por EnzoX39.');
    // Quem estava em 1º continua na fila: a vaga foi para quem a organização escolheu
    await expect(page.getByRole('list', { name: 'Lista de espera, em ordem' }).getByRole('listitem')).toContainText(['ManuBR38']);
  });

  test('edita a página pública de um campeonato publicado', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos/tn_copa_ff?aba=pagina');
    await expect(page.getByRole('button', { name: 'Salvar página' })).toBeDisabled();
    await page.getByLabel('Premiação').fill('1º lugar: troféu e destaque na home.');
    await page.getByRole('textbox', { name: 'Regulamento' }).fill('Novo regulamento da copa.');
    await page.getByRole('button', { name: 'Salvar página' }).click();
    await expect(page.getByText('Página atualizada')).toBeVisible();
    const detail = await api<{ prize: string; rules: string; status: string }>(page, '/tournaments/tn_copa_ff');
    expect(detail.data.prize).toBe('1º lugar: troféu e destaque na home.');
    expect(detail.data.rules).toContain('Novo regulamento da copa.');
    expect(detail.data.rules).not.toContain('Respeite os horários');
    expect(detail.data.status).toBe('REGISTRATION_OPEN');
  });

  test('edita um campeonato já publicado pelo assistente (sem rascunho automático)', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos/tn_ff_solo/editar');
    await expect(page.getByRole('heading', { level: 1, name: 'Editar campeonato' })).toBeVisible();
    await page.getByLabel('Nome do campeonato').fill('FF Solo Rush — Edição 2');
    await expect(page.getByTestId('save-indicator')).toContainText('Alterações ainda não salvas');
    await continuar(page).click();
    // Jogo e modo ficam travados depois de publicar
    await expect(page.getByRole('radio', { name: /Free Fire/ })).toBeDisabled();
    for (let i = 0; i < 5; i += 1) await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Revisão e publicar');
    const before = await api<{ name: string }>(page, '/tournaments/tn_ff_solo');
    expect(before.data.name).toBe('FF Solo Rush');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page).toHaveURL(/\/organizador\/campeonatos\/tn_ff_solo$/);
    await expect(page.getByRole('heading', { level: 1, name: 'FF Solo Rush — Edição 2' })).toBeVisible();
    const after = await api<{ name: string; slug: string; status: string }>(page, '/tournaments/tn_ff_solo');
    expect(after.data).toMatchObject({ name: 'FF Solo Rush — Edição 2', slug: 'ff-solo-rush', status: 'PUBLISHED' });
  });


  test('cancelar campeonato exige digitar o nome e informar o motivo', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador/campeonatos');
    await page.getByRole('tab', { name: /^Ativos/ }).click();
    await page.getByRole('button', { name: 'Cancelar Arena Contra Squad 4v4' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar campeonato' });
    const confirm = dialog.getByRole('button', { name: 'Cancelar campeonato' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Para confirmar, digite/).fill('Arena Contra');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Para confirmar, digite/).fill('Arena Contra Squad 4v4');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByText('Informe o motivo do cancelamento.')).toBeVisible();
    await dialog.getByLabel('Motivo do cancelamento').fill('Poucos inscritos nesta edição.');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Campeonato cancelado').first()).toBeVisible();

    await page.getByRole('tab', { name: /^Cancelados \(2\)/ }).click();
    await expect(page.getByTestId('tournament-tn_contra_squad')).toContainText('Cancelado');
    const detail = await api<{ status: string }>(page, '/tournaments/tn_contra_squad');
    expect(detail.data.status).toBe('CANCELLED');
  });

  test('quem ainda não tem campeonato vê o convite para criar o primeiro', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/organizador');
    await expect(page.getByRole('heading', { name: 'Seu primeiro campeonato começa aqui' })).toBeVisible();
    await page.getByRole('link', { name: 'Criar meu primeiro campeonato' }).click();
    await expect(page.getByRole('button', { name: 'Começar do zero' })).toBeVisible();
  });

  test('o painel resume os campeonatos e a lista filtra por status', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador');
    await expect(page.getByRole('heading', { level: 1, name: 'Meu painel' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inscrições para aprovar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Revisar inscrições de Arena Contra Squad 4v4' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Próximos eventos' })).toBeVisible();

    await page.goto('/organizador/campeonatos');
    await expect(page.getByRole('tab', { name: 'Todos (4)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Encerrados (1)' }).click();
    await expect(page.getByTestId('tournament-tn_open_8ball')).toBeVisible();
    await expect(page.getByTestId('tournament-tn_efootball')).toHaveCount(0);
  });

  test('salva um campeonato como modelo, usa e exclui o modelo', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos');
    await page.getByRole('button', { name: 'Salvar Copa Nova FF — Squad como modelo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Salvar como modelo' });
    await dialog.getByLabel('Nome do modelo').fill('Meu formato de copa');
    await dialog.getByRole('button', { name: 'Salvar modelo' }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto('/organizador/modelos');
    await expect(page.getByRole('heading', { name: 'Meu formato de copa' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'FF Squad — Grupos + Final BR' })).toBeVisible();
    await page.getByRole('link', { name: 'Usar o modelo Meu formato de copa' }).click();
    await expect(stepTitle(page)).toHaveText('Informações');
    await expect(page.getByText('A partir do modelo "Meu formato de copa"')).toBeVisible();

    await page.goto('/organizador/modelos');
    await page.getByRole('button', { name: 'Excluir o modelo Meu formato de copa' }).click();
    await page.getByRole('dialog', { name: 'Excluir este modelo?' }).getByRole('button', { name: 'Excluir modelo' }).click();
    await expect(page.getByRole('heading', { name: 'Meu formato de copa' })).toHaveCount(0);
    // Os modelos da plataforma não têm botão de excluir
    await expect(page.getByRole('button', { name: /Excluir o modelo FF Squad/ })).toHaveCount(0);
  });

  test('duplica um campeonato e exclui o rascunho', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos');
    await page.getByRole('button', { name: 'Duplicar FF Solo Rush' }).click();
    await expect(stepTitle(page)).toHaveText('Informações');
    await expect(page.getByLabel('Nome do campeonato')).toHaveValue('Cópia de FF Solo Rush');

    await page.goto('/organizador/campeonatos');
    await page.getByRole('tab', { name: /^Rascunhos/ }).click();
    await page.getByRole('button', { name: 'Excluir rascunho Cópia de FF Solo Rush' }).click();
    await page.getByRole('dialog', { name: 'Excluir este rascunho?' }).getByRole('button', { name: 'Excluir rascunho' }).click();
    await expect(page.getByText('Rascunho excluído')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excluir rascunho Cópia de FF Solo Rush' })).toHaveCount(0);
  });

  test('as telas do organizador não têm rolagem horizontal', async ({ page }) => {
    await loginAs(page, 'u_diego');
    for (const path of ['/organizador', '/organizador/campeonatos', '/organizador/modelos', '/organizador/campeonatos/tn_contra_squad?aba=inscricoes', '/organizador/campeonatos/tn_efootball/editar']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
    }
  });
});
