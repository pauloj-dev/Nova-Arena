/**
 * Conteúdo da central de ajuda (issue 110). Escrito para o jogador e para o organizador, seguindo as regras do
 * PRD (§6 e §10) e de `docs/regras-de-negocio.md`. Cada pergunta tem um `id` estável, usado como âncora (`/ajuda#id`),
 * para que telas e e-mails possam apontar direto para a resposta.
 */
import type { Locale } from '@/shared/i18n/config';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

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

/**
 * Monta a central de ajuda no idioma pedido. O texto fica no catálogo da área (`messages/pt-BR.json`, trecho `faq`);
 * aqui ficam só a estrutura, as âncoras e os links.
 */
export function getFaq(locale?: Locale): FaqSection[] {
  const t = getT(messages, 'faq', locale);
  return [
    {
      id: 'inscricao',
      titulo: t('inscricao.titulo'),
      descricao: t('inscricao.descricao'),
      itens: [
        {
          id: 'como-me-inscrever',
          pergunta: t('inscricao.comoMeInscrever.pergunta'),
          resposta: [t('inscricao.comoMeInscrever.resposta1'), t('inscricao.comoMeInscrever.resposta2')],
          link: { href: '/campeonatos', texto: t('inscricao.comoMeInscrever.link') },
        },
        {
          id: 'inscrever-squad',
          pergunta: t('inscricao.inscreverSquad.pergunta'),
          resposta: [t('inscricao.inscreverSquad.resposta1'), t('inscricao.inscreverSquad.resposta2')],
          link: { href: '/minha-conta/squads', texto: t('inscricao.inscreverSquad.link') },
        },
        {
          id: 'lista-de-espera',
          pergunta: t('inscricao.listaDeEspera.pergunta'),
          resposta: [t('inscricao.listaDeEspera.resposta1')],
        },
        {
          id: 'cancelar-inscricao',
          pergunta: t('inscricao.cancelarInscricao.pergunta'),
          resposta: [t('inscricao.cancelarInscricao.resposta1')],
          link: { href: '/minha-conta/campeonatos', texto: t('inscricao.cancelarInscricao.link') },
        },
      ],
    },
    {
      id: 'check-in',
      titulo: t('checkIn.titulo'),
      descricao: t('checkIn.descricao'),
      itens: [
        {
          id: 'o-que-e-check-in',
          pergunta: t('checkIn.oQueECheckIn.pergunta'),
          resposta: [t('checkIn.oQueECheckIn.resposta1'), t('checkIn.oQueECheckIn.resposta2')],
        },
        {
          id: 'check-in-squad',
          pergunta: t('checkIn.checkInSquad.pergunta'),
          resposta: [t('checkIn.checkInSquad.resposta1')],
        },
        {
          id: 'perdi-o-check-in',
          pergunta: t('checkIn.perdiOCheckIn.pergunta'),
          resposta: [t('checkIn.perdiOCheckIn.resposta1')],
        },
      ],
    },
    {
      id: 'wo',
      titulo: t('wo.titulo'),
      descricao: t('wo.descricao'),
      itens: [
        {
          id: 'o-que-e-wo',
          pergunta: t('wo.oQueEWo.pergunta'),
          resposta: [t('wo.oQueEWo.resposta1')],
        },
        {
          id: 'desistencia',
          pergunta: t('wo.desistencia.pergunta'),
          resposta: [t('wo.desistencia.resposta1'), t('wo.desistencia.resposta2')],
        },
      ],
    },
    {
      id: 'resultados-e-disputas',
      titulo: t('resultadosEDisputas.titulo'),
      descricao: t('resultadosEDisputas.descricao'),
      itens: [
        {
          id: 'enviar-resultado',
          pergunta: t('resultadosEDisputas.enviarResultado.pergunta'),
          resposta: [t('resultadosEDisputas.enviarResultado.resposta1'), t('resultadosEDisputas.enviarResultado.resposta2')],
        },
        {
          id: 'contestar',
          pergunta: t('resultadosEDisputas.contestar.pergunta'),
          resposta: [t('resultadosEDisputas.contestar.resposta1'), t('resultadosEDisputas.contestar.resposta2')],
        },
        {
          id: 'denunciar',
          pergunta: t('resultadosEDisputas.denunciar.pergunta'),
          resposta: [t('resultadosEDisputas.denunciar.resposta1')],
          link: { href: '/minha-conta/denuncias', texto: t('resultadosEDisputas.denunciar.link') },
        },
      ],
    },
    {
      id: 'organizar',
      titulo: t('organizar.titulo'),
      descricao: t('organizar.descricao'),
      itens: [
        {
          id: 'virar-organizador',
          pergunta: t('organizar.virarOrganizador.pergunta'),
          resposta: [t('organizar.virarOrganizador.resposta1'), t('organizar.virarOrganizador.resposta2')],
          link: { href: '/minha-conta#conta-organizador', texto: t('organizar.virarOrganizador.link') },
        },
        {
          id: 'limites-do-organizador',
          pergunta: t('organizar.limitesDoOrganizador.pergunta'),
          resposta: [t('organizar.limitesDoOrganizador.resposta1')],
        },
        {
          id: 'equipe-do-evento',
          pergunta: t('organizar.equipeDoEvento.pergunta'),
          resposta: [t('organizar.equipeDoEvento.resposta1')],
        },
      ],
    },
    {
      id: 'conta-e-app',
      titulo: t('contaEApp.titulo'),
      descricao: t('contaEApp.descricao'),
      itens: [
        {
          id: 'instalar-app',
          pergunta: t('contaEApp.instalarApp.pergunta'),
          resposta: [t('contaEApp.instalarApp.resposta1'), t('contaEApp.instalarApp.resposta2')],
        },
        {
          id: 'manutencao',
          pergunta: t('contaEApp.manutencao.pergunta'),
          resposta: [t('contaEApp.manutencao.resposta1')],
          link: { href: '/manutencao', texto: t('contaEApp.manutencao.link') },
        },
      ],
    },
  ];
}

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
