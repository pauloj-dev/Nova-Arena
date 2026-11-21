/**
 * Conteúdo da central de ajuda (issue 110). Escrito para o jogador e para o organizador, seguindo as regras do
 * PRD (§6 e §10) e de `docs/regras-de-negocio.md`. Cada pergunta tem um `id` estável, usado como âncora (`/ajuda#id`),
 * para que telas e e-mails possam apontar direto para a resposta.
 */
export interface FaqItem {
  id: string;
  pergunta: string;
  /** Parágrafos da resposta (texto simples). */
  resposta: string[];
  /** Ação sugerida no fim da resposta. */
  link?: { href: string; texto: string };
}

export interface FaqSection {
  id: string;
  titulo: string;
  descricao: string;
  itens: FaqItem[];
}

export const FAQ: FaqSection[] = [
  {
    id: 'inscricao',
    titulo: 'Inscrição',
    descricao: 'Como entrar num campeonato, sozinho ou com o seu squad.',
    itens: [
      {
        id: 'como-me-inscrever',
        pergunta: 'Como me inscrevo num campeonato?',
        resposta: [
          'Abra o campeonato em Campeonatos e toque em "Inscrever-se" (ou "Inscrever squad", nos campeonatos por equipe). O botão só aparece enquanto as inscrições estão abertas.',
          'Antes, cadastre no seu perfil a conta do jogo pedida (por exemplo, o ID do Free Fire). Sem ela a inscrição não é aceita, porque é com esse ID que a organização confere as partidas.',
        ],
        link: { href: '/campeonatos', texto: 'Ver campeonatos com inscrições abertas' },
      },
      {
        id: 'inscrever-squad',
        pergunta: 'Como inscrevo o meu squad?',
        resposta: [
          'Só o capitão inscreve o squad. Crie o squad em Minha conta → Squads, convide os membros pelo link ou pelo código e escolha quem joga no campeonato.',
          'A inscrição fica "Aguardando membros" até cada titular confirmar a participação. Quando todos confirmam, ela vale.',
        ],
        link: { href: '/minha-conta/squads', texto: 'Abrir meus squads' },
      },
      {
        id: 'lista-de-espera',
        pergunta: 'As vagas acabaram. E agora?',
        resposta: [
          'Se a organização ligou a lista de espera, você entra nela. Quando alguém cancela, a vaga vai para o primeiro da fila e você recebe uma notificação.',
        ],
      },
      {
        id: 'cancelar-inscricao',
        pergunta: 'Posso cancelar a minha inscrição?',
        resposta: [
          'Sim, até o check-in abrir (ou até a organização travar o elenco, o que vier primeiro). Depois disso, sair do campeonato conta como desistência e as próximas partidas viram W.O.',
        ],
        link: { href: '/minha-conta/campeonatos', texto: 'Ver meus campeonatos' },
      },
    ],
  },
  {
    id: 'check-in',
    titulo: 'Check-in',
    descricao: 'Confirmar presença antes da partida.',
    itens: [
      {
        id: 'o-que-e-check-in',
        pergunta: 'O que é o check-in e quando faço?',
        resposta: [
          'É a confirmação de que você está pronto para jogar. O botão "Fazer check-in" aparece na sua partida só durante a janela de check-in, que a organização define (por exemplo, de 30 a 10 minutos antes do horário).',
          'Você recebe uma notificação quando a janela abre. Todos os horários aparecem no seu fuso.',
        ],
      },
      {
        id: 'check-in-squad',
        pergunta: 'No squad, quem faz o check-in?',
        resposta: ['Normalmente basta o capitão. Se a organização exigir, cada titular faz o próprio check-in; a partida mostra quem já confirmou.'],
      },
      {
        id: 'perdi-o-check-in',
        pergunta: 'Perdi o check-in. O que acontece?',
        resposta: [
          'Quem não faz o check-in exigido até o fim da janela leva W.O. naquela partida. Se foi um problema da plataforma, fale com a organização do campeonato pelo contato da página dele.',
        ],
      },
    ],
  },
  {
    id: 'wo',
    titulo: 'W.O.',
    descricao: 'Vitória e derrota por ausência.',
    itens: [
      {
        id: 'o-que-e-wo',
        pergunta: 'O que é W.O.?',
        resposta: [
          'W.O. é a vitória de quem compareceu quando o adversário não aparece, não faz check-in ou desiste. Vale vitória pelo placar configurado no campeonato (por exemplo, 3 a 0 ou 2 coroas) e 0 kills nas quedas de Battle Royale.',
        ],
      },
      {
        id: 'desistencia',
        pergunta: 'E se eu desistir no meio do campeonato?',
        resposta: [
          'No mata-mata, a partida atual e as próximas viram W.O. para os adversários; os resultados que já valeram continuam.',
          'Em pontos corridos e grupos, se você jogou menos da metade das partidas, todos os seus resultados são anulados. Se jogou metade ou mais, as partidas que faltam viram W.O.',
        ],
      },
    ],
  },
  {
    id: 'resultados-e-disputas',
    titulo: 'Resultados e disputas',
    descricao: 'Enviar o placar, contestar e acompanhar a análise.',
    itens: [
      {
        id: 'enviar-resultado',
        pergunta: 'Como envio o resultado da partida?',
        resposta: [
          'Quando o campeonato permite, o capitão (ou o jogador, no solo) envia o placar com um print da tela final pela própria partida. O adversário confirma ou contesta; com a confirmação, a organização valida e a tabela se atualiza sozinha.',
          'Os pontos são sempre calculados pela plataforma a partir das estatísticas: ninguém digita a pontuação final.',
        ],
      },
      {
        id: 'contestar',
        pergunta: 'O resultado enviado está errado. Como contesto?',
        resposta: [
          'Na partida, toque em "Contestar" e explique o que aconteceu, de preferência com um print. A partida fica "Em disputa" até a organização decidir; você acompanha a conversa e a decisão pela página da disputa.',
          'Se a organização não resolver, ela pode levar a disputa para a moderação da Nova Arena.',
        ],
      },
      {
        id: 'denunciar',
        pergunta: 'Como denuncio um jogador, um squad ou uma trapaça?',
        resposta: [
          'Use "Denunciar" no perfil do jogador, no squad ou na partida. A moderação recebe a denúncia, e você acompanha o andamento em Minha conta → Denúncias.',
        ],
        link: { href: '/minha-conta/denuncias', texto: 'Ver minhas denúncias' },
      },
    ],
  },
  {
    id: 'organizar',
    titulo: 'Organizar campeonatos',
    descricao: 'Para quem quer criar e conduzir os próprios campeonatos.',
    itens: [
      {
        id: 'virar-organizador',
        pergunta: 'Como viro organizador?',
        resposta: [
          'Em Minha conta, na seção "Quero ser organizador", conte por que você quer organizar campeonatos. O pedido vai para a administração da Nova Arena, e a resposta aparece ali mesmo e nas suas notificações.',
          'Também é possível entrar por um convite de organizador enviado pela equipe.',
        ],
        link: { href: '/minha-conta#conta-organizador', texto: 'Pedir para ser organizador' },
      },
      {
        id: 'limites-do-organizador',
        pergunta: 'Quantos campeonatos posso organizar ao mesmo tempo?',
        resposta: [
          'Até 3 campeonatos ativos ao mesmo tempo (publicados, com inscrições, em check-in, em andamento ou pausados). Organizadores verificados podem ter até 10. Rascunhos, cancelados e finalizados não contam.',
        ],
      },
      {
        id: 'equipe-do-evento',
        pergunta: 'Posso dividir a organização com outras pessoas?',
        resposta: ['Sim. Na gestão do campeonato, aba Equipe, convide co-organizadores e moderadores para lançar resultados e cuidar das disputas com você.'],
      },
    ],
  },
  {
    id: 'conta-e-app',
    titulo: 'Conta e aplicativo',
    descricao: 'Instalação, notificações e manutenção.',
    itens: [
      {
        id: 'instalar-app',
        pergunta: 'Dá para instalar a Nova Arena no celular?',
        resposta: [
          'Sim. No Android (Chrome), use o botão "Instalar app" no rodapé ou o menu do navegador → "Instalar app". No iPhone (Safari), toque em Compartilhar → "Adicionar à Tela de Início".',
          'O app instalado abre em tela cheia e avisa quando há uma versão nova.',
        ],
      },
      {
        id: 'manutencao',
        pergunta: 'Como fico sabendo de uma manutenção?',
        resposta: ['Toda manutenção programada é avisada no topo do site com pelo menos 48 horas de antecedência, com início e fim no seu fuso.'],
        link: { href: '/manutencao', texto: 'Ver a situação do serviço' },
      },
    ],
  },
];

/** Busca simples: todas as palavras precisam aparecer na pergunta ou na resposta (sem acento, sem caixa). */
export function filterFaq(sections: FaqSection[], query: string): FaqSection[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map((section) => ({
      ...section,
      itens: section.itens.filter((item) => {
        const text = normalize([item.pergunta, ...item.resposta].join(' '));
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((section) => section.itens.length > 0);
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
