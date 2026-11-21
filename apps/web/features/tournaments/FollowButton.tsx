'use client';

import type { FollowTargetType } from '@nova/schemas';
import { Button, useToast, type ButtonProps } from '@nova/ui';
import { Bell, BellRing } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { errorMessage } from '@/shared/api/client';
import { useFollows, useToggleFollow } from '@/shared/api/hooks/users';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { messages } from './messages';

interface FollowButtonProps {
  type: FollowTargetType;
  /** Id do campeonato ou do jogo. */
  id: string;
  /** Nome do que está sendo seguido, para os avisos ("Você está seguindo Free Fire"). */
  name: string;
  size?: ButtonProps['size'];
  fullWidth?: boolean;
}

/** Seguir campeonato ou jogo (RN-15). Visitante é levado para o login e volta para a mesma página. */
export function FollowButton({ type, id, name, size, fullWidth }: FollowButtonProps) {
  const t = useT(messages, 'FollowButton');
  const { user, isLoading: sessionLoading } = useSession();
  const { isFollowing, isLoading } = useFollows();
  const toggle = useToggleFollow();
  const router = useRouter();
  const pathname = usePathname();
  const { success, error } = useToast();
  const following = isFollowing(type, id);

  function onClick() {
    if (!user) {
      router.push(`/entrar?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const follow = !following;
    toggle.mutate(
      { type, id, follow },
      {
        onSuccess: () => (follow ? success(t('seguindoAviso', { nome: name }), t('efeito', { tipo: type })) : success(t('deixouDeSeguir', { nome: name }))),
        onError: (e) => error(follow ? t('erroSeguir') : t('erroDeixarDeSeguir'), errorMessage(e)),
      },
    );
  }

  return (
    <Button
      variant={following ? 'primary' : 'secondary'}
      size={size}
      fullWidth={fullWidth}
      aria-pressed={following}
      disabled={sessionLoading || isLoading || toggle.isPending}
      onClick={onClick}
      iconLeft={following ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
    >
      {following ? t('seguindo') : t('seguir', { tipo: type })}
    </Button>
  );
}
