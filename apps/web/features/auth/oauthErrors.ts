/** Mensagens para `?erro=` quando o login social volta sem sucesso (códigos da API, issue #68). */
const MESSAGES: Record<string, string> = {
  oauth_cancelado: 'Você cancelou o login no provedor. Tente de novo quando quiser.',
  oauth_estado: 'O login demorou demais ou foi aberto em outra janela. Tente de novo.',
  oauth_falhou: 'Não conseguimos confirmar sua conta com o provedor. Tente de novo em instantes.',
  oauth_indisponivel: 'Este jeito de entrar ainda não está disponível. Use e-mail e senha.',
  oauth_sem_email: 'O provedor não compartilhou seu e-mail. Libere o e-mail na conta do provedor ou crie a conta com e-mail e senha.',
  oauth_email_existente:
    'Já existe uma conta com este e-mail. Entre com e-mail e senha e vincule o provedor em Minha conta › Segurança.',
  sessao_expirada: 'Sua sessão expirou. Entre de novo para vincular o provedor.',
  conta_banida: 'Esta conta foi banida.',
  conta_suspensa: 'Esta conta está suspensa.',
};

export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? 'Não foi possível entrar. Tente de novo.';
}
