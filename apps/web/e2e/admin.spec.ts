import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';

/** Linha de uma lista do painel: linha de tabela no desktop, cartão no celular (o `DataTable` troca em 768 px). */
function row(page: Page, text: string | RegExp): Locator {
  return page.getByRole('row').or(page.getByRole('listitem')).filter({ hasText: text });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Fecha os avisos (toasts): no celular eles ficam por cima do rodapé dos modais de tela cheia. */
async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Fechar aviso' });
  while ((await close.count()) > 0) {
    await close
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
}

/** Espera a tela terminar de carregar: título visível e nenhum esqueleto de carregamento. */
async function waitForScreen(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await expect(page.locator('[role="status"][aria-label^="Carregando"]')).toHaveCount(0);
}

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method: m, path: p, body: b }) => {
      const res = await fetch(`/api/v1${p}`, { method: m, headers: b === undefined ? {} : { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
      const text = await res.text();
      return { status: res.status, data: (text ? JSON.parse(text) : null) as never };
    },
    { method, path, body },
  );
}

/** Data e hora para um `<input type="datetime-local">`, no fuso do navegador do teste. */
function localInput(page: Page, minutesFromNow: number): Promise<string> {
  return page.evaluate((minutes) => {
    const d = new Date(Date.now() + minutes * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }, minutesFromNow);
}

test.describe('Admin · dashboard', () => {
  test('mostra os indicadores, os gráficos com tabela alternativa e as últimas ações', async ({ page }) => {
    await loginAs(page, 'u_ana');
    // Uma ação qualquer, para "Últimas ações" ter o que mostrar.
    expect((await api(page, 'PATCH', '/admin/tournaments/tn_efootball', { featured: true })).status).toBe(200);
    await page.goto('/admin');
    await waitForScreen(page, 'Dashboard');

    // Indicadores calculados do banco: cada cartão é um atalho para a tela correspondente.
    const north = page.getByRole('link', { name: /^Partidas validadas na semana: 10, de 10 partidas na semana/ });
    await expect(north).toBeVisible();
    await expect(north).toHaveAttribute('href', '/admin/campeonatos');
    await expect(page.getByRole('link', { name: /^Usuários ativos: 66, de 66 contas/ })).toHaveAttribute('href', '/admin/usuarios');
    await expect(page.getByRole('link', { name: /^Campeonatos ativos: 5, 1 encerrado/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Disputas abertas: 0/ })).toHaveAttribute('href', '/admin/moderacao?aba=disputas');
    await expect(page.getByRole('link', { name: /^Pedidos de organizador: 1, na fila\. Pede atenção/ })).toHaveAttribute('href', '/admin/organizadores?aba=pedidos');
    await expect(page.getByRole('link', { name: /^Taxa de W\.O\.: 0%/ })).toBeVisible();
    await expect(north.getByTestId('kpi-value')).toHaveCSS('font-variant-numeric', 'tabular-nums');

    // Gráficos: imagem descrita + tabela com os mesmos números.
    await expect(page.getByRole('img', { name: /Gráfico de barras: partidas com resultado validado por dia nos últimos 30 dias\. Total: 22/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /Gráfico de barras: campeonatos por jogo\. Free Fire: 3/ })).toBeVisible();
    const byGame = page.getByRole('region', { name: 'Campeonatos por jogo' });
    await byGame.getByText('Ver em tabela').click();
    const table = byGame.getByRole('table', { name: 'Campeonatos por jogo: os números do gráfico' });
    await expect(table.getByRole('row', { name: 'Free Fire 3' })).toBeVisible();
    await expect(table.getByRole('row', { name: 'eFootball 1' })).toBeVisible();

    // Intervalo: 7 dias tira da conta as partidas de 21 dias atrás; 90 dias alcança os cadastros.
    await expect(page.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/\d+ cadastros nos últimos 30 dias/)).toBeVisible();
    await page.getByRole('button', { name: '7 dias' }).click();
    await expect(page.getByText('10 partidas validadas nos últimos 7 dias')).toBeVisible();
    await page.getByRole('button', { name: '90 dias' }).click();
    await expect(page.getByText('66 cadastros nos últimos 90 dias')).toBeVisible();
    await expect(page.getByRole('img', { name: /Gráfico de área: novos cadastros por dia nos últimos 90 dias\. Total: 66/ })).toBeVisible();

    // Últimas ações da auditoria.
    const recent = page.getByRole('list', { name: 'Últimas ações registradas na auditoria' });
    await expect(recent.getByText('Ana · Destaque na home alterado')).toBeVisible();
    await expect(recent.getByText('Copa eFootball Iniciantes')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await north.click();
    await expect(page).toHaveURL(/\/admin\/campeonatos$/);
  });
});

test.describe('Admin · convite de administrador e 2FA', () => {
  test('Admin gera convite, sai, outra conta aceita, fica bloqueada pelo 2FA, configura e entra', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/administradores');
    await waitForScreen(page, 'Administradores');
    await expect(row(page, 'rafael@novaarena.gg')).toContainText('Super Admin');
    await expect(row(page, 'rafael@novaarena.gg')).toContainText('Não pode ser removido');

    // Convite por link, 1 hora, 1 uso.
    const form = page.getByRole('form', { name: 'Novo convite' });
    await form.getByLabel('Validade').selectOption('1h');
    await expect(form.getByLabel('Limite de usos')).toHaveValue('1');
    await form.getByRole('button', { name: 'Gerar convite' }).click();
    const link = (await page.getByTestId('invite-link').innerText()).trim();
    expect(link).toMatch(/\/convite\/[0-9a-f]{48}$/);
    await expect(page.getByText('Convite criado. Copie o link agora: ele não aparece de novo.')).toBeVisible();
    // Na lista o convite aparece como válido, sem o link.
    await expect(row(page, /Administrador.*0 de 1/s).first()).toContainText('Válido');
    await dismissToasts(page);

    // A Ana sai.
    await page.getByRole('button', { name: 'Conta de Ana' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Outra conta aceita o convite.
    await loginAs(page, 'u_p10');
    await page.goto(new URL(link).pathname);
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Convite para ser administrador' })).toBeVisible();
    await page.getByRole('button', { name: 'Aceitar convite' }).click();

    // Virou admin, mas a área fica bloqueada até ativar o 2FA.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Ative a verificação em duas etapas' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
    expect((await api(page, 'GET', '/admin/stats')).status).toBe(403);
    await dismissToasts(page);
    await page.getByRole('link', { name: 'Configurar agora' }).click();

    // Configuração do 2FA: QR code, chave manual e código de confirmação.
    await expect(page).toHaveURL(/\/minha-conta\/seguranca$/);
    await expect(page.getByText('Inativa', { exact: true })).toBeVisible();
    await expect(page.getByText('a área de administração fica bloqueada até a verificação em duas etapas estar ativa')).toBeVisible();
    await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
    await expect(page.getByTestId('two-factor-qr')).toBeVisible();
    await expect(page.getByTestId('two-factor-secret')).toHaveText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    await expectNoHorizontalScroll(page);

    // Código errado não ativa.
    await page.getByLabel('Código do aplicativo').fill('12345');
    await page.getByRole('button', { name: 'Ativar verificação', exact: true }).click();
    await expect(page.getByText('O código tem 6 dígitos')).toBeVisible();

    // No protótipo o código do momento aparece num aviso marcado "Protótipo".
    const prototype = page.getByTestId('prototype-code');
    await expect(prototype.getByText('Protótipo', { exact: true })).toBeVisible();
    await expect(prototype.getByTestId('dev-code')).toHaveText(/^\d{6}$/);
    await prototype.getByRole('button', { name: 'Usar este código' }).click();
    await page.getByRole('button', { name: 'Ativar verificação', exact: true }).click();

    // Códigos de recuperação, mostrados uma vez.
    const codes = page.getByRole('list', { name: 'Códigos de recuperação' }).getByRole('listitem');
    await expect(codes).toHaveCount(8);
    await expect(codes.first()).toHaveText(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar (.txt)' }).click();
    expect((await download).suggestedFilename()).toBe('nova-arena-codigos-de-recuperacao.txt');

    // Agora entra na administração.
    await page.getByRole('link', { name: 'Ir para a administração' }).click();
    await waitForScreen(page, 'Dashboard');
    expect((await api(page, 'GET', '/admin/stats')).status).toBe(200);

    // Criar e aceitar ficaram na auditoria; o convite está esgotado e não serve para mais ninguém.
    await page.goto('/admin/auditoria');
    await waitForScreen(page, 'Auditoria');
    await expect(page.getByTestId('audit-entry').filter({ hasText: 'Convite aceito' })).toContainText('NinaZz10');
    await expect(page.getByTestId('audit-entry').filter({ hasText: 'Convite criado' })).toContainText('Ana');
    await page.goto('/admin/administradores');
    await expect(row(page, /Administrador.*1 de 1/s).first()).toContainText('Esgotado');
    await loginAs(page, 'u_p11');
    await page.goto(new URL(link).pathname);
    await expect(page.getByRole('heading', { name: 'Este convite já foi usado' })).toBeVisible();
    expect((await api<{ roles: string[] }>(page, 'GET', '/me')).data.roles).toEqual(['PARTICIPANT']);
  });
});

test.describe('Admin · organizadores', () => {
  test('aprova um pedido de organizador e o usuário recebe a notificação', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/organizadores');
    await waitForScreen(page, 'Organizadores');
    await expect(row(page, 'Camila')).toContainText('Verificado');
    await expect(row(page, 'Camila')).toContainText('3 de 10');
    await expectNoHorizontalScroll(page);

    await page.getByRole('tab', { name: /Pedidos/ }).click();
    const request = page.getByTestId('organizer-request').filter({ hasText: 'JuliaGG5' });
    await expect(request).toContainText('Aguardando análise');
    await expect(request).toContainText('2 campeonatos jogados');
    await expect(request).toContainText('Organizo campeonatos de Free Fire no meu bairro');

    // Recusar exige motivo; aprovar aceita recado opcional.
    await request.getByRole('button', { name: /Recusar/ }).click();
    const reject = page.getByRole('dialog', { name: 'Recusar o pedido de JuliaGG5' });
    await reject.getByRole('button', { name: 'Recusar pedido' }).click();
    await expect(reject.getByText('Informe o motivo')).toBeVisible();
    await reject.getByRole('button', { name: 'Voltar' }).click();

    await request.getByRole('button', { name: /Aprovar/ }).click();
    const approve = page.getByRole('dialog', { name: 'Aprovar o pedido de JuliaGG5' });
    await approve.getByLabel('Recado para a pessoa (opcional)').fill('Bem-vinda à organização!');
    await approve.getByRole('button', { name: 'Aprovar pedido' }).click();
    await expect(page.getByText('Pedido aprovado', { exact: true })).toBeVisible();
    await expect(request).toContainText('Aprovado');
    await dismissToasts(page);

    await page.getByRole('tab', { name: 'Organizadores' }).click();
    await expect(row(page, 'JuliaGG5')).toContainText('0 de 3');

    // A pessoa recebe a notificação e ganha a área de organização.
    await loginAs(page, 'u_p05');
    await page.goto('/notificacoes');
    await waitForApp(page);
    await expect(page.getByText('Pedido de organizador aprovado').first()).toBeVisible();
    await expect(page.getByText(/Bem-vinda à organização!/).first()).toBeVisible();
    expect((await api(page, 'GET', '/organizer/tournaments')).status).toBe(200);
  });
});

test.describe('Admin · usuários', () => {
  test('banir um usuário logado em outro navegador derruba a sessão dele', async ({ page, browser }, testInfo) => {
    // Outro contexto = outro navegador: a Bianca está logada lá.
    const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const bianca = await other.newPage();
    await bianca.addInitScript(() => {
      (window as unknown as { __NOVA_E2E__: boolean }).__NOVA_E2E__ = true;
    });
    await bianca.goto('/');
    await loginAs(bianca, 'u_bianca');
    await bianca.goto('/minha-conta');
    await expect(bianca.getByRole('button', { name: 'Conta de Bianca' })).toBeVisible();
    expect((await api<{ id: string }>(bianca, 'GET', '/me')).data.id).toBe('u_bianca');

    // A Ana encontra a Bianca na lista e aplica o banimento, com motivo.
    await loginAs(page, 'u_ana');
    await page.goto('/admin/usuarios');
    await waitForScreen(page, 'Usuários');
    await page.getByRole('searchbox', { name: 'Buscar usuário' }).fill('bianca');
    await expect(row(page, 'bianca@novaarena.gg')).toHaveCount(1);
    await page.getByRole('link', { name: 'Abrir o perfil de Bianca' }).click();
    await waitForScreen(page, 'Perfil de Bianca');
    await expect(page.getByRole('heading', { name: 'IDs de jogo' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Banir', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Banir Bianca' });
    await dialog.getByRole('button', { name: 'Banir conta' }).click();
    await expect(dialog.getByText('Informe o motivo')).toBeVisible();
    await dialog.getByLabel('Motivo').fill('Uso de hack comprovado em três partidas');
    await dialog.getByRole('button', { name: 'Banir conta' }).click();
    await expect(page.getByText('Conta banida', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sanction')).toContainText('Banimento');
    await expect(page.getByTestId('sanction')).toContainText('Em vigor');
    await expect(page.getByRole('button', { name: 'Banir', exact: true })).toBeDisabled();

    // No protótipo o "servidor" é o banco simulado de cada navegador. Para os dois navegadores
    // enxergarem o mesmo servidor, o estado gravado pela Ana é levado para o navegador da Bianca —
    // é o que a API real faz sozinha. A sessão dela (guardada à parte) continua intacta.
    const serverState = await page.evaluate(() => localStorage.getItem('nova-mock-db'));
    expect(serverState).not.toBeNull();
    await bianca.evaluate((state) => localStorage.setItem('nova-mock-db', state as string), serverState);
    expect(await bianca.evaluate(() => localStorage.getItem('nova-mock-session'))).toBe('u_bianca');

    // Na próxima requisição a sessão já não vale: a conta cai para visitante e a área logada pede login.
    await bianca.reload();
    await expect(bianca).toHaveURL(/\/entrar\?next=%2Fminha-conta/);
    await expect(bianca.getByRole('button', { name: 'Conta de Bianca' })).toHaveCount(0);
    await waitForApp(bianca);
    expect((await api(bianca, 'GET', '/me')).data).toBeNull();
    expect((await api(bianca, 'POST', '/auth/dev-login', { userId: 'u_bianca' })).status).toBe(403);
    await other.close();
  });

  test('suspender publica o evento de sessão revogada, que chega às outras abas', async ({ page, context }) => {
    // Mesma máquina, duas abas: a aba do Lucas fica aberta enquanto a Ana (na outra aba) o suspende.
    // O tempo real do protótipo atravessa abas do mesmo navegador (BroadcastChannel).
    const lucas = await context.newPage();
    await lucas.addInitScript(() => {
      (window as unknown as { __NOVA_E2E__: boolean }).__NOVA_E2E__ = true;
    });
    await lucas.goto('/');
    await loginAs(lucas, 'u_lucas');
    await lucas.reload();
    await expect(lucas.getByRole('button', { name: 'Conta de Lucas' })).toBeVisible();
    await lucas.evaluate(() => {
      const w = window as unknown as { __events: unknown[] };
      w.__events = [];
      new BroadcastChannel('nova-realtime').onmessage = (e) => w.__events.push(e.data);
    });

    await loginAs(page, 'u_ana');
    const res = await api(page, 'POST', '/admin/users/u_lucas/sanctions', { type: 'SUSPENSION', days: 3, reason: 'Ofensas repetidas no chat' });
    expect(res.status).toBe(201);

    // O evento chega no canal privado do usuário, sem dado sensível: só o tipo e o motivo genérico.
    await expect.poll(() => lucas.evaluate(() => (window as unknown as { __events: unknown[] }).__events)).toContainEqual({ channel: 'user:u_lucas', event: { type: 'session.revoked', reason: 'SUSPENDED' } });
    // E a conta não entra mais até o fim do prazo.
    expect((await api<{ code: string }>(page, 'POST', '/auth/dev-login', { userId: 'u_lucas' })).data.code).toBe('ACCOUNT_SUSPENDED');
    await lucas.close();
  });

  // Pendente fora deste painel: `shared/realtime/RealtimeProvider.tsx` (UserChannel) trata o evento com
  // `qc.clear()` seguido de `qc.setQueryData(keys.me, null)`. Os componentes já montados continuam presos
  // à consulta removida e a tela não muda até recarregar. Quando isso for corrigido, tire o `fixme`.
  test('a tela aberta em outra aba volta para visitante sem recarregar quando a sessão é revogada', async ({ page, context }) => {
    const lucas = await context.newPage();
    await lucas.goto('/');
    await loginAs(lucas, 'u_lucas');
    await lucas.reload();
    await expect(lucas.getByRole('button', { name: 'Conta de Lucas' })).toBeVisible();
    await loginAs(page, 'u_ana');
    await api(page, 'POST', '/admin/users/u_lucas/sanctions', { type: 'SUSPENSION', days: 3, reason: 'Ofensas repetidas no chat' });
    await expect(lucas.getByRole('button', { name: 'Conta de Lucas' })).toHaveCount(0);
    await expect(lucas.getByRole('link', { name: 'Criar conta' })).toBeVisible();
  });

  test('lista com filtros e advertência em lote', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/usuarios');
    await waitForScreen(page, 'Usuários');
    await expect(page.getByText('Página 1 de 4 · 66 no total')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByLabel('Papel', { exact: true }).selectOption('ORGANIZER');
    await expect(row(page, 'camila@novaarena.gg')).toHaveCount(1);
    await expect(row(page, 'diego@novaarena.gg')).toHaveCount(1);
    await expect(row(page, 'bianca@novaarena.gg')).toHaveCount(0);

    // Seleciona os dois e adverte de uma vez.
    for (const email of ['camila@novaarena.gg', 'diego@novaarena.gg']) await row(page, email).getByRole('checkbox').check();
    await expect(page.getByText('2 selecionados')).toBeVisible();
    await page.getByRole('button', { name: 'Advertir' }).click();
    const dialog = page.getByRole('dialog', { name: 'Advertir 2 contas' });
    await expect(dialog).toContainText('Camila, Diego');
    await dialog.getByLabel('Motivo').fill('Divulgação fora das regras nos comunicados');
    await dialog.getByRole('button', { name: 'Advertir', exact: true }).click();
    await expect(page.getByText('Advertência aplicada para 2 de 2 contas')).toBeVisible();

    const camila = await api<{ sanctions: Array<{ type: string; reason: string }> }>(page, 'GET', '/admin/users/u_camila');
    expect(camila.data.sanctions).toHaveLength(1);
    expect(camila.data.sanctions[0]).toMatchObject({ type: 'WARNING', reason: 'Divulgação fora das regras nos comunicados' });
  });
});

test.describe('Admin · campeonatos e auditoria', () => {
  test('troca o responsável de um campeonato e a auditoria mostra o antes e o depois', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/campeonatos');
    await waitForScreen(page, 'Campeonatos');
    const copa = row(page, 'Copa Nova FF — Squad');
    await expect(copa).toContainText('Camila');
    // Rascunhos também aparecem na visão global.
    await expect(row(page, 'Torneio Relâmpago CR 2v2')).toContainText('Rascunho');
    await expectNoHorizontalScroll(page);

    await copa.getByRole('button', { name: 'Ações de Copa Nova FF — Squad' }).click();
    await page.getByRole('menuitem', { name: 'Trocar o responsável' }).click();
    const dialog = page.getByRole('dialog', { name: 'Trocar o responsável' });
    await dialog.getByRole('searchbox', { name: 'Novo responsável' }).fill('die');
    await dialog.getByRole('list', { name: 'Resultados para Novo responsável' }).getByRole('button', { name: /Diego/ }).click();
    // Sem motivo não troca.
    await dialog.getByRole('button', { name: 'Trocar responsável' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Informe o motivo');
    await dialog.getByLabel('Motivo').fill('Camila pediu para sair da organização');
    await dialog.getByRole('button', { name: 'Trocar responsável' }).click();
    await expect(page.getByText('Responsável trocado', { exact: true })).toBeVisible();
    await expect(copa).toContainText('Diego');
    await dismissToasts(page);

    await page.goto('/admin/auditoria');
    await waitForScreen(page, 'Auditoria');
    const entry = page.getByTestId('audit-entry').filter({ hasText: 'Responsável do campeonato trocado' });
    await expect(entry).toContainText('Ana');
    await expect(entry).toContainText('Campeonato: Copa Nova FF — Squad');
    await expect(entry).toContainText('Motivo: Camila pediu para sair da organização');
    // Antes e depois lado a lado, campo a campo.
    const diff = entry.getByRole('table', { name: 'Antes e depois, campo a campo' });
    const responsible = diff.getByRole('row', { name: /^Responsável/ });
    await expect(responsible.getByRole('cell').nth(0)).toHaveText('Camila');
    await expect(responsible.getByRole('cell').nth(1)).toHaveText('Diego');
    await expect(responsible.getByRole('rowheader')).toContainText('alterado');
    await expectNoHorizontalScroll(page);

    // Filtro por ação.
    await page.getByLabel('Ação', { exact: true }).selectOption('TOURNAMENT_OWNER_CHANGED');
    await expect(page.getByText('1 registro(s) com estes filtros')).toBeVisible();
    await page.getByLabel('Ação', { exact: true }).selectOption('FLAG_CHANGED');
    await expect(page.getByText('Nenhum registro combina com estes filtros.')).toBeVisible();
  });

  test('exporta a auditoria em CSV com os filtros da tela', async ({ page }) => {
    await loginAs(page, 'u_ana');
    expect((await api(page, 'PATCH', '/admin/tournaments/tn_efootball', { featured: true })).status).toBe(200);
    expect((await api(page, 'POST', '/admin/users/u_p20/sanctions', { type: 'WARNING', reason: 'Nick ofensivo' })).status).toBe(201);
    await page.goto('/admin/auditoria');
    await waitForScreen(page, 'Auditoria');
    await page.getByLabel('Recurso', { exact: true }).selectOption('Tournament');
    await expect(page.getByText('1 registro(s) com estes filtros')).toBeVisible();

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^auditoria-\d{4}-\d{2}-\d{2}\.csv$/);
    const path = await download.path();
    const bytes = await readFile(path);
    // BOM UTF-8 + ponto e vírgula: abre certo no Excel em pt-BR.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.subarray(3).toString('utf8').trim().split('\r\n');
    expect(lines[0]).toBe('Data (UTC);Quem;Ação;Recurso;Tipo;ID do recurso;Campeonato;Motivo;Antes;Depois;IP');
    // Só o registro do filtro (campeonato), não a advertência.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(';Ana;Destaque na home alterado;Copa eFootball Iniciantes;Campeonato;tn_efootball;');
    await expect(page.getByText('Auditoria exportada')).toBeVisible();
  });

  test('cancela com confirmação e motivo, e destrava a chave de uma fase', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/campeonatos');
    await waitForScreen(page, 'Campeonatos');

    // Destravar chave: a Liga CR tem partidas concluídas.
    const liga = row(page, 'Liga Semanal Clash Royale 1v1');
    await liga.getByRole('button', { name: /^Ações de Liga Semanal/ }).click();
    await page.getByRole('menuitem', { name: 'Destravar chave' }).click();
    const unlock = page.getByRole('dialog', { name: 'Destravar chave' });
    await expect(unlock.getByRole('list', { name: 'Fases travadas' })).toContainText('Mata-mata');
    await unlock.getByLabel('Motivo').fill('Erro de inscrição descoberto');
    await unlock.getByRole('button', { name: /^Destravar/ }).click();
    await expect(unlock.getByText('Nenhuma fase deste campeonato está com a chave travada.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unlock).toHaveCount(0);
    await dismissToasts(page);

    // Cancelar: precisa digitar o nome e informar o motivo.
    const solo = row(page, 'FF Solo Rush');
    await solo.getByRole('button', { name: 'Ações de FF Solo Rush' }).click();
    await page.getByRole('menuitem', { name: 'Cancelar campeonato' }).click();
    const cancel = page.getByRole('dialog', { name: 'Cancelar campeonato' });
    await expect(cancel.getByRole('button', { name: 'Cancelar campeonato' })).toBeDisabled();
    await cancel.getByLabel('Motivo do cancelamento').fill('Evento duplicado');
    await cancel.getByLabel(/Para confirmar, digite/).fill('FF Solo Rush');
    await cancel.getByRole('button', { name: 'Cancelar campeonato' }).click();
    await expect(page.getByText('Campeonato cancelado', { exact: true })).toBeVisible();
    await expect(solo).toContainText('Cancelado');
  });
});

test.describe('Admin · comunicados, configurações e saúde', () => {
  test('cria um aviso de manutenção e ele aparece no topo do site', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/comunicados');
    await waitForScreen(page, 'Comunicados');
    const form = page.getByRole('form', { name: 'Novo comunicado' });
    await form.getByLabel('Tipo').selectOption('MAINTENANCE');
    await form.getByLabel('Título').fill('Atualização do sistema');
    await form.getByLabel('Mensagem').fill('O site fica fora do ar por cerca de uma hora.');
    // Manutenção sem início e fim não passa.
    await form.getByRole('button', { name: 'Agendar aviso' }).click();
    await expect(form.getByText('Informe quando a manutenção começa')).toBeVisible();
    await form.getByLabel('Início da manutenção').fill(await localInput(page, 60));
    await form.getByLabel('Fim da manutenção').fill(await localInput(page, 120));
    await form.getByRole('button', { name: 'Agendar aviso' }).click();
    await expect(page.getByText('Aviso de manutenção agendado')).toBeVisible();
    await expect(page.getByTestId('announcement').filter({ hasText: 'Atualização do sistema' })).toContainText('No ar (aviso prévio)');
    await expectNoHorizontalScroll(page);

    // No site, o aviso aparece no topo (começa em menos de 48 h) e pode ser dispensado antes de começar.
    await page.goto('/');
    await waitForApp(page);
    const banner = page.getByTestId('site-banner');
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toContainText('Manutenção programada: Atualização do sistema');
    await expect(banner).toContainText('O site fica fora do ar por cerca de uma hora.');
    const box = await banner.boundingBox();
    expect(box?.y ?? 99).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    await banner.getByRole('button', { name: 'Dispensar o aviso: Atualização do sistema' }).click();
    await expect(page.getByTestId('site-banner')).toHaveCount(0);
    // Dispensar vale para o navegador: ao voltar, continua dispensado.
    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole('link', { name: 'Campeonatos' }).first()).toBeVisible();
    await expect(page.getByTestId('site-banner')).toHaveCount(0);

    // Visitante (outro navegador não dispensou): vê o aviso.
    expect((await api<unknown[]>(page, 'GET', '/site/banner')).data).toHaveLength(1);
  });

  test('desligar uma flag no painel muda GET /api/v1/site/flags; Admin só lê as configurações', async ({ page }) => {
    // Admin comum: tudo somente leitura.
    await loginAs(page, 'u_ana');
    await page.goto('/admin/configuracoes');
    await waitForScreen(page, 'Configurações');
    await expect(page.getByTestId('settings-readonly')).toContainText('Somente leitura');
    await expect(page.getByLabel('Nome do site')).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Ranking' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Salvar configurações' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Super Admin: edita e liga/desliga recursos.
    await loginAs(page, 'u_rafael');
    await page.reload();
    await waitForScreen(page, 'Configurações');
    await expect(page.getByTestId('settings-readonly')).toHaveCount(0);
    expect((await api<Record<string, boolean>>(page, 'GET', '/site/flags')).data).toMatchObject({ ranking: true, pushNotifications: false });

    const ranking = page.getByRole('switch', { name: 'Ranking' });
    await expect(ranking).toBeChecked();
    await ranking.click();
    await expect(page.getByText('Ranking: desligado')).toBeVisible();
    await expect(ranking).not.toBeChecked();
    expect((await api<Record<string, boolean>>(page, 'GET', '/site/flags')).data.ranking).toBe(false);
    await dismissToasts(page);

    // Configurações: muda o e-mail de suporte e os termos; a página pública reflete.
    await page.getByLabel('E-mail de suporte').fill('ajuda@novaarena.gg');
    await page.getByLabel('Termos de uso').fill('<h2>Termos de Uso</h2><p>Jogue limpo.</p><script>window.__xss = 1</script><p onclick="alert(1)">Sem trapaça.</p>');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('Configurações salvas')).toBeVisible();

    await page.goto('/termos');
    await expect(page.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible();
    const content = page.getByTestId('legal-content');
    await expect(content).toContainText('Jogue limpo.');
    await expect(content).toContainText('Sem trapaça.');
    // O HTML é sanitizado: nada de script nem de atributo de evento.
    expect(await content.locator('script').count()).toBe(0);
    expect(await content.locator('[onclick]').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.getByRole('link', { name: 'ajuda@novaarena.gg' })).toBeVisible();
    await page.goto('/privacidade');
    await expect(page.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeVisible();
    await expect(page.getByTestId('legal-content')).toContainText('Guardamos só o que é preciso');

    // A mudança ficou na auditoria.
    await page.goto('/admin/auditoria');
    await waitForScreen(page, 'Auditoria');
    await expect(page.getByTestId('audit-entry').filter({ hasText: 'Recurso ligado ou desligado' })).toContainText('Rafael');
    await expect(page.getByTestId('audit-entry').filter({ hasText: 'Configurações alteradas' })).toContainText('ajuda@novaarena.gg');
  });

  test('saúde do sistema avisa que os valores são simulados e atualiza', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/saude');
    await waitForScreen(page, 'Saúde do sistema');
    await expect(page.getByTestId('health-simulated')).toContainText('Valores simulados no protótipo.');
    await expect(page.getByText('Todos os serviços funcionando')).toBeVisible();
    for (const key of ['database', 'cache', 'queues', 'realtime', 'storage', 'email']) await expect(page.getByTestId(`service-${key}`)).toContainText('Funcionando');
    await expect(page.getByText('Versão publicada')).toBeVisible();
    await expect(page.getByText('protótipo', { exact: true })).toBeVisible();
    const requested = page.waitForRequest((r) => r.url().endsWith('/api/v1/admin/health'));
    await page.getByRole('button', { name: 'Atualizar' }).click();
    await requested;
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Admin · moderação', () => {
  test('ação rápida: advertir o denunciado fecha a denúncia', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/moderacao');
    await waitForScreen(page, 'Moderação');
    const report = page.getByTestId('report').filter({ hasText: 'Suspeita de jogador usando emulador' });
    await expect(report).toContainText('Aberta');
    await expect(report).toContainText('Trapaça');
    await expect(report.getByRole('link', { name: /Squad Charlie/ })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await report.getByRole('button', { name: 'Advertir' }).click();
    const dialog = page.getByRole('dialog', { name: /^Advertir / });
    await dialog.getByLabel('Motivo').fill('Uso de emulador em treino, primeira ocorrência');
    await dialog.getByRole('button', { name: 'Advertir', exact: true }).click();
    await expect(page.getByText('Advertência aplicada', { exact: true })).toBeVisible();
    await expect(report).toContainText('Tratada');
    await expect(report).toContainText('Decisão de Ana: Advertência aplicada: Uso de emulador em treino, primeira ocorrência');
    await expect(report.getByRole('button', { name: 'Advertir' })).toHaveCount(0);

    await page.getByRole('tab', { name: /Disputas escaladas/ }).click();
    await expect(page.getByText('Nenhuma disputa escalada')).toBeVisible();
  });
});

test.describe('Admin · acesso e responsividade', () => {
  test('participante em /admin/usuarios vê a página 403', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/admin/usuarios');
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
    await expect(page.getByText('Erro 403')).toBeAttached();
    await expect(page.getByRole('heading', { level: 1, name: 'Usuários' })).toHaveCount(0);
    expect((await api(page, 'GET', '/admin/users')).status).toBe(403);
  });

  test('visitante em /admin vai para o login', async ({ page }) => {
    await page.goto('/admin/auditoria');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fadmin%2Fauditoria/);
  });

  const SCREENS: Array<[string, string | RegExp]> = [
    ['/admin', 'Dashboard'],
    ['/admin/usuarios', 'Usuários'],
    ['/admin/usuarios/u_lucas', 'Perfil de Lucas'],
    ['/admin/administradores', 'Administradores'],
    ['/admin/organizadores', 'Organizadores'],
    ['/admin/organizadores?aba=pedidos', 'Organizadores'],
    ['/admin/campeonatos', 'Campeonatos'],
    ['/admin/moderacao', 'Moderação'],
    ['/admin/auditoria', 'Auditoria'],
    ['/admin/comunicados', 'Comunicados'],
    ['/admin/configuracoes', 'Configurações'],
    ['/admin/saude', 'Saúde do sistema'],
    ['/minha-conta/seguranca', 'Segurança'],
    ['/termos', 'Termos de Uso'],
  ];

  test('nenhuma tela do painel tem rolagem horizontal', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'u_rafael');
    // Conteúdo de verdade em cada tela: registros de auditoria, comunicado, convite e uma sanção.
    await api(page, 'POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: 'u_diego', reason: 'Troca combinada com a organização do campeonato, a pedido da antiga responsável' });
    await api(page, 'POST', '/admin/announcements', { title: 'Novidade na Arena com um título bem comprido para testar', body: 'Ranking por jogo no ar para todo mundo.', kind: 'BANNER', audience: 'ALL', gameId: null, startsAt: null, endsAt: null });
    await api(page, 'POST', '/admin/invites', { role: 'ADMIN', validity: '7d', maxUses: 10 });
    await api(page, 'POST', '/admin/users/u_lucas/sanctions', { type: 'WARNING', reason: 'Linguagem ofensiva no chat da partida, registrada em três prints' });

    for (const [path, heading] of SCREENS) {
      await page.goto(path);
      await waitForScreen(page, heading);
      await expectNoHorizontalScroll(page);
    }
  });
});
