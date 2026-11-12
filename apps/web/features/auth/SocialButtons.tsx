'use client';

import { Button, useToast } from '@nova/ui';
import { useId } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useDevLogin } from '@/shared/session/useSession';
import { PrototypeNotice } from './AuthParts';

/** Conta de demonstração usada pelos botões sociais no protótipo. */
const DEMO_SOCIAL_USER = 'u_bianca';

/**
 * "Entrar com Google" e "Entrar com Discord". No protótipo não existe OAuth:
 * os dois entram como a conta de demonstração Bianca, e o aviso diz isso com todas as letras.
 */
export function SocialButtons({ onSignedIn }: { onSignedIn: () => void }) {
  const devLogin = useDevLogin();
  const { error } = useToast();
  const noticeId = useId();

  function signIn(provider: 'Google' | 'Discord') {
    devLogin.mutate(DEMO_SOCIAL_USER, {
      onSuccess: onSignedIn,
      onError: (e) => error(`Não foi possível entrar com ${provider}`, errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 xs:grid-cols-2">
        <Button variant="secondary" fullWidth disabled={devLogin.isPending} aria-describedby={noticeId} onClick={() => signIn('Google')}>
          Entrar com Google
        </Button>
        <Button variant="secondary" fullWidth disabled={devLogin.isPending} aria-describedby={noticeId} onClick={() => signIn('Discord')}>
          Entrar com Discord
        </Button>
      </div>
      <PrototypeNotice id={noticeId}>
        <p>
          O login com Google e Discord é <strong>simulado</strong>: os dois botões entram como a conta de demonstração <strong>Bianca</strong>. Nenhum dado seu é enviado a essas empresas.
        </p>
      </PrototypeNotice>
    </div>
  );
}
