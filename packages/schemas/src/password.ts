/** Senha fraca (issue #69): a mesma regra na tela, na API simulada e na API real. A checagem de vazamento fica só na API. */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'senha123', 'senha1234', 'senhasenha', 'qwertyui', 'qwerty123', 'abcd1234',
  'abc12345', 'iloveyou', 'iloveyou1', 'brasil123', 'flamengo', 'corinthians', 'palmeiras', 'novaarena', 'freefire',
  'freefire123', 'admin123', 'mudar123', 'trocar123', 'q1w2e3r4', '1q2w3e4r', 'asdfghjk', 'zaq12wsx',
]);

/** Motivo para recusar a senha sem consultar a rede, ou `null`. */
export function weakPasswordReason(password: string, context: { nickname?: string | null; email?: string | null } = {}): string | null {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Essa senha é muito usada e fácil de adivinhar. Escolha outra.';
  if (/^(.)\1+$/.test(password)) return 'Não use o mesmo caractere repetido. Escolha outra senha.';
  const nick = context.nickname?.toLowerCase();
  const local = context.email?.split('@')[0]?.toLowerCase();
  if ((nick && nick.length >= 3 && lower.includes(nick)) || (local && local.length >= 3 && lower.includes(local))) {
    return 'Não use seu apelido ou e-mail na senha.';
  }
  return null;
}
