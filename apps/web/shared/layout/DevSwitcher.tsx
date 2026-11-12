'use client';

import { Modal, Button, useToast } from '@nova/ui';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isMockEnabled } from '@/mocks/handlers';
import { errorMessage } from '../api/client';
import { useDevLogin, useLogout, useSession } from '../session/useSession';

const DEMO = [
  { id: 'u_bianca', label: 'Bianca', role: 'Participante solo' },
  { id: 'u_lucas', label: 'Lucas', role: 'Capitão do Squad Alfa' },
  { id: 'u_camila', label: 'Camila', role: 'Organizadora verificada' },
  { id: 'u_diego', label: 'Diego', role: 'Organizador' },
  { id: 'u_ana', label: 'Ana', role: 'Administradora' },
  { id: 'u_rafael', label: 'Rafael', role: 'Super Admin' },
];

/**
 * Só existe no protótipo (API simulada): troca rápida entre os papéis e reinício dos dados.
 * Some sozinho quando `NEXT_PUBLIC_API_MOCK=none`.
 */
export function DevSwitcher() {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const devLogin = useDevLogin();
  const logout = useLogout();
  const router = useRouter();
  const { error, success } = useToast();

  if (!isMockEnabled()) return null;

  async function reset() {
    const { resetDb } = await import('@/mocks/db');
    resetDb();
    // Recarga completa de propósito: zera todo o estado em memória do protótipo.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-3 z-40 flex min-h-11 items-center gap-2 rounded-full border border-border-strong bg-surface px-3 text-xs font-semibold text-text shadow-md md:bottom-4"
        aria-label="Protótipo: entrar como outro usuário"
      >
        <FlaskConical className="size-4" aria-hidden />
        <span>Entrar como</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Protótipo — entrar como"
        description="Os dados são simulados e ficam só neste navegador. A senha de todas as contas é arena1234."
        footer={
          <>
            <Button variant="ghost" onClick={() => void reset()} iconLeft={<RotateCcw className="size-4" aria-hidden />}>
              Reiniciar dados
            </Button>
            {user && (
              <Button
                variant="secondary"
                onClick={() =>
                  logout.mutate(undefined, {
                    onSuccess: () => {
                      setOpen(false);
                      router.push('/');
                    },
                  })
                }
              >
                Sair da conta
              </Button>
            )}
          </>
        }
      >
        <ul className="flex flex-col gap-2">
          {DEMO.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                data-testid={`dev-login-${d.id}`}
                aria-pressed={user?.id === d.id}
                onClick={() =>
                  devLogin.mutate(d.id, {
                    onSuccess: (me) => {
                      setOpen(false);
                      success(`Você entrou como ${me.nickname}`);
                    },
                    onError: (e) => error('Não foi possível entrar', errorMessage(e)),
                  })
                }
                className="flex min-h-12 w-full items-center justify-between rounded-md border border-border px-3 text-left hover:bg-neutral-soft aria-pressed:border-accent aria-pressed:bg-accent-soft"
              >
                <span className="font-semibold">{d.label}</span>
                <span className="text-sm text-muted">{d.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
