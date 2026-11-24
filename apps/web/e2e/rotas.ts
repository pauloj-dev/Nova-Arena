/**
 * Catálogo de telas para as revisões de R1 (responsividade #103, áreas de toque #104 e acessibilidade #106).
 * Cada entrada é uma tela que alguém de verdade abre, com o usuário de demonstração que a vê e um texto que
 * confirma que ela terminou de carregar. Telas novas entram aqui para serem revisadas automaticamente.
 */
import type { Page } from '@playwright/test';
import { expect, loginAs, waitForApp, type DemoUser } from './fixtures';

export type Area = 'publica' | 'participante' | 'organizador' | 'admin';

export interface Tela {
  /** Nome curto, usado no título do teste e no nome do screenshot. */
  nome: string;
  path: string;
  area: Area;
  /** Quem abre a tela. Sem usuário: visitante. */
  como?: DemoUser;
  /** Uma das telas principais (fluxos P0): entra também na medição das áreas de toque. */
  principal?: boolean;
}

export const TELAS: Tela[] = [
  // Públicas
  { nome: 'inicio', path: '/', area: 'publica', principal: true },
  { nome: 'campeonatos', path: '/campeonatos', area: 'publica', principal: true },
  { nome: 'campeonato-visao-geral', path: '/c/copa-nova-ff-squad', area: 'publica', principal: true },
  { nome: 'campeonato-regulamento', path: '/c/copa-nova-ff-squad?aba=regulamento', area: 'publica' },
  { nome: 'campeonato-inscritos', path: '/c/copa-nova-ff-squad?aba=inscritos', area: 'publica' },
  { nome: 'campeonato-comunicados', path: '/c/copa-nova-ff-squad?aba=comunicados', area: 'publica' },
  { nome: 'campeonato-chave', path: '/c/liga-semanal-clash-royale?aba=chave', area: 'publica', principal: true },
  { nome: 'campeonato-partidas', path: '/c/liga-semanal-clash-royale?aba=partidas', area: 'publica' },
  { nome: 'campeonato-resultados', path: '/c/liga-semanal-clash-royale?aba=resultados', area: 'publica' },
  { nome: 'campeonato-tabela-suico', path: '/c/open-8-ball-pool?aba=chave', area: 'publica' },
  { nome: 'campeonato-arte', path: '/c/open-8-ball-pool/arte', area: 'publica' },
  { nome: 'evento', path: '/e/festival-free-fire', area: 'publica' },
  { nome: 'jogos', path: '/jogos', area: 'publica' },
  { nome: 'jogo', path: '/jogos/free-fire', area: 'publica' },
  { nome: 'ranking', path: '/ranking', area: 'publica' },
  { nome: 'perfil-publico', path: '/u/Bianca', area: 'publica' },
  { nome: 'termos', path: '/termos', area: 'publica' },
  { nome: 'privacidade', path: '/privacidade', area: 'publica' },
  { nome: 'ajuda', path: '/ajuda', area: 'publica' },
  { nome: 'contato', path: '/contato', area: 'publica' },
  { nome: 'manutencao', path: '/manutencao', area: 'publica' },
  { nome: 'sem-conexao', path: '/sem-conexao', area: 'publica' },
  { nome: 'nao-encontrada', path: '/pagina-que-nao-existe', area: 'publica' },
  { nome: 'entrar', path: '/entrar', area: 'publica', principal: true },
  { nome: 'cadastro', path: '/cadastro', area: 'publica', principal: true },
  { nome: 'recuperar-senha', path: '/recuperar-senha', area: 'publica' },
  { nome: 'redefinir-senha', path: '/redefinir-senha?token=token-de-exemplo', area: 'publica' },
  { nome: 'verificar-email', path: '/verificar-email', area: 'publica' },
  { nome: 'confirmar-email', path: '/confirmar-email?token=token-de-exemplo', area: 'publica' },
  { nome: 'convite-papel', path: '/convite/convite-organizador-valido', area: 'publica' },
  { nome: 'convite-squad', path: '/squads/convite/ALFA42', area: 'publica' },
  { nome: 'convite-equipe', path: '/equipe/convite/convite-equipe-valido', area: 'publica' },

  // Participante
  { nome: 'minha-conta', path: '/minha-conta', area: 'participante', como: 'u_bianca', principal: true },
  { nome: 'meus-campeonatos', path: '/minha-conta/campeonatos', area: 'participante', como: 'u_bianca', principal: true },
  { nome: 'meus-squads', path: '/minha-conta/squads', area: 'participante', como: 'u_lucas' },
  { nome: 'squad', path: '/minha-conta/squads/t_alfa', area: 'participante', como: 'u_lucas', principal: true },
  { nome: 'preferencias-notificacao', path: '/minha-conta/notificacoes', area: 'participante', como: 'u_bianca' },
  { nome: 'minhas-denuncias', path: '/minha-conta/denuncias', area: 'participante', como: 'u_bianca' },
  { nome: 'seguranca', path: '/minha-conta/seguranca', area: 'participante', como: 'u_bianca' },
  { nome: 'notificacoes', path: '/notificacoes', area: 'participante', como: 'u_bianca' },
  { nome: 'campeonato-partidas-jogadora', path: '/c/liga-semanal-clash-royale?aba=partidas', area: 'participante', como: 'u_bianca', principal: true },
  { nome: 'disputa-inexistente', path: '/disputas/dp_nao_existe', area: 'participante', como: 'u_lucas' },

  // Organizador
  { nome: 'painel-organizador', path: '/organizador', area: 'organizador', como: 'u_camila', principal: true },
  { nome: 'organizador-campeonatos', path: '/organizador/campeonatos', area: 'organizador', como: 'u_camila' },
  { nome: 'criar-campeonato', path: '/organizador/novo', area: 'organizador', como: 'u_camila', principal: true },
  { nome: 'modelos', path: '/organizador/modelos', area: 'organizador', como: 'u_camila' },
  { nome: 'organizador-eventos', path: '/organizador/eventos', area: 'organizador', como: 'u_camila' },
  { nome: 'criar-evento', path: '/organizador/eventos/novo', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-evento', path: '/organizador/eventos/ev_festival_ff', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-resumo', path: '/organizador/campeonatos/tn_copa_ff', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-inscricoes', path: '/organizador/campeonatos/tn_copa_ff?aba=inscricoes', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-fases', path: '/organizador/campeonatos/tn_liga_cr?aba=fases', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-partidas', path: '/organizador/campeonatos/tn_liga_cr?aba=partidas', area: 'organizador', como: 'u_camila', principal: true },
  { nome: 'gestao-validacao', path: '/organizador/campeonatos/tn_liga_cr?aba=validacao', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-equipe', path: '/organizador/campeonatos/tn_liga_cr?aba=equipe', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-comunicados', path: '/organizador/campeonatos/tn_liga_cr?aba=comunicados', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-auditoria', path: '/organizador/campeonatos/tn_liga_cr?aba=auditoria', area: 'organizador', como: 'u_camila' },
  { nome: 'gestao-pagina', path: '/organizador/campeonatos/tn_copa_ff?aba=pagina', area: 'organizador', como: 'u_camila' },
  { nome: 'editar-campeonato', path: '/organizador/campeonatos/tn_copa_ff/editar', area: 'organizador', como: 'u_camila' },

  // Admin
  { nome: 'admin-dashboard', path: '/admin', area: 'admin', como: 'u_ana', principal: true },
  { nome: 'admin-usuarios', path: '/admin/usuarios', area: 'admin', como: 'u_ana', principal: true },
  { nome: 'admin-usuario', path: '/admin/usuarios/u_bianca', area: 'admin', como: 'u_ana' },
  { nome: 'admin-administradores', path: '/admin/administradores', area: 'admin', como: 'u_rafael' },
  { nome: 'admin-organizadores', path: '/admin/organizadores', area: 'admin', como: 'u_ana' },
  { nome: 'admin-campeonatos', path: '/admin/campeonatos', area: 'admin', como: 'u_ana' },
  { nome: 'admin-jogos', path: '/admin/jogos', area: 'admin', como: 'u_ana' },
  { nome: 'admin-jogo', path: '/admin/jogos/g_freefire', area: 'admin', como: 'u_ana' },
  { nome: 'admin-jogo-novo', path: '/admin/jogos/novo', area: 'admin', como: 'u_ana' },
  { nome: 'admin-moderacao', path: '/admin/moderacao', area: 'admin', como: 'u_ana' },
  { nome: 'admin-auditoria', path: '/admin/auditoria', area: 'admin', como: 'u_ana' },
  { nome: 'admin-comunicados', path: '/admin/comunicados', area: 'admin', como: 'u_ana' },
  { nome: 'admin-configuracoes', path: '/admin/configuracoes', area: 'admin', como: 'u_ana' },
  { nome: 'admin-saude', path: '/admin/saude', area: 'admin', como: 'u_ana' },
];

/** Os 5 tamanhos do plano (R1) e a paisagem de um celular comum. */
export const TAMANHOS = [
  { nome: '360', width: 360, height: 780 },
  { nome: '480', width: 480, height: 860 },
  { nome: '768', width: 768, height: 1024 },
  { nome: '1024', width: 1024, height: 768 },
  { nome: '1440', width: 1440, height: 900 },
  { nome: 'paisagem', width: 780, height: 360 },
] as const;

/**
 * Abre a tela e espera ela assentar: API simulada no ar, nenhum esqueleto de carregamento e nenhuma consulta
 * pendente. Não depende do conteúdo, para valer igual em todas as telas.
 */
export async function abrir(page: Page, tela: Tela): Promise<void> {
  if (tela.como) await loginAs(page, tela.como);
  await page.goto(tela.path);
  await waitForApp(page);
  await esperarAssentar(page);
}

export async function esperarAssentar(page: Page): Promise<void> {
  await expect(page.locator('main').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[aria-busy="true"], [role="status"][aria-label^="Carregando"], [data-loading="true"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Fontes e imagens mudam a largura do texto: só mede depois de tudo pronto.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Quanto a página passa da largura da janela (0 = sem rolagem horizontal). */
export function excessoHorizontal(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Quais elementos passam da borda direita (para a mensagem de erro dizer o culpado). */
export function culpadosDoExcesso(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    /** Algum ancestral com rolagem própria corta o elemento (e ele não escapa por ser `fixed`/`absolute`). */
    const clipped = (el: HTMLElement): boolean => {
      // Um `absolute` só é cortado a partir do bloco que o contém (o `offsetParent`).
      const start = getComputedStyle(el).position === 'absolute' ? (el.offsetParent as HTMLElement | null) : el.parentElement;
      for (let a = start; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= limit + 1) return true;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limit + 1) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      // Só o mais externo de cada galho: se o pai já passa, o filho não acrescenta informação.
      const parent = el.parentElement;
      if (parent && parent.getBoundingClientRect().right > limit + 1 && getComputedStyle(el).position !== 'absolute') continue;
      if (clipped(el)) continue;
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' ? `.${el.className.split(/\s+/).slice(0, 4).join('.')}` : '';
      out.push(`${el.tagName.toLowerCase()}${id}${cls} (direita ${Math.round(r.right)} > ${limit}) "${(el.textContent ?? '').trim().slice(0, 40)}"`);
      if (out.length >= 5) break;
    }
    return out;
  });
}
