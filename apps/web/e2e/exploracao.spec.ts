/**
 * Exploração (F1.5): home, lista de campeonatos com filtros na URL e rolagem infinita,
 * página do campeonato (abas, seguir, rich-text sanitizado, embed), jogos e ranking.
 */
import type { Page } from '@playwright/test';
import { expect as baseExpect, loginAs, test, waitForApp } from './fixtures';

// Folga para o servidor de desenvolvimento, que compila cada rota na primeira visita.
const expect = baseExpect.configure({ timeout: 20_000 });

const DB_KEY = 'nova-mock-db';
const COPA = '/c/copa-nova-ff-squad';

interface DbTournamentPatch {
  description?: string;
  rules?: string;
  prize?: string;
  streamUrls?: string[];
}

/**
 * Altera o banco simulado direto no localStorage (é lá que o protótipo guarda os dados).
 * Vale a partir da próxima carga completa de página (`page.goto`).
 */
async function seedDb(page: Page, changes: { patchTournament?: { id: string; patch: DbTournamentPatch }; cloneTournaments?: { fromId: string; count: number }; announcement?: { tournamentId: string; title: string; body: string } }) {
  if (page.url() === 'about:blank') await page.goto('/');
  await waitForApp(page);
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, DB_KEY);
  await page.evaluate(
    ({ key, changes }) => {
      interface T {
        id: string;
        slug: string;
        name: string;
        featured: boolean;
        [k: string]: unknown;
      }
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as { tournaments: T[]; announcements: Record<string, unknown>[] };
      if (changes.patchTournament) {
        const t = db.tournaments.find((x) => x.id === changes.patchTournament?.id);
        if (!t) throw new Error('campeonato do seed não encontrado');
        Object.assign(t, changes.patchTournament.patch);
      }
      if (changes.cloneTournaments) {
        const base = db.tournaments.find((x) => x.id === changes.cloneTournaments?.fromId);
        if (!base) throw new Error('campeonato do seed não encontrado');
        for (let i = 1; i <= changes.cloneTournaments.count; i += 1) {
          const n = String(i).padStart(2, '0');
          db.tournaments.push({ ...base, id: `tn_extra_${n}`, slug: `campeonato-extra-${n}`, name: `Campeonato Extra ${n}`, featured: false });
        }
      }
      if (changes.announcement) {
        db.announcements.push({ id: 'an_teste', stageId: null, groupId: null, authorNickname: 'Camila', createdAt: new Date().toISOString(), ...changes.announcement });
      }
      localStorage.setItem(key, JSON.stringify(db));
    },
    { key: DB_KEY, changes },
  );
}

async function apiCall<T = unknown>(page: Page, method: string, path: string): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path }) => {
      const res = await fetch(`/api/v1${path}`, { method });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    { method, path },
  );
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${page.url()}`).toBeLessThanOrEqual(0);
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

/** Os filtros ficam na barra lateral no desktop e em um drawer (de baixo para cima) no celular. */
async function openFilters(page: Page) {
  if (!isMobile(page)) return page.getByRole('complementary', { name: 'Filtros' });
  await page.getByRole('button', { name: /^Filtros/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Filtros' });
  await expect(drawer).toBeVisible();
  return drawer;
}
async function closeFilters(page: Page) {
  if (!isMobile(page)) return;
  await page.getByRole('dialog', { name: 'Filtros' }).getByRole('button', { name: /^Ver / }).click();
  await expect(page.getByRole('dialog', { name: 'Filtros' })).toHaveCount(0);
}

const cards = (page: Page) => page.getByRole('list', { name: 'Campeonatos', exact: true }).locator('a[href^="/c/"]');
const card = (page: Page, name: string) => page.getByRole('list', { name: 'Campeonatos', exact: true }).getByRole('link', { name: new RegExp(name) });

test.describe('home', () => {
  test('mostra o campeonato em destaque com o botão que leva até ele', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    const hero = page.getByRole('region', { name: 'Copa Nova FF — Squad' });
    await expect(hero.getByRole('heading', { level: 2, name: 'Copa Nova FF — Squad' })).toBeVisible();
    await expect(hero.getByText('Campeonato em destaque')).toBeVisible();
    await expect(hero.getByText(/Free Fire · Squad/)).toBeVisible();
    await expect(hero.getByText('12/48 vagas')).toBeVisible();
    await expect(hero.getByText('Inscrições abertas')).toBeVisible();

    await hero.getByRole('link', { name: 'Inscrever squad' }).click();
    await expect(page).toHaveURL(new RegExp(`${COPA}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Copa Nova FF — Squad' })).toBeVisible();
  });

  test('atalhos por jogo levam à lista já filtrada', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const shortcuts = page.getByRole('navigation', { name: 'Campeonatos por jogo' });
    for (const game of ['Free Fire', 'Clash Royale', '8 Ball Pool', 'eFootball', 'Todos']) await expect(shortcuts.getByRole('link', { name: game })).toBeVisible();
    await expect(shortcuts.getByRole('link', { name: 'Todos' })).toHaveAttribute('href', '/campeonatos');

    await shortcuts.getByRole('link', { name: 'Clash Royale' }).click();
    await expect(page).toHaveURL(/\/campeonatos\?game=clash-royale$/);
    await expect(card(page, 'Liga Semanal Clash Royale 1v1')).toBeVisible();
    await expect(card(page, 'Copa Nova FF')).toHaveCount(0);
  });

  test('vitrine de inscrições abertas usa os cards de campeonato', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const open = page.getByRole('region', { name: 'Inscrições abertas' });
    await expect(open.getByRole('link', { name: /Copa eFootball Iniciantes/ })).toHaveAttribute('href', '/c/copa-efootball-iniciantes');
    await expect(open.getByRole('link', { name: /Arena Contra Squad 4v4/ })).toBeVisible();
    await expect(open.getByRole('link', { name: /Liga Semanal Clash Royale/ })).toHaveCount(0);
    await expect(open.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/campeonatos?status=open');
  });
});

test.describe('lista de campeonatos', () => {
  test('filtrar "Free Fire + com vagas" e recarregar a URL mantém o filtro', async ({ page }) => {
    await page.goto('/campeonatos');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Campeonatos' })).toBeVisible();
    await expect(card(page, 'Liga Semanal Clash Royale 1v1')).toBeVisible();
    // Rascunho e cancelado não aparecem na vitrine.
    await expect(card(page, 'Torneio Relâmpago')).toHaveCount(0);
    await expect(card(page, 'Clássico 8 Ball de Verão')).toHaveCount(0);

    let filters = await openFilters(page);
    await filters.getByLabel('Jogo').selectOption('free-fire');
    await filters.getByRole('checkbox', { name: 'Só com vagas' }).check();
    await closeFilters(page);

    await expect(page).toHaveURL(/\/campeonatos\?game=free-fire&slots=available$/);
    await expect(card(page, 'Copa Nova FF — Squad')).toBeVisible();
    await expect(card(page, 'Arena Contra Squad 4v4')).toBeVisible();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByText('Mostrando 2 de 2 campeonatos')).toBeVisible();

    // Recarregar (ou abrir o link em outro aparelho) reproduz a mesma lista e os mesmos controles.
    await page.reload();
    await waitForApp(page);
    await expect(cards(page)).toHaveCount(2);
    await expect(card(page, 'FF Solo Rush')).toHaveCount(0);
    await expect(card(page, 'Copa eFootball')).toHaveCount(0);
    if (isMobile(page)) await expect(page.getByTestId('active-filter-count')).toHaveText('2');
    filters = await openFilters(page);
    await expect(filters.getByLabel('Jogo')).toHaveValue('free-fire');
    await expect(filters.getByRole('checkbox', { name: 'Só com vagas' })).toBeChecked();

    // Limpar volta para a lista inteira e para a URL sem parâmetros.
    await (isMobile(page) ? page.getByRole('dialog', { name: 'Filtros' }) : filters).getByRole('button', { name: 'Limpar filtros' }).click();
    await closeFilters(page);
    await expect(page).toHaveURL(/\/campeonatos$/);
    await expect(card(page, 'Liga Semanal Clash Royale 1v1')).toBeVisible();
  });

  test('modo, status e organizador verificado também vão para a URL', async ({ page }) => {
    await page.goto('/campeonatos?mode=SOLO&status=open&verified=1');
    await waitForApp(page);
    // Solo + inscrições abertas + verificado: nenhum campeonato do seed combina (o eFootball é de organizador não verificado).
    await expect(page.getByRole('heading', { name: 'Nenhum campeonato encontrado' })).toBeVisible();

    const filters = await openFilters(page);
    await expect(filters.getByLabel('Modo')).toHaveValue('SOLO');
    await expect(filters.getByLabel('Status')).toHaveValue('open');
    await expect(filters.getByRole('checkbox', { name: 'Só organizador verificado' })).toBeChecked();
    await filters.getByRole('checkbox', { name: 'Só organizador verificado' }).uncheck();
    await closeFilters(page);
    await expect(page).toHaveURL(/\/campeonatos\?mode=SOLO&status=open$/);
    await expect(card(page, 'Copa eFootball Iniciantes')).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
  });

  test('busca por nome com debounce, e estado vazio com "Limpar filtros"', async ({ page }) => {
    await page.goto('/campeonatos');
    await waitForApp(page);
    const search = page.getByRole('searchbox', { name: 'Buscar campeonato pelo nome' });
    await search.pressSequentially('efootball', { delay: 20 });
    await expect(page).toHaveURL(/\/campeonatos\?q=efootball$/);
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, 'Copa eFootball Iniciantes')).toBeVisible();
    await expect(search).toHaveValue('efootball');

    await search.fill('nome que nenhum campeonato tem');
    await expect(page.getByRole('heading', { name: 'Nenhum campeonato encontrado' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Limpar filtros' }).last().click();
    await expect(page).toHaveURL(/\/campeonatos$/);
    await expect(search).toHaveValue('');
    await expect(card(page, 'Copa Nova FF — Squad')).toBeVisible();
  });

  test('link com a busca já preenchida reproduz a lista', async ({ page }) => {
    await page.goto('/campeonatos?q=liga');
    await waitForApp(page);
    await expect(page.getByRole('searchbox', { name: 'Buscar campeonato pelo nome' })).toHaveValue('liga');
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, 'Liga Semanal Clash Royale 1v1')).toBeVisible();
  });

  test('card mostra jogo, modo, data com fuso, vagas, status e selo', async ({ page }) => {
    await page.goto('/campeonatos?game=free-fire&status=open');
    await waitForApp(page);
    const copa = card(page, 'Copa Nova FF — Squad');
    await expect(copa).toHaveAttribute('href', COPA);
    await expect(copa.getByText('Free Fire')).toBeVisible();
    await expect(copa.getByText('Equipe · Squad')).toBeVisible();
    await expect(copa.getByText(/Começa .+ · \d{1,2}h(\d{2})? · horário de Brasília/)).toBeVisible();
    await expect(copa.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    await expect(copa.getByText('36 vagas livres')).toBeVisible();
    await expect(copa.getByText('Inscrições abertas')).toBeVisible();
    await expect(copa.getByText('Verificado')).toBeVisible();
    await expect(copa.getByText('Gratuito')).toBeVisible();
    // O organizador do Contra Squad (Diego) não é verificado.
    await expect(card(page, 'Arena Contra Squad 4v4').getByText('Verificado')).toHaveCount(0);
  });

  test('rolagem infinita: 20 por página, carrega mais ao chegar no fim', async ({ page }) => {
    await seedDb(page, { cloneTournaments: { fromId: 'tn_ff_solo', count: 45 } });
    await page.goto('/campeonatos?game=free-fire');
    await waitForApp(page);
    // 3 de Free Fire no seed + 45 clonados = 48.
    await expect(cards(page)).toHaveCount(20);
    await expect(page.getByText('Mostrando 20 de 48 campeonatos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Carregar mais' })).toBeVisible();

    // Rolar até o fim busca a próxima página sozinho, sem clicar em nada.
    await cards(page).last().scrollIntoViewIfNeeded();
    await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(40);
    await expect(async () => {
      await page.mouse.wheel(0, 8000);
      await baseExpect(cards(page)).toHaveCount(48, { timeout: 1500 });
    }).toPass();

    await expect(page.getByText('Mostrando 48 de 48 campeonatos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Carregar mais' })).toHaveCount(0);
    await expect(page.getByText('Você chegou ao fim da lista.')).toBeVisible();
    // Sem repetidos.
    const hrefs = await cards(page).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(48);
    await expectNoHorizontalScroll(page);
  });

  test('"Carregar mais" é a alternativa por teclado à rolagem infinita', async ({ page }) => {
    // Sem IntersectionObserver (navegador antigo ou leitor de tela que não rola): só o botão carrega.
    await page.addInitScript(() => {
      delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    });
    await seedDb(page, { cloneTournaments: { fromId: 'tn_ff_solo', count: 45 } });
    await page.goto('/campeonatos?game=free-fire');
    await waitForApp(page);
    await expect(cards(page)).toHaveCount(20);
    await cards(page).last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 8000);
    await expect(page.getByText('Mostrando 20 de 48 campeonatos')).toBeVisible();

    const more = page.getByRole('button', { name: 'Carregar mais' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(cards(page)).toHaveCount(40);
    await expect(page.getByText('Mostrando 40 de 48 campeonatos')).toBeVisible();
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(cards(page)).toHaveCount(48);
    await expect(more).toHaveCount(0);
  });
});

test.describe('página do campeonato', () => {
  test('cabeçalho e abas, com a aba na URL', async ({ page }) => {
    await page.route(/youtube|ytimg|twitch/, (route) => route.abort());
    await page.goto(COPA);
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Copa Nova FF — Squad' })).toBeVisible();
    const header = page.getByRole('main').locator('header').filter({ hasText: 'Organizado por' });
    await expect(header.getByText('Inscrições abertas')).toBeVisible();
    await expect(header.getByRole('link', { name: 'Camila' })).toHaveAttribute('href', '/u/Camila');
    await expect(header.getByText('Organizador verificado')).toBeVisible();
    await expect(header.getByText(/horário de Brasília/).first()).toBeVisible();
    await expect(header.getByRole('progressbar', { name: 'Vagas preenchidas' })).toHaveAttribute('aria-valuenow', '12');
    await expect(header.getByRole('link', { name: 'Free Fire' })).toHaveAttribute('href', '/jogos/free-fire');

    // Só as abas da F1: nada de aba vazia para o que entra na F2.
    const tabs = page.getByRole('tablist', { name: 'Seções do campeonato' });
    await expect(tabs.getByRole('tab')).toHaveText(['Visão geral', 'Regulamento', 'Inscritos', 'Comunicados']);
    await expect(tabs.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');

    // Visão geral: descrição, premiação e formato em linguagem de jogador.
    await expect(page.getByText('reúne 48 squads em três fases')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Premiação' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: /Fase de grupos/ })).toBeVisible();
    await expect(page.getByText('4 grupos. Cada grupo joga 3 quedas de Battle Royale, com até 12 equipes por sala.', { exact: false })).toBeVisible();
    await expect(page.getByText('1 ponto por kill · Booyah (1º lugar) vale 3 pontos').first()).toBeVisible();
    await expect(page.getByText('Avançam as 2 melhores equipes de cada grupo.')).toBeVisible();
    await expect(page.getByText('Última fase: daqui sai o campeão.')).toBeVisible();

    await tabs.getByRole('tab', { name: 'Regulamento' }).click();
    await expect(page).toHaveURL(/\?aba=regulamento$/);
    await expect(page.getByRole('heading', { level: 3, name: 'Regras gerais' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Inscritos' }).click();
    await expect(page).toHaveURL(/\?aba=inscritos$/);
    const registrations = page.getByRole('list', { name: 'Inscritos' });
    await expect(registrations.getByText('Squad Bravo')).toBeVisible();
    await expect(registrations.getByText('[BRAV]')).toBeVisible();
    await expect(registrations.getByText('Confirmada')).toHaveCount(12);
    const bravo = page.getByRole('list', { name: 'Membros de Squad Bravo' });
    await expect(bravo.getByRole('listitem')).toHaveCount(4);
    await expect(bravo.getByText('Capitão')).toHaveCount(1);

    await tabs.getByRole('tab', { name: 'Comunicados' }).click();
    await expect(page).toHaveURL(/\?aba=comunicados$/);
    await expect(page.getByRole('heading', { level: 3, name: 'Inscrições abertas!' })).toBeVisible();

    // Abrir o link com a aba reproduz a mesma aba; voltar para a primeira limpa o parâmetro.
    await page.goto(`${COPA}?aba=inscritos`);
    await expect(page.getByRole('tab', { name: 'Inscritos' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('list', { name: 'Inscritos' }).getByText('Squad Bravo')).toBeVisible();
    await page.getByRole('tab', { name: 'Visão geral' }).click();
    await expect(page).toHaveURL(new RegExp(`${COPA}$`));
  });

  test('campeonato solo lista os inscritos com link para o perfil', async ({ page }) => {
    await page.goto('/c/liga-semanal-clash-royale?aba=inscritos');
    await waitForApp(page);
    const registrations = page.getByRole('list', { name: 'Inscritos' });
    await expect(registrations.getByRole('link', { name: 'Bianca' })).toHaveAttribute('href', '/u/Bianca');
    await expect(registrations.getByRole('listitem')).toHaveCount(16);
    await expect(page.getByText('Em andamento').first()).toBeVisible();
  });

  test('seguir: visitante é levado ao login; logada, segue e deixa de seguir', async ({ page }) => {
    await page.route(/youtube|ytimg|twitch/, (route) => route.abort());
    await page.goto(COPA);
    await waitForApp(page);
    await page.getByRole('button', { name: 'Seguir campeonato' }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fc%2Fcopa-nova-ff-squad/);

    await loginAs(page, 'u_bianca');
    await page.goto(COPA);
    const follow = page.getByRole('button', { name: 'Seguir campeonato' });
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await follow.click();
    const following = page.getByRole('button', { name: 'Seguindo' });
    await expect(following).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Você está seguindo Copa Nova FF — Squad')).toBeVisible();
    expect((await apiCall<{ tournaments: string[]; games: string[] }>(page, 'GET', '/me/follows')).data).toEqual({ tournaments: ['tn_copa_ff'], games: ['g_8ball'] });

    await page.reload();
    await expect(page.getByRole('button', { name: 'Seguindo' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Seguindo' }).click();
    await expect(page.getByRole('button', { name: 'Seguir campeonato' })).toHaveAttribute('aria-pressed', 'false');
    expect((await apiCall<{ tournaments: string[] }>(page, 'GET', '/me/follows')).data.tournaments).toEqual([]);
  });

  test('a API de seguir exige login e recusa alvo que não existe', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    expect((await apiCall(page, 'GET', '/me/follows')).status).toBe(401);
    expect((await apiCall(page, 'PUT', '/me/follows/tournament/tn_copa_ff')).status).toBe(401);
    await loginAs(page, 'u_bianca');
    expect((await apiCall(page, 'PUT', '/me/follows/tournament/nao-existe')).status).toBe(404);
    expect((await apiCall(page, 'PUT', '/me/follows/squad/t_alfa')).status).toBe(404);
    // Rascunho de outra pessoa não pode ser seguido (nem revela que existe).
    expect((await apiCall(page, 'PUT', '/me/follows/tournament/tn_cr_2v2')).status).toBe(404);
    // Seguir duas vezes não duplica.
    await apiCall(page, 'PUT', '/me/follows/game/free-fire');
    const twice = await apiCall<{ games: string[] }>(page, 'PUT', '/me/follows/game/g_freefire');
    expect(twice.data.games).toEqual(['g_8ball', 'g_freefire']);
  });

  test('conteúdo malicioso na descrição, no regulamento e nos comunicados não executa', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const payload =
      '<p>Texto seguro do organizador</p>' +
      '<script>window.__xss = "script"</script>' +
      '<img src="x" onerror="window.__xss = \'img\'">' +
      '<svg onload="window.__xss = \'svg\'"></svg>' +
      '<iframe src="https://evil.example.com/" srcdoc="<script>parent.__xss = 1</script>"></iframe>' +
      '<a href="javascript:window.__xss = \'link\'">link perigoso</a>' +
      '<a href="https://exemplo.com/regras" onclick="window.__xss = \'onclick\'">link bom</a>' +
      '<p style="position:fixed;inset:0" onmouseover="window.__xss = \'hover\'">parágrafo com evento</p>' +
      '<form action="https://evil.example.com/"><input name="senha"><button>Enviar</button></form>';
    await seedDb(page, {
      patchTournament: { id: 'tn_copa_ff', patch: { description: payload, rules: payload, prize: payload, streamUrls: [] } },
      announcement: { tournamentId: 'tn_copa_ff', title: '<img src=x onerror="window.__xss = \'titulo\'">', body: '<script>window.__xss = "comunicado"</script><b>negrito</b>' },
    });

    for (const tab of ['', '?aba=regulamento', '?aba=comunicados']) {
      await page.goto(`${COPA}${tab}`);
      await waitForApp(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Copa Nova FF — Squad' })).toBeVisible();
      if (tab === '?aba=comunicados') {
        // Comunicado é texto puro: as tags aparecem escritas, não viram elementos.
        await expect(page.getByText('<script>window.__xss = "comunicado"</script><b>negrito</b>')).toBeVisible();
      } else {
        await expect(page.getByText('Texto seguro do organizador').first()).toBeVisible();
        await expect(page.getByText('parágrafo com evento').first()).toBeVisible();
        await page.getByText('parágrafo com evento').first().hover();
        const good = page.getByRole('link', { name: 'link bom' }).first();
        await expect(good).toHaveAttribute('href', 'https://exemplo.com/regras');
        await expect(good).toHaveAttribute('rel', /noopener/);
        await expect(good).toHaveAttribute('target', '_blank');
        // O link `javascript:` perde o destino (vira texto sem `href`).
        await expect(page.locator('a[href^="javascript" i]')).toHaveCount(0);
      }
      const main = page.getByRole('main');
      await expect(main.locator('script, iframe, svg[onload], form, input[name="senha"], img[src="x"]')).toHaveCount(0);
      await expect(main.locator('[onclick], [onerror], [onload], [onmouseover], [style*="position"]')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    }
    expect(dialogs).toEqual([]);
  });

  test('transmissão: embed só para Twitch e YouTube', async ({ page }) => {
    await page.route(/youtube|ytimg|twitch|vimeo|evil\.example/, (route) => route.abort());
    await seedDb(page, {
      patchTournament: {
        id: 'tn_copa_ff',
        patch: {
          streamUrls: [
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://www.twitch.tv/novaarena',
            'https://vimeo.com/123456',
            'https://evil.example.com/embed/dQw4w9WgXcQ',
            'https://youtube.com.evil.example.com/watch?v=dQw4w9WgXcQ',
            'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
          ],
        },
      },
    });
    await page.goto(COPA);
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Transmissão' })).toBeVisible();

    const frames = page.getByRole('main').locator('iframe');
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    await expect(frames.nth(0)).toHaveAttribute('title', /Transmissão de Copa Nova FF — Squad no YouTube/);
    await expect(frames.nth(1)).toHaveAttribute('src', /^https:\/\/player\.twitch\.tv\/\?channel=novaarena&parent=localhost/);
    await expect(frames.nth(1)).toHaveAttribute('title', /Transmissão de Copa Nova FF — Squad na? Twitch|no Twitch/);
    for (const frame of await frames.all()) {
      await expect(frame).toHaveAttribute('loading', 'lazy');
      const sandbox = (await frame.getAttribute('sandbox')) ?? '';
      expect(sandbox).toContain('allow-scripts');
      expect(sandbox).not.toContain('allow-top-navigation');
      expect(sandbox).not.toContain('allow-forms');
    }
    // Os outros links não viram player nem link clicável.
    await expect(page.locator('a[href*="vimeo"], a[href*="evil.example"], iframe[src*="vimeo"], iframe[src*="evil"]')).toHaveCount(0);
  });

  test('sem link de transmissão, a seção não aparece', async ({ page }) => {
    await page.goto('/c/copa-efootball-iniciantes');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Formato' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Transmissão' })).toHaveCount(0);
    await expect(page.getByRole('main').locator('iframe')).toHaveCount(0);
    await expect(page.getByText('Vitória vale 3 pontos, empate 1 e derrota 0').first()).toBeVisible();
  });

  test('"Gerenciar campeonato" só aparece para dono, co-organizador e admin', async ({ page }) => {
    await page.route(/youtube|ytimg|twitch/, (route) => route.abort());
    const manage = page.getByRole('link', { name: 'Gerenciar campeonato' });

    await page.goto(COPA);
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Copa Nova FF — Squad' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartilhar' })).toBeVisible();
    await expect(manage).toHaveCount(0);

    for (const [user, visible] of [
      ['u_camila', true], // dona
      ['u_ana', true], // admin
      ['u_bianca', false], // participante
      ['u_diego', false], // organizador de outro campeonato
      ['u_p06', false], // moderadora deste campeonato
    ] as const) {
      await loginAs(page, user);
      // Espera a consulta de permissão terminar antes de afirmar que o link não existe.
      const accessChecked = page.waitForResponse((r) => r.url().includes('/tournaments/tn_copa_ff/access'));
      await page.goto(COPA);
      await expect(page.getByRole('button', { name: 'Compartilhar' })).toBeVisible();
      await accessChecked;
      if (visible) await expect(manage).toHaveAttribute('href', '/organizador/campeonatos/tn_copa_ff');
      else await expect(manage).toHaveCount(0);
    }
  });

  test('campeonato que não existe e rascunho de outra pessoa mostram o 404 amigável', async ({ page }) => {
    await page.goto('/c/esse-campeonato-nao-existe');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Campeonato não encontrado' })).toBeAttached();
    await expect(page.getByRole('link', { name: 'Ver campeonatos' })).toHaveAttribute('href', '/campeonatos');

    // Rascunho: invisível para visitante e para outro organizador…
    await page.goto('/c/torneio-relampago-cr-2v2');
    await expect(page.getByRole('link', { name: 'Ver campeonatos' })).toBeVisible();
    await loginAs(page, 'u_diego');
    await page.goto('/c/torneio-relampago-cr-2v2');
    await expect(page.getByRole('link', { name: 'Ver campeonatos' })).toBeVisible();

    // …e visível para a dona.
    await loginAs(page, 'u_camila');
    await page.goto('/c/torneio-relampago-cr-2v2');
    await expect(page.getByRole('heading', { level: 1, name: 'Torneio Relâmpago CR 2v2' })).toBeVisible();
    await expect(page.getByText('Rascunho').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gerenciar campeonato' })).toBeVisible();
  });

  test('compartilhar copia o link quando o aparelho não tem a folha de compartilhamento', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });
    await page.goto('/c/copa-efootball-iniciantes');
    await waitForApp(page);
    await page.getByRole('button', { name: 'Compartilhar' }).click();
    await expect(page.getByText('Link copiado')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/c\/copa-efootball-iniciantes$/);
  });
});

test.describe('jogos e ranking', () => {
  test('/jogos mostra a grade dos jogos ativos', async ({ page }) => {
    await page.goto('/jogos');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Jogos' })).toBeVisible();
    const grid = page.getByRole('list', { name: 'Jogos' });
    await expect(grid.getByRole('listitem')).toHaveCount(4);
    await expect(grid.getByRole('link', { name: /Free Fire/ })).toHaveAttribute('href', '/jogos/free-fire');
    await grid.getByRole('link', { name: /eFootball/ }).click();
    await expect(page).toHaveURL(/\/jogos\/efootball$/);
    await expect(page.getByRole('heading', { level: 1, name: 'eFootball' })).toBeVisible();
  });

  test('/jogos/free-fire explica modos e pontuação e lista os campeonatos abertos', async ({ page }) => {
    await page.goto('/jogos/free-fire');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Free Fire' })).toBeVisible();
    await expect(page.getByText('Plataforma: Mobile')).toBeVisible();

    const modes = page.getByRole('region', { name: 'Modos de jogo' });
    await expect(modes.getByRole('heading', { level: 3 })).toHaveText(['Solo', 'Duo', 'Squad', 'Contra Squad 4v4']);
    await expect(modes.getByText('Equipes de 4 jogadores + 1 reserva')).toHaveCount(2);
    await expect(modes.getByText('Battle Royale · até 12 equipes por sala')).toBeVisible();
    await expect(modes.getByText('Equipe contra equipe')).toBeVisible();

    const scoring = page.getByRole('region', { name: 'Como a pontuação funciona' });
    await expect(scoring.getByText('1 ponto por kill', { exact: true })).toBeVisible();
    await expect(scoring.getByText('Booyah (1º lugar) vale 3 pontos')).toBeVisible();
    await expect(scoring.getByText('Vitória vale 3 pontos, empate 0 e derrota 0')).toBeVisible();
    // O modelo "Liga" não é padrão: não entra na vitrine do jogo.
    await expect(scoring.getByText(/Pontos por colocação/)).toHaveCount(0);

    const open = page.getByRole('region', { name: 'Campeonatos com inscrições abertas' });
    await expect(open.getByRole('link', { name: /Copa Nova FF — Squad/ })).toBeVisible();
    await expect(open.getByRole('link', { name: /Arena Contra Squad 4v4/ })).toBeVisible();
    await expect(open.getByRole('link', { name: /FF Solo Rush/ })).toHaveCount(0);
    await expect(open.getByRole('link', { name: 'Todos os campeonatos de Free Fire' })).toHaveAttribute('href', '/campeonatos?game=free-fire');
  });

  test('seguir jogo', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/jogos/free-fire');
    await page.getByRole('button', { name: 'Seguir jogo' }).click();
    await expect(page.getByRole('button', { name: 'Seguindo' })).toHaveAttribute('aria-pressed', 'true');
    expect((await apiCall<{ games: string[] }>(page, 'GET', '/me/follows')).data.games).toEqual(['g_8ball', 'g_freefire']);

    // A Bianca já segue 8 Ball Pool no seed.
    await page.goto('/jogos/8-ball-pool');
    await expect(page.getByRole('button', { name: 'Seguindo' }).first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('jogo que não existe', async ({ page }) => {
    await page.goto('/jogos/jogo-que-nao-existe');
    await waitForApp(page);
    await expect(page.getByRole('link', { name: 'Ver todos os jogos' })).toHaveAttribute('href', '/jogos');
  });

  test('/ranking: seletor de jogo, tabela com link para o perfil e números vindos dos resultados', async ({ page }) => {
    await page.goto('/ranking');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Ranking' })).toBeVisible();

    // O primeiro jogo (Free Fire) ainda não teve campeonato disputado: estado vazio com ação.
    const selector = page.getByRole('navigation', { name: 'Escolher o jogo do ranking' });
    await expect(selector.getByRole('link', { name: 'Free Fire' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Ninguém no ranking de Free Fire ainda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver campeonatos de Free Fire' })).toHaveAttribute('href', '/campeonatos?game=free-fire');

    await selector.getByRole('link', { name: 'Clash Royale' }).click();
    await expect(page).toHaveURL(/\/ranking\?jogo=clash-royale$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Ranking de Clash Royale' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ninguém no ranking/ })).toHaveCount(0);
    // Tabela no desktop, cartões no celular: nos dois o jogador é um link para o perfil.
    const bianca = page.getByRole('main').getByRole('link', { name: 'Bianca' }).locator('visible=true');
    await expect(bianca).toHaveAttribute('href', '/u/Bianca');
    if (!isMobile(page)) {
      const table = page.getByRole('table', { name: 'Ranking de Clash Royale' });
      await expect(table.getByRole('columnheader')).toHaveText(['Posição', 'Jogador', 'Títulos', 'Vitórias', 'Placar a favor', 'Partidas', 'Campeonatos']);
      await expect(table.getByRole('row')).toHaveCount(17);
    } else {
      await expect(page.getByRole('list', { name: 'Ranking de Clash Royale' }).getByRole('listitem')).toHaveCount(16);
    }

    // O link com o jogo reproduz a escolha; o 8 Ball tem um campeonato finalizado, com pódio.
    await page.goto('/ranking?jogo=8-ball-pool');
    await expect(page.getByRole('heading', { level: 2, name: 'Ranking de 8 Ball Pool' })).toBeVisible();
    await expect(page.getByText('A ordem é por títulos, depois vitórias, depois placar a favor', { exact: false })).toBeVisible();
    const api = await apiCall<{ resultsAvailable: boolean; entries: { nickname: string; position: number; tournamentsPlayed: number; tournamentsFinished: number; titles: number | null }[] }>(page, 'GET', '/games/8-ball-pool/ranking');
    expect(api.data.resultsAvailable).toBe(true);
    expect(api.data.entries).toHaveLength(8);
    expect(api.data.entries[0]?.titles).toBe(1);
    expect(api.data.entries.every((e) => e.tournamentsPlayed === 1 && e.tournamentsFinished === 1)).toBe(true);
    expect((await apiCall(page, 'GET', '/games/jogo-que-nao-existe/ranking')).status).toBe(404);
  });

  test('nenhum link do menu principal leva a uma página vazia', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const nav = page.getByRole('navigation', { name: 'Principal' }).locator('visible=true');
    for (const [label, heading] of [
      ['Campeonatos', 'Campeonatos'],
      ['Jogos', 'Jogos'],
      ['Ranking', 'Ranking'],
    ] as const) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText('ainda não foi construída')).toHaveCount(0);
    }
  });
});

test.describe('sem rolagem horizontal (exploração)', () => {
  const pages: [string, string][] = [
    ['/', 'Inscrições abertas'],
    ['/campeonatos', 'Campeonatos'],
    [COPA, 'Copa Nova FF — Squad'],
    [`${COPA}?aba=regulamento`, 'Copa Nova FF — Squad'],
    [`${COPA}?aba=inscritos`, 'Copa Nova FF — Squad'],
    [`${COPA}?aba=comunicados`, 'Copa Nova FF — Squad'],
    ['/c/liga-semanal-clash-royale?aba=inscritos', 'Liga Semanal Clash Royale 1v1'],
    ['/jogos', 'Jogos'],
    ['/jogos/free-fire', 'Free Fire'],
    ['/ranking', 'Ranking'],
    ['/ranking?jogo=clash-royale', 'Ranking de Clash Royale'],
  ];
  for (const [path, heading] of pages) {
    test(path, async ({ page }) => {
      await page.route(/youtube|ytimg|twitch/, (route) => route.abort());
      await page.goto(path);
      await waitForApp(page);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      await expect(page.locator('[role="status"][aria-label^="Carregando"]')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }

  test('lista com os filtros abertos no celular', async ({ page }) => {
    await page.goto('/campeonatos?game=free-fire&slots=available');
    await waitForApp(page);
    await openFilters(page);
    await expectNoHorizontalScroll(page);
  });
});
