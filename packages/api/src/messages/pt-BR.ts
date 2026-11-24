/**
 * Textos das notificações em pt-BR (site, e-mail e push), fora do código dos módulos (issue #108, ADR-0004).
 * Mesmo formato de `packages/email/src/messages.pt-BR.ts`: texto fixo é string; texto com variável é função.
 * Os `detail` dos erros da API (Problem) ficam no próprio módulo (ADR-0004).
 */
type SanctionType = 'WARNING' | 'SUSPENSION' | 'BAN';

/** Um campeonato em curso que mudou de responsável (RN-09). */
interface OrphanOutcomeText {
  name: string;
  outcome: 'TRANSFERRED' | 'PAUSED';
  newOwnerNickname: string | null;
}

export const messages = {
  results: {
    posted: {
      title: (corrected: boolean) => (corrected ? 'Resultado corrigido' : 'Resultado lançado'),
      body: (match: string, tournament: string) => `${match} · ${tournament}`,
    },
    walkoverLoser: {
      title: 'Você levou W.O.',
      body: (match: string, tournament: string) => `O check-in de ${match} não foi feito a tempo em ${tournament}.`,
    },
    walkoverWinner: {
      title: 'Vitória por W.O.',
      body: (match: string, tournament: string) => `Seu adversário não fez check-in em ${match} de ${tournament}.`,
    },
    walkoverApplied: {
      title: 'W.O. aplicado',
      body: (match: string, tournament: string) => `${match} · ${tournament}`,
    },
  },

  competition: {
    bracket: {
      title: (stage: string | null) => (stage !== null ? `Você está na fase "${stage}"` : 'A chave saiu!'),
      body: (tournament: string) => `${tournament}: confira seus confrontos.`,
    },
    eliminated: {
      title: 'Fim da linha neste campeonato',
      body: (stage: string, tournament: string) => `Você não avançou da fase "${stage}" em ${tournament}. Valeu pela participação!`,
    },
    disqualified: {
      title: 'Você foi desclassificado',
      body: (tournament: string, reason: string) => `${tournament}: ${reason}`,
    },
    finished: {
      title: (tournament: string) => `${tournament} terminou`,
      body: (champion: string | undefined) => `Campeão: ${champion ?? '—'}. Veja o resultado final.`,
    },
  },

  submissions: {
    toConfirm: {
      title: 'Confirme o resultado da sua partida',
      body: (nickname: string | undefined, match: string, tournament: string) =>
        `${nickname ?? 'Seu adversário'} enviou o placar de ${match} (${tournament}). Você tem 30 minutos para confirmar ou contestar.`,
    },
    opponentConfirmed: {
      title: 'O adversário confirmou o resultado',
      body: (match: string, tournament: string) => `${match} (${tournament}) agora aguarda a validação da organização.`,
    },
    toValidate: {
      title: 'Resultado para validar',
      body: (match: string, tournament: string) => `${match} (${tournament}): os dois lados concordam com o placar enviado.`,
    },
    rejected: {
      title: 'Seu envio de resultado foi recusado',
      body: (match: string, tournament: string, reason: string) => `${match} (${tournament}): ${reason}`,
    },
  },

  disputes: {
    contested: {
      title: 'Seu resultado foi contestado',
      body: (contestant: string | undefined, match: string, tournament: string) =>
        `${contestant ?? 'O adversário'} contestou o placar de ${match} (${tournament}). A organização vai analisar as provas.`,
    },
    opened: {
      title: 'Nova disputa para analisar',
      body: (match: string, tournament: string, contestant: string | undefined, submitter: string | undefined) =>
        `${match} (${tournament}): ${contestant ?? 'o adversário'} contestou o resultado enviado por ${submitter ?? 'um participante'}.`,
    },
    newMessage: {
      title: 'Nova mensagem na disputa',
      body: (nickname: string | undefined, match: string, tournament: string) => `${nickname ?? 'Alguém'} escreveu na disputa de ${match} (${tournament}).`,
    },
    /** Mensagem automática gravada no histórico da disputa quando ela sobe para a administração. */
    escalatedMessage: 'Disputa escalada para a administração da Nova Arena.',
    escalatedToPlayers: {
      title: 'Disputa escalada para a administração',
      body: (match: string, tournament: string) => `A organização passou a decisão sobre ${match} (${tournament}) para a administração da Nova Arena.`,
    },
    escalatedToAdmins: {
      title: 'Disputa escalada para análise',
      body: (match: string, tournament: string) => `${match} (${tournament}) aguarda decisão da administração.`,
    },
    resolved: {
      title: 'Disputa resolvida',
      body: (match: string, tournament: string, resultApplied: boolean) =>
        `${match} (${tournament}): ${resultApplied ? 'o resultado oficial foi lançado.' : 'o resultado enviado foi anulado e a partida aguarda novo resultado.'}`,
    },
  },

  tournaments: {
    /** Comunicado do campeonato: o corpo da notificação corta em 200 caracteres. */
    announcement: {
      title: (tournament: string, title: string) => `${tournament}: ${title}`,
      body: (body: string) => (body.length > 200 ? `${body.slice(0, 197)}…` : body),
    },
    transferredToYou: {
      title: 'Você agora é responsável por um campeonato',
      body: (tournament: string, reason: string) => `A administração passou "${tournament}" para você. Motivo: ${reason}`,
    },
    transferredAway: {
      title: 'Você deixou de ser responsável por um campeonato',
      body: (tournament: string, newOwner: string, reason: string) => `A administração passou "${tournament}" para ${newOwner}. Motivo: ${reason}`,
    },
    /** Comunicado público e evento de tempo real do campeonato cancelado pela administração. */
    cancelledAnnouncement: 'Campeonato cancelado',
    cancelled: {
      title: 'Campeonato cancelado pela administração',
      body: (tournament: string, reason: string) => `${tournament}: ${reason}`,
    },
    /** RN-09: o co-organizador mais antigo assume. */
    successor: {
      title: 'Você agora é responsável por um campeonato',
      body: (tournament: string, previousOwner: string) => `${tournament}: ${previousOwner} deixou a organização e você, como co-organizador mais antigo, assumiu.`,
    },
    /** Equipe do evento (ORG-10): quem entra, muda de papel ou sai é avisado; quem convidou por link sabe quando alguém entrou. */
    staff: {
      added: {
        title: (tournament: string) => `Você entrou na equipe de ${tournament}`,
        body: (by: string, role: string) => `${by} adicionou você como ${role}.`,
      },
      joinedByLink: {
        title: (nickname: string) => `${nickname} entrou na equipe`,
        body: (tournament: string, role: string) => `Aceitou o seu link de convite e agora é ${role} de ${tournament}.`,
      },
      roleChanged: {
        title: (tournament: string) => `Seu papel em ${tournament} mudou`,
        body: (role: string) => `Agora você é ${role} deste campeonato.`,
      },
      removed: {
        title: (tournament: string) => `Você saiu da equipe de ${tournament}`,
        body: (by: string) => `${by} removeu você da equipe do evento.`,
      },
    },
    /** RN-09: aviso aos admins com o que aconteceu com cada campeonato em curso. */
    orphans: {
      title: (paused: number) => (paused > 0 ? `${paused} campeonato(s) sem responsável` : 'Responsável de campeonato trocado'),
      body: (previousOwner: string, outcomes: readonly OrphanOutcomeText[]) =>
        `${previousOwner} deixou de organizar ${outcomes.length} campeonato(s) em curso: ${outcomes.map((o) => (o.outcome === 'PAUSED' ? `${o.name} (pausado)` : `${o.name} (assumido por ${o.newOwnerNickname})`)).join('; ')}.`,
    },
  },

  /** Inscrição, elenco e convite de squad (PRD §12.2). */
  registrations: {
    confirmParticipation: {
      title: (tournament: string) => `Confirme sua participação em ${tournament}`,
      body: (team: string) => `O ${team} se inscreveu e você está no elenco. Confirme na página do campeonato para garantir a vaga do squad.`,
    },
    confirmedSolo: {
      title: 'Inscrição confirmada',
      body: (tournament: string) => `Sua vaga em ${tournament} está garantida.`,
    },
    confirmedTeam: {
      title: 'Inscrição confirmada',
      body: (team: string, tournament: string) => `O ${team} está confirmado em ${tournament}.`,
    },
    rosterAdded: {
      title: (team: string) => `Você entrou no elenco do ${team}`,
      body: (tournament: string, confirmed: boolean) =>
        confirmed ? `A organização escalou você em ${tournament}. Sua participação já está confirmada.` : `Você foi escalado em ${tournament}. Confirme sua participação na página do campeonato.`,
    },
    rosterRemoved: {
      title: (team: string) => `Você saiu do elenco do ${team}`,
      body: (tournament: string) => `Você não está mais no elenco do squad em ${tournament}.`,
    },
    rosterMoved: {
      title: (team: string) => `Você foi remanejado para o ${team}`,
      body: (from: string, tournament: string) => `A organização de ${tournament} tirou você do ${from} e escalou no novo squad.`,
    },
  },

  teams: {
    invite: {
      title: (team: string) => `Convite para o ${team}`,
      body: (captain: string) => `${captain} chamou você para o squad. O convite vale por 72 horas.`,
    },
    joined: {
      title: (team: string) => `Novo jogador no ${team}`,
      body: (nickname: string) => `${nickname} entrou no squad pelo seu convite.`,
    },
  },

  moderation: {
    sanctionTitle: {
      WARNING: 'Você recebeu uma advertência',
      SUSPENSION: 'Sua conta foi suspensa',
      BAN: 'Sua conta foi banida',
    } satisfies Record<SanctionType, string>,
    /** `until`: data final da suspensão já formatada (sem ela, suspensão sem prazo). */
    sanctionBody: (type: SanctionType, reason: string, until: string | null) => `${type === 'SUSPENSION' ? `Suspensão${until ? ` até ${until}` : ''}. ` : ''}Motivo: ${reason}`,
    sanctionLifted: {
      title: 'Sanção removida',
      body: (wasWarning: boolean) =>
        wasWarning ? 'A administração removeu uma advertência da sua conta.' : 'A administração removeu a sanção e a sua conta voltou a ficar ativa.',
    },
    reportHandled: {
      title: (actioned: boolean) => (actioned ? 'Sua denúncia foi analisada' : 'Sua denúncia foi considerada improcedente'),
      body: (target: string, resolution: string | null) => `${target || 'Denúncia'}: ${resolution}`,
    },
    massAdminActions: {
      title: 'Alerta: ações administrativas em massa',
      body: (actor: string | undefined, count: number, what: string, seconds: number) => `${actor ?? 'Um Admin'} fez ${count} ${what} em ${seconds} s. Confira na moderação.`,
    },
  },

  account: {
    passwordReset: {
      title: 'Redefinição de senha',
      body: 'A administração gerou um link para você criar uma senha nova. Se não foi você quem pediu, fale com o suporte.',
    },
    merged: {
      title: 'Contas mescladas',
      body: (source: string) => `A conta ${source} foi mesclada na sua. Inscrições, squads e IDs de jogo agora estão aqui.`,
    },
    twoFactorReset: {
      title: 'Verificação em duas etapas redefinida',
      body: (isAdmin: boolean) =>
        isAdmin
          ? 'A administração redefiniu a sua verificação em duas etapas. Configure de novo para voltar a acessar a área de administração.'
          : 'A administração redefiniu a sua verificação em duas etapas. Você pode configurar de novo quando quiser.',
    },
    dataExportReady: {
      title: 'Seus dados estão prontos para baixar',
      body: 'O arquivo com os seus dados pessoais fica disponível por 7 dias em Minha conta → Privacidade.',
    },
  },

  roles: {
    organizerGranted: {
      title: 'Você agora é organizador',
      body: 'A administração liberou a área de organização para você. Já dá para criar o seu primeiro campeonato.',
    },
    adminGranted: {
      title: 'Você agora é administrador',
      body: 'Para entrar na área de administração, ative a verificação em duas etapas.',
    },
    adminRevoked: {
      title: 'Você não é mais administrador',
      body: (reason: string | null) => (reason ? `Seu acesso à área de administração foi removido. Motivo: ${reason}` : 'Seu acesso à área de administração foi removido.'),
    },
    organizerRevoked: {
      title: 'Você não é mais organizador',
      body: (reason: string | null) =>
        reason ? `A administração removeu o seu acesso à área de organização. Motivo: ${reason}` : 'A administração removeu o seu acesso à área de organização.',
    },
    removalRequested: {
      title: 'Pedido de remoção de administrador',
      body: (requester: string | undefined, target: string) =>
        `${requester ?? 'Um administrador'} pediu a remoção de ${target}, que é administrador há mais tempo. A decisão é sua.`,
    },
    removalDecided: {
      title: (approved: boolean) => (approved ? 'Pedido de remoção aprovado' : 'Pedido de remoção recusado'),
      body: (approved: boolean, target: string) => (approved ? `${target} não é mais administrador.` : `${target} continua como administrador.`),
    },
    organizerRequestApproved: {
      title: 'Pedido de organizador aprovado',
      body: (note: string | null) => (note ? `Você já pode criar campeonatos. Recado da administração: ${note}` : 'Você já pode criar campeonatos na área de organização.'),
    },
    organizerRequestRejected: {
      title: 'Pedido de organizador recusado',
      body: (reason: string | null) => `Motivo: ${reason}. Você pode enviar um novo pedido quando quiser.`,
    },
  },
} as const;
