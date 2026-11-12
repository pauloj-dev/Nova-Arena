import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

/**
 * Squads e inscrições (F1.9, issues #28 e #29), em 1440 px e 360 px.
 * Seed: Lucas é capitão do Squad Alfa (com u_p01, u_p02 e u_p03); a Copa Nova FF é de squad (4 + 1 reserva);
 * a Copa eFootball Iniciantes está cheia (8/8) com u_p38 e u_p39 na lista de espera.
 */
// Quase todo teste aqui troca de usuário e recarrega a página várias vezes (cada papel vê uma coisa):
// o limite padrão de 60 s fica curto quando a máquina está ocupada.
test.describe.configure({ timeout: 120_000 });

const COPA_FF = '/c/copa-nova-ff-squad';
const EFOOTBALL = '/c/copa-efootball-iniciantes';

/** Troca de usuário e abre a página já com a sessão nova. */
async function visitAs(page: Page, user: DemoUser, path: string): Promise<void> {
  await loginAs(page, user);
  await page.goto(path);
  await waitForApp(page);
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Inscrição', exact: true });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function confirmParticipation(page: Page, user: DemoUser): Promise<void> {
  await visitAs(page, user, COPA_FF);
  await panel(page).getByRole('button', { name: 'Confirmar participação' }).click();
  await expect(panel(page).getByRole('button', { name: 'Confirmar participação' })).toHaveCount(0);
}

test.describe('squads', () => {
  test('capitão cria squad, convida por apelido e por código, membros aceitam; o squad é inscrito e só confirma quando o mínimo confirma', async ({ page }) => {
    test.slow();

    // Capitão cria o squad.
    await visitAs(page, 'u_lucas', '/minha-conta/squads');
    await expect(page.getByRole('heading', { level: 1, name: 'Meus squads' })).toBeVisible();
    await page.getByRole('button', { name: 'Criar squad' }).first().click();
    await page.getByLabel('Nome do squad').fill('Squad Ômega');
    await page.getByRole('textbox', { name: 'Tag', exact: true }).fill('omg');
    await page.getByRole('dialog').getByRole('button', { name: 'Criar squad' }).click();
    await expect(page).toHaveURL(/\/minha-conta\/squads\/t_/);
    await expect(page.getByRole('heading', { level: 1, name: 'Squad Ômega' })).toBeVisible();
    const squadUrl = new URL(page.url()).pathname;
    const roster = page.getByRole('list', { name: 'Membros do Squad Ômega' });
    await expect(roster.getByRole('listitem')).toHaveCount(1);
    await expect(roster.getByRole('listitem').filter({ hasText: 'Lucas' })).toContainText('Capitão');

    // Convite por apelido.
    await page.getByLabel('Apelido do jogador').fill('kauepro');
    await page.getByRole('button', { name: 'Convidar KauePro1', exact: true }).click();
    const pending = page.getByRole('region', { name: 'Convites pendentes' });
    await expect(pending.getByRole('listitem').filter({ hasText: 'KauePro1' })).toContainText('Aguardando resposta');
    await expect(pending.getByRole('listitem').filter({ hasText: 'KauePro1' })).toContainText('Expira');

    // Convite por link/código.
    await page.getByRole('button', { name: 'Gerar link de convite' }).click();
    const code = (await page.getByTestId('invite-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await expect(page.getByLabel('Link do convite')).toHaveValue(new RegExp(`/squads/convite/${code}$`));
    await expectNoHorizontalScroll(page);

    // Convidado por apelido aceita em "Convites recebidos".
    await visitAs(page, 'u_p01', '/minha-conta/squads');
    await page.getByRole('button', { name: 'Aceitar o convite do Squad Ômega' }).click();
    await expect(page).toHaveURL(new RegExp(`${squadUrl}$`));
    await expect(page.getByRole('list', { name: 'Membros do Squad Ômega' }).getByRole('listitem')).toHaveCount(2);

    // Outro membro abre o link do convite.
    await visitAs(page, 'u_p02', `/squads/convite/${code}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Squad Ômega' })).toBeVisible();
    await expect(page.getByText('Convite válido até')).toBeVisible();
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(new RegExp(`${squadUrl}$`));

    // O terceiro digita só o código.
    await visitAs(page, 'u_p03', '/minha-conta/squads');
    await page.getByLabel('Código do convite').fill(code.toLowerCase());
    await page.getByRole('button', { name: 'Ver convite' }).click();
    await expect(page).toHaveURL(new RegExp(`/squads/convite/${code}$`));
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page.getByRole('list', { name: 'Membros do Squad Ômega' }).getByRole('listitem')).toHaveCount(4);

    // Capitão inscreve o squad na Copa Nova FF: fica aguardando membros.
    await visitAs(page, 'u_lucas', COPA_FF);
    await expect(page.getByRole('heading', { level: 1, name: 'Copa Nova FF — Squad' })).toBeVisible();
    await panel(page).getByLabel('Squad que vai jogar').selectOption({ label: 'Squad Ômega [OMG] · 4 jogadores' });
    await panel(page).getByRole('checkbox', { name: /Li e aceito o regulamento/ }).check();
    await panel(page).getByRole('button', { name: 'Inscrever squad' }).click();
    await expect(panel(page).getByText('Aguardando membros')).toBeVisible();
    await expect(panel(page).getByTestId('registration-status-text')).toContainText('Faltam 3 membros confirmarem');
    const lineup = panel(page).getByRole('list', { name: 'Elenco do Squad Ômega' });
    await expect(lineup.getByRole('listitem').filter({ hasText: 'Lucas' })).toContainText('Confirmou');
    await expect(lineup.getByRole('listitem').filter({ hasText: 'KauePro1' })).toContainText('Falta confirmar');
    await expectNoHorizontalScroll(page);

    // Dois membros confirmam: ainda falta um.
    await confirmParticipation(page, 'u_p01');
    await expect(panel(page).getByTestId('registration-status-text')).toContainText('Faltam 2 membros confirmarem');
    await confirmParticipation(page, 'u_p02');
    await expect(panel(page).getByText('Aguardando membros')).toBeVisible();
    await expect(panel(page).getByTestId('registration-status-text')).toContainText('Falta 1 membro confirmar');

    // "Meus campeonatos" do capitão mostra a pendência.
    await visitAs(page, 'u_lucas', '/minha-conta/campeonatos');
    const entry = page.getByRole('listitem').filter({ hasText: 'Copa Nova FF — Squad' });
    await expect(entry).toContainText('Aguardando membros');
    await expect(entry).toContainText('Falta 1 membro confirmar');

    // O mínimo (4) confirma: inscrição confirmada.
    await confirmParticipation(page, 'u_p03');
    await expect(panel(page).getByText('Confirmada', { exact: true })).toBeVisible();
    await expect(panel(page).getByTestId('registration-status-text')).toHaveText('O squad está confirmado no campeonato.');

    await visitAs(page, 'u_lucas', '/minha-conta/campeonatos');
    await expect(page.getByRole('listitem').filter({ hasText: 'Copa Nova FF — Squad' })).toContainText('Confirmada');
  });

  test('lista "Meus squads": coroa de capitão, número de membros e estado vazio', async ({ page }) => {
    await visitAs(page, 'u_lucas', '/minha-conta/squads');
    const card = page.getByRole('listitem').filter({ hasText: 'Squad Alfa' });
    await expect(card).toContainText('4 membros');
    await expect(card).toContainText('Você é o capitão');
    await expect(card).toContainText('1 convite pendente');
    await expectNoHorizontalScroll(page);

    await visitAs(page, 'u_p01', '/minha-conta/squads');
    await expect(page.getByRole('listitem').filter({ hasText: 'Squad Alfa' })).not.toContainText('Você é o capitão');

    await visitAs(page, 'u_camila', '/minha-conta/squads');
    await expect(page.getByRole('heading', { name: 'Você ainda não está em nenhum squad' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar squad' })).toHaveCount(2);
  });

  test('criar, editar e excluir squad: tag repetida mostra o erro no campo; logo que não é imagem é recusada', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/minha-conta/squads');
    await page.getByRole('button', { name: 'Criar squad' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Arquivo da logo do squad').setInputFiles({ name: 'regulamento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(dialog.getByText('Escolha uma imagem PNG, JPG, WebP ou GIF.')).toBeVisible();
    await dialog.getByLabel('Nome do squad').fill('Alfa Cover');
    await dialog.getByRole('textbox', { name: 'Tag', exact: true }).fill('alfa');
    await dialog.getByRole('button', { name: 'Criar squad' }).click();
    await expect(dialog.getByText('Já existe um squad com esta tag. Escolha outra.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Tag', exact: true }).fill('COVER');
    await dialog.getByRole('button', { name: 'Criar squad' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alfa Cover' })).toBeVisible();

    // Editar: o nome muda na hora.
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('dialog').getByLabel('Nome do squad').fill('Alfa Tributo');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alfa Tributo' })).toBeVisible();

    // Excluir pede o nome do squad e volta para a lista.
    await page.getByRole('button', { name: 'Excluir squad' }).click();
    const confirm = page.getByRole('dialog', { name: 'Excluir squad' });
    await expect(confirm.getByRole('button', { name: 'Excluir squad' })).toBeDisabled();
    await confirm.getByRole('textbox').fill('Alfa Tributo');
    await confirm.getByRole('button', { name: 'Excluir squad' }).click();
    await expect(page).toHaveURL(/\/minha-conta\/squads$/);
    await expect(page.getByRole('heading', { name: 'Você ainda não está em nenhum squad' })).toBeVisible();
  });

  test('convite expirado é recusado; código inexistente e visitante têm mensagem clara', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/squads/convite/VELHO1');
    await expect(page.getByText('Este convite expirou. Peça um novo convite ao capitão do squad.')).toBeVisible();
    await expect(page.getByText('Expirado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
    // A API também recusa, mesmo que a tela seja burlada.
    const refused = await page.evaluate(async () => {
      const res = await fetch('/api/v1/team-invites/VELHO1/accept', { method: 'POST' });
      return { status: res.status, body: (await res.json()) as { code?: string } };
    });
    expect(refused.status).toBe(410);
    expect(refused.body.code).toBe('INVITE_EXPIRED');

    await page.goto('/squads/convite/ZZZZ99');
    await expect(page.getByRole('heading', { name: 'Convite não encontrado' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('visitante vê a prévia do convite e é levado ao login, com volta para o convite', async ({ page }) => {
    await page.goto('/squads/convite/ALFA42');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Squad Alfa' })).toBeVisible();
    await expect(page.getByText('4 membros')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar para aceitar' })).toHaveAttribute('href', '/entrar?next=%2Fsquads%2Fconvite%2FALFA42');
    await page.getByRole('link', { name: 'Entrar para aceitar' }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fsquads%2Fconvite%2FALFA42/);
    await page.getByLabel('E-mail').fill('bianca@novaarena.gg');
    await page.getByLabel('Senha').fill('arena1234');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/squads\/convite\/ALFA42$/);
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(/\/minha-conta\/squads\/t_alfa$/);
    await expect(page.getByRole('list', { name: 'Membros do Squad Alfa' }).getByRole('listitem')).toHaveCount(5);
  });

  test('capitão transfere a capitania', async ({ page }) => {
    await visitAs(page, 'u_lucas', '/minha-conta/squads/t_alfa');
    await expect(page.getByRole('heading', { name: 'Convidar jogadores' })).toBeVisible();
    await page.getByRole('button', { name: 'Ações de KauePro1' }).click();
    await page.getByRole('menuitem', { name: 'Passar a capitania' }).click();
    const dialog = page.getByRole('dialog', { name: 'Passar a capitania' });
    await expect(dialog).toContainText('KauePro1 vira o capitão do Squad Alfa');
    await dialog.getByRole('button', { name: 'Passar a capitania' }).click();
    await expect(dialog).toHaveCount(0);

    const roster = page.getByRole('list', { name: 'Membros do Squad Alfa' });
    await expect(roster.getByRole('listitem').filter({ hasText: 'KauePro1' })).toContainText('Capitão');
    await expect(roster.getByRole('listitem').filter({ hasText: 'Lucas' })).not.toContainText('Capitão');
    // Quem deixou de ser capitão perde o painel de convite e as ações dos outros membros.
    await expect(page.getByRole('heading', { name: 'Convidar jogadores' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ações de KauePro1' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();

    await visitAs(page, 'u_p01', '/minha-conta/squads/t_alfa');
    await expect(page.getByRole('heading', { name: 'Convidar jogadores' })).toBeVisible();
  });

  test('capitão não exclui squad com inscrição ativa', async ({ page }) => {
    await visitAs(page, 'u_lucas', '/minha-conta/squads/t_alfa');
    await page.getByRole('button', { name: 'Excluir squad' }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir squad' });
    await dialog.getByRole('textbox').fill('Squad Alfa');
    await dialog.getByRole('button', { name: 'Excluir squad' }).click();
    await expect(page.getByText('O squad está inscrito em Arena Contra Squad 4v4. Cancele a inscrição antes de excluir o squad.')).toBeVisible();
  });
});

test.describe('inscrições', () => {
  test('jogador em dois squads no mesmo campeonato é barrado', async ({ page }) => {
    // PedroZz4 é capitão do Squad Bravo, já inscrito na Copa Nova FF, e entra também no Squad Alfa.
    await visitAs(page, 'u_p04', '/squads/convite/ALFA42');
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(/\/minha-conta\/squads\/t_alfa$/);

    await visitAs(page, 'u_lucas', COPA_FF);
    await expect(panel(page).getByLabel('Squad que vai jogar')).toHaveValue('t_alfa');
    await panel(page).getByRole('checkbox', { name: /Li e aceito o regulamento/ }).check();
    await panel(page).getByRole('button', { name: 'Inscrever squad' }).click();
    await expect(panel(page).getByTestId('registration-error')).toContainText('PedroZz4 já está inscrito neste campeonato pelo squad Squad Bravo');
    await expect(panel(page).getByTestId('registration-error')).toContainText('Um jogador não pode estar em dois squads no mesmo campeonato');
    await expect(panel(page).getByText('Aguardando membros')).toHaveCount(0);
  });

  test('sem aceitar o regulamento a inscrição não sai', async ({ page }) => {
    await visitAs(page, 'u_lucas', COPA_FF);
    await panel(page).getByRole('button', { name: 'Inscrever squad' }).click();
    await expect(panel(page).getByTestId('registration-error')).toContainText('marque que você leu e aceita o regulamento');
  });

  test('solo com vagas esgotadas entra na lista de espera e vê a posição', async ({ page }) => {
    await visitAs(page, 'u_bianca', EFOOTBALL);
    await expect(panel(page).getByTestId('waitlist-offer')).toContainText('3º da fila');
    await panel(page).getByRole('checkbox', { name: /Li e aceito o regulamento/ }).check();
    await panel(page).getByRole('button', { name: 'Entrar na lista de espera' }).click();
    await expect(panel(page).getByText('Lista de espera', { exact: true })).toBeVisible();
    await expect(panel(page).getByTestId('registration-status-text')).toContainText('Você está na lista de espera, na 3ª posição');
    await expectNoHorizontalScroll(page);

    await page.goto('/minha-conta/campeonatos');
    const entry = page.getByRole('listitem').filter({ hasText: 'Copa eFootball Iniciantes' });
    await expect(entry).toContainText('Lista de espera');
    await expect(entry).toContainText('3º na lista de espera');
  });

  test('cancelar uma inscrição promove o primeiro da lista de espera', async ({ page }) => {
    await visitAs(page, 'u_p30', EFOOTBALL);
    await expect(panel(page).getByText('Confirmada', { exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Cancelar inscrição' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar inscrição' });
    await expect(dialog).toContainText('a vaga passa para o primeiro da lista de espera');
    await dialog.getByRole('button', { name: 'Cancelar inscrição' }).click();
    await expect(dialog).toHaveCount(0);
    // Quem cancelou volta a ver o formulário (agora para a lista de espera).
    await expect(panel(page).getByRole('button', { name: 'Entrar na lista de espera' })).toBeVisible();

    // O primeiro da fila (u_p38) foi promovido; o segundo (u_p39) passou a ser o primeiro.
    await visitAs(page, 'u_p38', EFOOTBALL);
    await expect(panel(page).getByText('Confirmada', { exact: true })).toBeVisible();
    await expect(panel(page).getByTestId('registration-status-text')).toHaveText('Você está confirmado no campeonato.');
    await visitAs(page, 'u_p39', EFOOTBALL);
    await expect(panel(page).getByTestId('registration-status-text')).toContainText('na 1ª posição');
  });

  test('falta de ID do jogo mostra o aviso com o caminho para resolver', async ({ page }) => {
    // A Bianca não tem ID de Free Fire no seed.
    await visitAs(page, 'u_bianca', COPA_FF);
    await expect(panel(page).getByText('Falta o seu ID de Free Fire.')).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'Informar meu ID de Free Fire' })).toHaveAttribute('href', '/minha-conta');
    await expect(panel(page).getByRole('button', { name: 'Inscrever squad' })).toHaveCount(0);
  });

  test('organizadora não se inscreve no próprio campeonato', async ({ page }) => {
    await visitAs(page, 'u_camila', COPA_FF);
    await expect(panel(page).getByText('Você organiza este campeonato')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: /Inscrever/ })).toHaveCount(0);
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/v1/tournaments/copa-nova-ff-squad/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptRules: true, teamId: 't_alfa' }) });
      return { status: r.status, body: (await r.json()) as { code?: string } };
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWN_TOURNAMENT');
  });

  test('visitante é levado ao login; inscrições ainda não abertas e encerradas têm o estado certo', async ({ page }) => {
    await page.goto(EFOOTBALL);
    await waitForApp(page);
    await expect(panel(page).getByRole('link', { name: 'Entrar para pegar um lugar na fila' })).toHaveAttribute('href', '/entrar?next=%2Fc%2Fcopa-efootball-iniciantes');

    await page.goto(COPA_FF);
    await expect(panel(page).getByRole('link', { name: 'Entrar para se inscrever' })).toHaveAttribute('href', '/entrar?next=%2Fc%2Fcopa-nova-ff-squad');

    await page.goto('/c/ff-solo-rush');
    await expect(panel(page).getByText('As inscrições ainda não abriram')).toBeVisible();
    await expect(panel(page).getByText(/Elas abrem em .+ · horário de Brasília\./)).toBeVisible();

    await page.goto('/c/liga-semanal-clash-royale');
    await expect(panel(page).getByText('Inscrições encerradas', { exact: true })).toBeVisible();
  });

  test('membro de squad inscrito vê a inscrição do squad e não pode cancelar', async ({ page }) => {
    await visitAs(page, 'u_p02', '/c/arena-contra-squad-4v4');
    await expect(panel(page).getByText('Confirmada', { exact: true })).toBeVisible();
    await expect(panel(page).getByText('Squad Alfa')).toBeVisible();
    await expect(panel(page).getByText('Só o capitão pode cancelar a inscrição do squad.')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Cancelar inscrição' })).toHaveCount(0);
  });

  test('"Meus campeonatos" separa atuais e histórico, com link para o campeonato', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/minha-conta/campeonatos');
    await expect(page.getByRole('heading', { level: 1, name: 'Meus campeonatos' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Em andamento e próximos' })).toHaveAttribute('aria-selected', 'true');
    const current = page.getByRole('tabpanel').getByRole('listitem').filter({ hasText: 'Liga Semanal Clash Royale 1v1' });
    await expect(current).toContainText('Confirmada');
    await expect(current).toContainText('horário de Brasília');
    await expect(current.getByRole('link', { name: 'Liga Semanal Clash Royale 1v1' })).toHaveAttribute('href', '/c/liga-semanal-clash-royale');
    await expect(page.getByRole('tabpanel').getByText('Open 8 Ball Pool')).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByRole('tabpanel').getByRole('listitem').filter({ hasText: 'Open 8 Ball Pool' })).toBeVisible();

    // Sem inscrições: estado vazio com o caminho para explorar.
    await visitAs(page, 'u_camila', '/minha-conta/campeonatos');
    await expect(page.getByRole('heading', { name: 'Você não está inscrito em nenhum campeonato' })).toBeVisible();
    await expect(page.getByRole('tabpanel').getByRole('link', { name: 'Explorar campeonatos' })).toHaveAttribute('href', '/campeonatos');
  });

  test('visitante em "Meus squads" e "Meus campeonatos" é levado ao login', async ({ page }) => {
    await page.goto('/minha-conta/squads');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fminha-conta%2Fsquads/);
    await page.goto('/minha-conta/campeonatos');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fminha-conta%2Fcampeonatos/);
  });
});
