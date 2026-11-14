/**
 * Textos dos e-mails em pt-BR, fora dos templates (preparado para i18n, issue #108). Escritos para o
 * jogador e o organizador: diretos, dizendo o que fazer e até quando.
 */
export const messages = {
  common: {
    brand: 'NOVA ARENA',
    footer: 'Você recebeu este e-mail porque tem uma conta na Nova Arena, a plataforma de campeonatos de eSports mobile.',
    ignore: 'Se não foi você, é só ignorar este e-mail: nada muda na sua conta.',
    fallbackLink: 'Se o botão não funcionar, copie e cole este endereço no navegador:',
  },
  VERIFY_EMAIL: {
    subject: 'Confirme seu e-mail na Nova Arena',
    preview: 'Falta só confirmar seu e-mail para começar a jogar.',
    heading: (nickname: string) => `Bem-vindo à Nova Arena, ${nickname}!`,
    body: 'Confirme seu e-mail para se inscrever em campeonatos e receber os avisos das suas partidas.',
    action: 'Confirmar e-mail',
    expires: 'O link vale por 24 horas.',
  },
  RESET_PASSWORD: {
    subject: 'Redefinir sua senha da Nova Arena',
    preview: 'Use o link para criar uma senha nova.',
    heading: (nickname: string) => `Oi, ${nickname}`,
    body: 'Recebemos um pedido para redefinir a senha da sua conta. Crie uma senha nova pelo botão abaixo.',
    action: 'Criar senha nova',
    expires: 'O link vale por 1 hora e só pode ser usado uma vez. Ao trocar a senha, você sai de todos os aparelhos.',
  },
  ROLE_INVITE: {
    subject: (role: string) => `Você foi convidado para ser ${role} na Nova Arena`,
    preview: 'Aceite o convite pelo link.',
    heading: (role: string) => `Convite para ${role}`,
    body: (inviter: string, role: string) => `${inviter} convidou você para entrar na Nova Arena como ${role}.`,
    action: 'Ver convite',
    expires: (until: string) => `O convite vale até ${until}.`,
    roles: { ADMIN: 'Administrador', ORGANIZER: 'Organizador' } as Record<string, string>,
  },
  TEAM_INVITE: {
    subject: (team: string) => `Convite para o squad ${team}`,
    preview: 'Aceite ou recuse o convite na Nova Arena.',
    heading: (team: string) => `Você foi chamado para o ${team}`,
    body: (captain: string, team: string) => `${captain} convidou você para o squad ${team}. Aceite para jogar os campeonatos com eles.`,
    action: 'Ver convite',
    expires: 'O convite vale por 72 horas.',
  },
  CONFIRM_EMAIL_CHANGE: {
    subject: 'Confirme seu novo e-mail na Nova Arena',
    preview: 'Confirme o endereço novo para concluir a troca.',
    heading: (nickname: string) => `Oi, ${nickname}`,
    body: 'Você pediu para usar este endereço na sua conta da Nova Arena. Confirme pelo botão abaixo para concluir a troca.',
    action: 'Confirmar novo e-mail',
    expires: 'O link vale por 24 horas. Até lá, o e-mail antigo continua valendo.',
  },
  EMAIL_CHANGED: {
    subject: 'O e-mail da sua conta na Nova Arena mudou',
    preview: 'Sua conta agora usa outro endereço de e-mail.',
    heading: (nickname: string) => `Oi, ${nickname}`,
    body: (newEmail: string) => `O e-mail da sua conta foi trocado para ${newEmail}. A partir de agora, os avisos e o login usam esse endereço.`,
    action: 'Não fui eu',
    expires: 'Se não foi você, redefina a senha pelo botão e fale com o suporte para recuperar a conta.',
  },
  PASSWORD_CHANGED: {
    subject: 'Sua senha da Nova Arena foi trocada',
    preview: 'A senha da sua conta acabou de mudar.',
    heading: (nickname: string) => `Oi, ${nickname}`,
    body: 'A senha da sua conta foi trocada e os outros aparelhos saíram da conta.',
    action: 'Não fui eu',
    expires: 'Se não foi você, redefina a senha agora pelo botão.',
  },
} as const;
