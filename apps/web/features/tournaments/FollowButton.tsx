'use client';

import type { FollowTargetType } from '@nova/schemas';
import { Button, useToast, type ButtonProps } from '@nova/ui';
import { Bell, BellRing } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { errorMessage } from '@/shared/api/client';
import { useFollows, useToggleFollow } from '@/shared/api/hooks/users';
import { useSession } from '@/shared/session/useSession';

interface FollowButtonProps {
  type: FollowTargetType;
  /** Id do campeonato ou do jogo. */
  id: string;
  /** Nome do que está sendo seguido, para os avisos ("Você está seguindo Free Fire"). */
  name: string;
  size?: ButtonProps['size'];
  fullWidth?: boolean;
}

const LABEL: Record<FollowTargetType, string> = { tournament: 'Seguir campeonato', game: 'Seguir jogo' };
const EFFECT: Record<FollowTargetType, string> = {
  tournament: 'Você recebe os comunicados e os avisos de início, avanço de fase e campeão.',
  game: 'Avisamos quando um campeonato novo deste jogo abrir inscrições.',
};

/** Seguir campeonato ou jogo (RN-15). Visitante é levado para o login e volta para a mesma página. */
export function FollowButton({ type, id, name, size, fullWidth }: FollowButtonProps) {
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
        onSuccess: () => (follow ? success(`Você está seguindo ${name}`, EFFECT[type]) : success(`Você deixou de seguir ${name}`)),
        onError: (e) => error(follow ? 'Não foi possível seguir' : 'Não foi possível deixar de seguir', errorMessage(e)),
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
      {following ? 'Seguindo' : LABEL[type]}
    </Button>
  );
}
