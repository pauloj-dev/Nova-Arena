/**
 * Equipe do campeonato por link e reabertura das inscrições (RN-16), em 1440 px e 360 px.
 *
 * - A organizadora (Camila) gera um link de moderador na aba Equipe; a participante (Bianca), que não tem o papel de
 *   organizadora, abre o link, aceita e cai na gestão do campeonato. Depois acha o campeonato em "Meus campeonatos".
 * - Com as inscrições encerradas, a organizadora reabre informando a nova data de fechamento.
 */
import { expect, loginAs, mid, test, waitForApp } from './fixtures';

const COPA = 'tn_copa_ff';

/** `YYYY-MM-DDTHH:mm` no fuso dos testes (America/Sao_Paulo), como o campo `datetime-local` espera. */
function localInput(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test('a organizadora convida por link e a participante entra na equipe do campeonato', async ({ page }) => {
  await loginAs(page, 'u_camila');
  await page.goto(`/organizador/campeonatos/${mid(COPA)}?aba=equipe`);
  await waitForApp(page);

  const card = page.getByTestId('staff-invite-links');
  await expect(card.getByRole('heading', { name: 'Convidar por link' })).toBeVisible();
  await card.getByLabel('Papel').selectOption('MODERATOR');
  await card.getByLabel('Validade').selectOption('24h');
  await card.getByRole('button', { name: 'Gerar link' }).click();
  const linkField = card.getByLabel('Link do convite');
  await expect(linkField).toHaveValue(/\/equipe\/convite\/[0-9a-f]{48}$/);
  const link = await linkField.inputValue();
  await expect(card.getByTestId('staff-invite').first()).toContainText('Moderador · 0 de 1 uso');

  // Outra pessoa abre o link.
  await loginAs(page, 'u_bianca');
  await page.goto(new URL(link).pathname);
  await waitForApp(page);
  await expect(page.getByRole('heading', { name: 'Convite para a equipe do campeonato' })).toBeVisible();
  await expect(page.getByText('Camila convidou você para ser moderador de Copa Nova FF — Squad.')).toBeVisible();
  await page.getByRole('button', { name: 'Aceitar e entrar na equipe' }).click();

  await expect(page).toHaveURL(new RegExp(`/organizador/campeonatos/${mid(COPA)}$`));
  await expect(page.getByRole('heading', { name: 'Copa Nova FF — Squad', level: 1 })).toBeVisible();

  // E acha o campeonato depois, mesmo sem ser organizadora.
  await page.goto('/minha-conta/campeonatos');
  await waitForApp(page);
  const section = page.getByRole('region', { name: 'Campeonatos que eu ajudo a organizar' });
  await expect(section.getByTestId('staff-tournament')).toContainText('Copa Nova FF — Squad');
  await expect(section.getByTestId('staff-tournament')).toContainText('Moderador');
  await section.getByRole('link', { name: 'Gerenciar Copa Nova FF — Squad' }).click();
  await expect(page).toHaveURL(new RegExp(`/organizador/campeonatos/${mid(COPA)}$`));

  // O link era de um uso: já foi usado.
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { name: 'Este convite já foi usado' })).toBeVisible();
});

test('com as inscrições encerradas, a organizadora reabre com a nova data de fechamento', async ({ page }) => {
  await loginAs(page, 'u_camila');
  await page.goto(`/organizador/campeonatos/${mid(COPA)}`);
  await waitForApp(page);
  const actions = page.getByRole('group', { name: 'Ações do campeonato' });
  await actions.getByRole('button', { name: 'Encerrar inscrições' }).click();
  await expect(actions.getByRole('button', { name: 'Reabrir inscrições' })).toBeVisible();

  await actions.getByRole('button', { name: 'Reabrir inscrições' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reabrir as inscrições?' });
  await dialog.getByRole('button', { name: 'Reabrir inscrições' }).click();
  await expect(dialog.getByText('Escolha quando as inscrições vão fechar.')).toBeVisible();

  await dialog.getByLabel(/Novo fechamento das inscrições/).fill(localInput(new Date(Date.now() + 2 * 24 * 3600_000)));
  await dialog.getByRole('button', { name: 'Reabrir inscrições' }).click();
  await expect(dialog).toBeHidden();
  await expect(actions.getByRole('button', { name: 'Encerrar inscrições' })).toBeVisible();
});
