import type { Locator, Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';

const FF_DEFAULT_MODEL = 'Free Fire · Padrão (kill 1, Booyah 3)';

/** Linha do jogo no catálogo: linha de tabela no desktop, cartão no celular (o `DataTable` troca em 768 px). */
function gameRow(page: Page, name: string): Locator {
  return page.getByRole('row').or(page.getByRole('listitem')).filter({ hasText: name });
}

function modelCard(page: Page, name: string): Locator {
  return page.getByTestId('scoring-model-card').filter({ hasText: name });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Fecha os avisos (toasts) abertos. No celular eles ficam por alguns segundos em cima do rodapé
 * dos modais de tela cheia, e o clique seguinte só passaria depois que sumissem sozinhos.
 */
async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Fechar aviso' });
  while ((await close.count()) > 0) {
    await close
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
}

async function publicGameSlugs(page: Page): Promise<string[]> {
  // Logo depois de navegar a API simulada ainda pode estar iniciando: sem esperar, a chamada cai no servidor e volta HTML.
  await waitForApp(page);
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/games');
    const games = (await res.json()) as Array<{ slug: string }>;
    return games.map((g) => g.slug);
  });
}

test.describe('Admin · catálogo de jogos', () => {
  test('lista os jogos com modos, modelos e situação, e a busca filtra', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos');
    await expect(page.getByRole('heading', { level: 1, name: 'Jogos e regras' })).toBeVisible();

    for (const name of ['Free Fire', 'Clash Royale', '8 Ball Pool', 'eFootball']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    const freeFire = gameRow(page, 'Free Fire');
    await expect(freeFire).toContainText('Solo, Duo, Squad, Contra Squad 4v4');
    await expect(freeFire).toContainText('Mobile');
    await expect(freeFire).toContainText('Ativo');
    await expectNoHorizontalScroll(page);

    await page.getByRole('searchbox', { name: 'Buscar jogo' }).fill('clash');
    await expect(page.getByRole('link', { name: 'Clash Royale', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Free Fire', exact: true })).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Buscar jogo' }).fill('xadrez');
    await expect(page.getByRole('heading', { name: 'Nenhum jogo encontrado' })).toBeVisible();
    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(page.getByRole('link', { name: 'Free Fire', exact: true })).toBeVisible();
  });

  test('cadastra um jogo com dois modos e um modelo de pontuação, e ele aparece no catálogo', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos');
    await page.getByRole('link', { name: 'Novo jogo' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Novo jogo' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Brawl Stars');
    // O endereço é gerado a partir do nome.
    await expect(page.getByRole('textbox', { name: 'Endereço (slug)' })).toHaveValue('brawl-stars');
    await page.getByRole('textbox', { name: 'Ícone' }).fill('BS');

    const mode1 = page.getByRole('group', { name: 'Modo 1' });
    await mode1.getByRole('textbox', { name: 'Nome do modo' }).fill('Solo');
    await mode1.getByRole('spinbutton', { name: 'Tamanho máximo da sala' }).fill('10');

    await page.getByRole('button', { name: 'Adicionar modo' }).click();
    const mode2 = page.getByRole('group', { name: 'Modo 2' });
    await mode2.getByRole('textbox', { name: 'Nome do modo' }).fill('Trio 3v3');
    await mode2.getByRole('combobox', { name: 'Tipo de partida' }).selectOption({ label: 'Equipe x Equipe' });
    await mode2.getByRole('spinbutton', { name: 'Tamanho da equipe' }).fill('3');
    await mode2.getByRole('spinbutton', { name: 'Reservas' }).fill('1');
    // Sala máxima só existe no Battle Royale.
    await expect(mode2.getByRole('spinbutton', { name: 'Tamanho máximo da sala' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Adicionar campo' }).click();
    const idField = page.getByRole('group', { name: 'Campo de ID 1' });
    await idField.getByRole('textbox', { name: 'Chave' }).fill('playerTag');
    await idField.getByRole('textbox', { name: 'Rótulo' }).fill('Tag do jogador');
    // Expressão regular que não compila é barrada no campo.
    await idField.getByRole('textbox', { name: 'Padrão de validação' }).fill('^[0-9A-Z');
    await page.getByRole('button', { name: 'Cadastrar jogo' }).click();
    await expect(idField.getByText('Esta expressão regular não é válida')).toBeVisible();
    await idField.getByRole('textbox', { name: 'Padrão de validação' }).fill('^[0-9A-Z]{3,12}$');
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Cadastrar jogo' }).click();
    await expect(page).toHaveURL(/\/admin\/jogos\/g_[a-z0-9]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'BS Brawl Stars' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nenhum modelo de pontuação' })).toBeVisible();
    await dismissToasts(page);

    // Modelo de pontuação: nasce com as regras padrão do tipo de partida do primeiro modo (Battle Royale).
    await page.getByRole('button', { name: 'Criar o primeiro modelo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo modelo de pontuação' });
    await dialog.getByRole('textbox', { name: 'Nome do modelo' }).fill('Brawl · Padrão');
    await expect(dialog.getByTestId('scoring-example')).toHaveText('7 kills + 1º lugar = 10 pts');
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: 'Salvar modelo' }).click();
    await expect(dialog).toHaveCount(0);

    const card = modelCard(page, 'Brawl · Padrão');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Battle Royale');
    await expect(card).toContainText('Padrão');
    await expect(card).toContainText('1 ponto por kill');
    await expect(card.getByTestId('scoring-example')).toHaveText('7 kills + 1º lugar = 10 pts');

    // O jogo novo está no catálogo do Admin e na lista pública.
    await page.getByRole('link', { name: 'Jogos e regras' }).first().click();
    await expect(page).toHaveURL(/\/admin\/jogos$/);
    const row = gameRow(page, 'Brawl Stars');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Solo, Trio 3v3');
    await expect(row).toContainText('Ativo');
    expect(await publicGameSlugs(page)).toContain('brawl-stars');

    const saved = await page.evaluate(async () => {
      const res = await fetch('/api/v1/games/brawl-stars');
      return (await res.json()) as { modes: Array<{ name: string; teamSize: number; maxSubs: number; matchType: string; maxLobbySize: number | null }>; scoringModels: Array<{ name: string; isDefault: boolean }> };
    });
    expect(saved.modes.map(({ name, teamSize, maxSubs, matchType, maxLobbySize }) => ({ name, teamSize, maxSubs, matchType, maxLobbySize }))).toEqual([
      { name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'BATTLE_ROYALE', maxLobbySize: 10 },
      { name: 'Trio 3v3', teamSize: 3, maxSubs: 1, matchType: 'TEAM_VS_TEAM', maxLobbySize: null },
    ]);
    expect(saved.scoringModels).toEqual([expect.objectContaining({ name: 'Brawl · Padrão', isDefault: true })]);
  });

  test('slug duplicado mostra o erro no campo', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/novo');
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Free Fire');
    await expect(page.getByRole('textbox', { name: 'Endereço (slug)' })).toHaveValue('free-fire');
    await page.getByRole('textbox', { name: 'Ícone' }).fill('FF');
    await page.getByRole('group', { name: 'Modo 1' }).getByRole('textbox', { name: 'Nome do modo' }).fill('Solo');
    await page.getByRole('button', { name: 'Cadastrar jogo' }).click();

    const slug = page.getByRole('textbox', { name: 'Endereço (slug)' });
    await expect(slug).toHaveAttribute('aria-invalid', 'true');
    await expect(slug).toHaveAccessibleDescription('Já existe um jogo com este endereço. Escolha outro.');
    await expect(page).toHaveURL(/\/admin\/jogos\/novo$/);

    // Trocando o endereço, o cadastro passa.
    await slug.fill('free-fire-max');
    await page.getByRole('button', { name: 'Cadastrar jogo' }).click();
    await expect(page).toHaveURL(/\/admin\/jogos\/g_[a-z0-9]+$/);
  });

  test('desativar um jogo tira ele da lista pública, mas não do catálogo do Admin', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos');
    expect(await publicGameSlugs(page)).toContain('8-ball-pool');

    await page.getByRole('switch', { name: '8 Ball Pool: Ativo' }).click();
    const confirm = page.getByRole('dialog', { name: 'Desativar 8 Ball Pool?' });
    await expect(confirm).toContainText('some da criação de campeonatos');
    // Enquanto não confirma, nada muda.
    expect(await publicGameSlugs(page)).toContain('8-ball-pool');
    await confirm.getByRole('button', { name: 'Desativar jogo' }).click();
    await expect(confirm).toHaveCount(0);

    await expect(gameRow(page, '8 Ball Pool')).toContainText('Inativo');
    await expect(page.getByRole('switch', { name: '8 Ball Pool: Ativo' })).not.toBeChecked();

    const slugs = await publicGameSlugs(page);
    expect(slugs).not.toContain('8-ball-pool');
    expect(slugs).toEqual(expect.arrayContaining(['free-fire', 'clash-royale', 'efootball']));

    // Continua no catálogo do Admin, mesmo depois de recarregar.
    await page.reload();
    await expect(page.getByRole('link', { name: '8 Ball Pool', exact: true })).toBeVisible();
    await expect(gameRow(page, '8 Ball Pool')).toContainText('Inativo');

    // Reativar não pede confirmação e devolve o jogo à lista pública.
    await page.getByRole('switch', { name: '8 Ball Pool: Ativo' }).click();
    await expect(page.getByRole('switch', { name: '8 Ball Pool: Ativo' })).toBeChecked();
    expect(await publicGameSlugs(page)).toContain('8-ball-pool');
  });

  test('editar o modelo padrão do Free Fire muda a prévia', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_freefire');
    await expect(page.getByRole('heading', { level: 2, name: 'Modelos de pontuação' })).toBeVisible();

    const card = modelCard(page, FF_DEFAULT_MODEL);
    await expect(card.getByTestId('scoring-example')).toHaveText('7 kills + 1º lugar = 10 pts');
    await expect(card).toContainText('Booyah (1º lugar) vale 3 pontos');

    await card.getByRole('button', { name: `Editar ${FF_DEFAULT_MODEL}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar modelo de pontuação' });
    const example = dialog.getByTestId('scoring-example');
    await expect(example).toHaveText('7 kills + 1º lugar = 10 pts');

    // Kill passa a valer 2: a prévia recalcula na hora.
    await dialog.getByRole('group', { name: /^Regra 1 ·/ }).getByRole('spinbutton', { name: 'Pontos por unidade' }).fill('2');
    await expect(example).toHaveText('7 kills + 1º lugar = 17 pts');
    await expect(dialog.getByRole('group', { name: /^Regra 1 ·/ })).toContainText('2 pontos por kill');

    // O exemplo também é editável: 9 kills em 2º lugar = 18.
    await dialog.getByRole('spinbutton', { name: 'Kills do exemplo' }).fill('9');
    await dialog.getByRole('spinbutton', { name: 'Colocação do exemplo' }).fill('2');
    await expect(example).toHaveText('9 kills + 2º lugar = 18 pts');

    // Reordenar pelo teclado: a regra 1 desce.
    await dialog.getByRole('button', { name: 'Descer regra 1' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('group', { name: /^Regra 2 ·/ })).toContainText('2 pontos por kill');
    await expectNoHorizontalScroll(page);

    await dialog.getByRole('button', { name: 'Salvar modelo' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByTestId('scoring-example')).toHaveText('7 kills + 1º lugar = 17 pts');
    await expect(card).toContainText('2 pontos por kill');
    await expect(card).toContainText('Padrão');
  });

  test('modelo com regra inválida não salva e mostra o erro junto da regra', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_freefire');
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo modelo de pontuação' });

    // Tira as duas regras: não sobra nada que pontue.
    await dialog.getByRole('button', { name: 'Remover regra 2' }).click();
    await dialog.getByRole('button', { name: 'Remover regra 1' }).click();
    await expect(dialog.getByText('Adicione ao menos uma regra de pontuação.')).toBeVisible();

    await dialog.getByRole('button', { name: 'Salvar modelo' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Informe o nome do modelo.')).toBeVisible();
    await expect(page.getByTestId('scoring-model-card')).toHaveCount(3);
  });

  test('duplica um modelo e troca o padrão do tipo de partida', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_freefire');
    const liga = modelCard(page, 'Free Fire · Liga (tabela de colocação)');
    const padrao = modelCard(page, FF_DEFAULT_MODEL);
    const contraSquad = modelCard(page, 'Contra Squad · Vitória 3');
    await expect(padrao.getByText('Padrão', { exact: true })).toBeVisible();
    await expect(liga.getByText('Padrão', { exact: true })).toHaveCount(0);

    await liga.getByRole('button', { name: /^Tornar .* o padrão$/ }).click();
    await expect(liga.getByText('Padrão', { exact: true })).toBeVisible();
    // O padrão anterior do mesmo tipo de partida deixa de ser; o de outro tipo não muda.
    await expect(padrao.getByText('Padrão', { exact: true })).toHaveCount(0);
    await expect(contraSquad.getByText('Padrão', { exact: true })).toBeVisible();

    await dismissToasts(page);
    await padrao.getByRole('button', { name: `Duplicar ${FF_DEFAULT_MODEL}` }).click();
    const copy = modelCard(page, `${FF_DEFAULT_MODEL} (cópia)`);
    await expect(copy).toBeVisible();
    await dismissToasts(page);
    await expect(copy.getByTestId('scoring-example')).toHaveText('7 kills + 1º lugar = 10 pts');
    await expect(copy.getByText('Padrão', { exact: true })).toHaveCount(0);

    // A cópia não é usada por campeonato nenhum: pode ser excluída.
    await copy.getByRole('button', { name: /^Excluir / }).click();
    await page.getByRole('dialog', { name: 'Excluir modelo de pontuação?' }).getByRole('button', { name: 'Excluir modelo' }).click();
    await expect(copy).toHaveCount(0);
    await expect(page.getByTestId('scoring-model-card')).toHaveCount(3);
  });

  test('excluir um modelo em uso é barrado com mensagem clara', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_freefire');
    const card = modelCard(page, FF_DEFAULT_MODEL);
    await card.getByRole('button', { name: `Excluir ${FF_DEFAULT_MODEL}` }).click();

    const dialog = page.getByRole('dialog', { name: 'Excluir modelo de pontuação?' });
    await dialog.getByRole('button', { name: 'Excluir modelo' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('Este modelo é usado pelo campeonato');
    await expect(alert).toContainText('não pode ser excluído');

    await dialog.getByRole('button', { name: 'Voltar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(page.getByTestId('scoring-model-card')).toHaveCount(3);
  });

  test('remover um modo usado por campeonato é barrado dizendo qual', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_freefire');
    // "Squad" é o modo da Copa de Free Fire do seed.
    const squad = page.getByRole('group', { name: 'Modo 3' });
    await expect(squad.getByRole('textbox', { name: 'Nome do modo' })).toHaveValue('Squad');
    await page.getByRole('button', { name: 'Remover modo 3' }).click();
    await page.getByRole('button', { name: 'Salvar jogo' }).click();

    await expect(page.getByRole('form', { name: 'Dados do jogo' }).getByRole('alert').filter({ hasText: 'O modo "Squad" é usado pelo campeonato' })).toBeVisible();
    const modes = await page.evaluate(async () => {
      const res = await fetch('/api/v1/games/free-fire');
      return ((await res.json()) as { modes: Array<{ name: string }> }).modes.map((m) => m.name);
    });
    expect(modes).toEqual(['Solo', 'Duo', 'Squad', 'Contra Squad 4v4']);
  });

  test('edita os dados do jogo sem perder os modos', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/jogos/g_efootball');
    await expect(page.getByRole('group', { name: 'Estatística extra 1' }).getByRole('textbox', { name: 'Rótulo' })).toHaveValue('Pênaltis');
    await page.getByRole('textbox', { name: 'Plataforma' }).fill('Mobile, console e PC');
    await page.getByRole('button', { name: 'Salvar jogo' }).click();
    await expect(page.getByText('Mobile, console e PC · /jogos/efootball')).toBeVisible();

    const game = await page.evaluate(async () => {
      const res = await fetch('/api/v1/games/efootball');
      return (await res.json()) as { platform: string; modes: Array<{ id: string }>; extraStatFields: unknown[] };
    });
    expect(game.platform).toBe('Mobile, console e PC');
    // O modo manteve o `id`: campeonatos que apontam para ele continuam válidos.
    expect(game.modes.map((m) => m.id)).toEqual(['m_ef_1v1']);
    expect(game.extraStatFields).toEqual([{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }]);
  });
});

test.describe('Admin · catálogo de jogos · permissões', () => {
  const newGame = {
    name: 'Jogo da Camila',
    slug: 'jogo-da-camila',
    icon: 'JC',
    coverUrl: null,
    platform: 'Mobile',
    active: true,
    requiredAccountFields: [],
    extraStatFields: [],
    modes: [{ name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }],
  };

  async function call(page: Page, method: string, path: string, body?: unknown): Promise<number> {
    return page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return res.status;
      },
      { method, path, body },
    );
  }

  test('organizadora recebe 403 ao escrever no catálogo, que para ela é só leitura', async ({ page }) => {
    await loginAs(page, 'u_camila');
    expect(await call(page, 'POST', '/admin/games', newGame)).toBe(403);
    expect(await call(page, 'PATCH', '/admin/games/g_freefire', { active: false })).toBe(403);
    expect(await call(page, 'POST', '/admin/games/g_freefire/scoring-models', {})).toBe(403);
    expect(await call(page, 'PATCH', '/admin/games/g_freefire/scoring-models/sm_ff_liga', { isDefault: true })).toBe(403);
    expect(await call(page, 'POST', '/admin/games/g_freefire/scoring-models/sm_ff_liga/duplicate')).toBe(403);
    expect(await call(page, 'DELETE', '/admin/games/g_freefire/scoring-models/sm_ff_liga')).toBe(403);

    // Ler continua liberado, e nada mudou.
    expect(await call(page, 'GET', '/games')).toBe(200);
    const slugs = await publicGameSlugs(page);
    expect(slugs).toContain('free-fire');
    expect(slugs).not.toContain('jogo-da-camila');
  });

  test('visitante recebe 401 e participante 403 ao escrever no catálogo', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    expect(await call(page, 'POST', '/admin/games', newGame)).toBe(401);
    await loginAs(page, 'u_bianca');
    expect(await call(page, 'POST', '/admin/games', newGame)).toBe(403);
    expect(await call(page, 'DELETE', '/admin/games/g_freefire/scoring-models/sm_ff_liga')).toBe(403);
  });

  test('administradora cria pelo mesmo endpoint (201) e o slug repetido volta 409', async ({ page }) => {
    await loginAs(page, 'u_ana');
    expect(await call(page, 'POST', '/admin/games', newGame)).toBe(201);
    expect(await call(page, 'POST', '/admin/games', newGame)).toBe(409);
    expect(await call(page, 'POST', '/admin/games', { ...newGame, slug: 'outro', modes: [] })).toBe(400);
  });

  test('participante em /admin/jogos vê a página 403', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/admin/jogos');
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Jogos e regras' })).toHaveCount(0);
  });

  test('organizadora em /admin/jogos também vê a página 403', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/admin/jogos/g_freefire');
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
  });
});
