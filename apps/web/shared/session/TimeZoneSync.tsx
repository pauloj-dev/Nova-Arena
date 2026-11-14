'use client';

import { Fragment, type ReactNode } from 'react';
import { setPreferredTimeZone, userTimeZone } from '../lib/datetime';
import { useSession } from './useSession';

/**
 * Aplica o fuso salvo no perfil (`Me.timezone`) a todas as datas exibidas (CLAUDE.md, regra 7).
 * O fuso é gravado antes de os filhos renderizarem; quando ele muda (login, saída ou troca no perfil),
 * a árvore é remontada para que nenhuma data fique no fuso antigo. Para quem usa o fuso do navegador
 * a chave nunca muda, então não há remontagem.
 */
export function TimeZoneSync({ children }: { children: ReactNode }) {
  const { user } = useSession();
  setPreferredTimeZone(user?.timezone ?? null);
  return <Fragment key={userTimeZone()}>{children}</Fragment>;
}
