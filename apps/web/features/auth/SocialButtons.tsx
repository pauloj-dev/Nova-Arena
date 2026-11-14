'use client';

import type { OAuthProviderName } from '@nova/schemas';
import { Button, useToast } from '@nova/ui';
import { useId } from 'react';
import { errorMessage } from '@/shared/api/client';
import { oauthStartUrl } from '@/shared/api/hooks/login-methods';
import { isModuleMocked } from '@/shared/api/mode';
import { useDevLogin } from '@/shared/session/useSession';
import { PrototypeNotice } from './AuthParts';

/** Conta de demonstração usada pelos botões sociais no protótipo. */
const DEMO_SOCIAL_USER = 'u_bianca';

const PROVIDERS: { id: OAuthProviderName; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
];

/**
 * "Entrar com Google" e "Entrar com Discord".
 * Com a API real, cada botão leva ao provedor (state + PKCE) e volta para `next`.
 * Com a API simulada não existe OAuth: os dois entram como a conta de demonstração Bianca, e o aviso diz isso.
 */
export function SocialButtons({ onSignedIn, next }: { onSignedIn: () => void; next?: string }) {
  if (!isModuleMocked('auth')) {
    return (
      <div className="grid gap-2 xs:grid-cols-2">
        {PROVIDERS.map((p) => (
          <Button key={p.id} variant="secondary" fullWidth asChild>
            <a href={oauthStartUrl(p.id, { next })}>Entrar com {p.label}</a>
          </Button>
        ))}
      </div>
    );
  }
  return <DemoSocialButtons onSignedIn={onSignedIn} />;
}

function DemoSocialButtons({ onSignedIn }: { onSignedIn: () => void }) {
  const devLogin = useDevLogin();
  const { error } = useToast();
  const noticeId = useId();

  function signIn(provider: string) {
    devLogin.mutate(DEMO_SOCIAL_USER, {
      onSuccess: onSignedIn,
      onError: (e) => error(`Não foi possível entrar com ${provider}`, errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 xs:grid-cols-2">
        {PROVIDERS.map((p) => (
          <Button key={p.id} variant="secondary" fullWidth disabled={devLogin.isPending} aria-describedby={noticeId} onClick={() => signIn(p.label)}>
            Entrar com {p.label}
          </Button>
        ))}
      </div>
      <PrototypeNotice id={noticeId}>
        <p>
          O login com Google e Discord é <strong>simulado</strong>: os dois botões entram como a conta de demonstração <strong>Bianca</strong>. Nenhum dado seu é enviado a essas empresas.
        </p>
      </PrototypeNotice>
    </div>
  );
}
