'use client';

import { Button, useToast } from '@nova/ui';
import { BellRing } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/api/client';
import { useMyRegistrations } from '@/shared/api/hooks/registrations';
import { isModuleMocked } from '@/shared/api/mode';
import { useFlag } from '@/shared/flags/useFlag';
import { pushSupported, subscribeToPush } from './client';

const DISMISSED_KEY = 'nova:push-convite-dispensado';

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Sem armazenamento: o convite volta na próxima visita, sem problema.
  }
}

/** Dá para convidar agora? (API real, navegador com push, permissão ainda não decidida, convite não dispensado). */
export function pushPromptEligible(): boolean {
  return !isModuleMocked('notifications') && pushSupported() && Notification.permission === 'default' && !dismissed();
}

/**
 * Convite para ligar o push (issue #109), no momento certo: **depois da primeira inscrição** — é aí que o aviso de
 * check-in passa a importar. Só com a flag `pushNotifications` ligada. A permissão do navegador só é pedida no
 * clique em "Ativar avisos" (os navegadores bloqueiam o pedido sem gesto da pessoa).
 */
export function PushPrompt() {
  // No servidor (e na hidratação) é sempre "não": lá não existe `Notification`.
  const eligible = useSyncExternalStore(subscribeNothing, pushPromptEligible, () => false);
  const [closed, setClosed] = useState(false);
  if (!eligible || closed) return null;
  return <PushPromptCard onClose={() => setClosed(true)} />;
}

const subscribeNothing = () => () => {};

function PushPromptCard({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const enabled = useFlag('pushNotifications');
  const registrations = useMyRegistrations({ enabled });
  const [busy, setBusy] = useState(false);
  if (!enabled || !registrations.data || registrations.data.length === 0) return null;

  async function activate() {
    setBusy(true);
    try {
      const outcome = await subscribeToPush();
      if (outcome === 'subscribed') toast.success('Avisos no aparelho ativados', 'Você recebe o check-in e os resultados mesmo com o site fechado.');
      else if (outcome === 'denied') toast.toast({ title: 'Avisos no aparelho desligados', description: 'Você pode ativar depois nas configurações do navegador para este site.', tone: 'info' });
      else toast.toast({ title: 'Este aparelho não recebe avisos', description: 'No iPhone, instale a Nova Arena na tela de início para receber os avisos.', tone: 'info' });
      dismiss();
      onClose();
    } catch (error) {
      toast.error('Não foi possível ativar os avisos', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <section
      aria-labelledby="push-convite-titulo"
      className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-lg md:left-auto md:right-6 md:bottom-6 md:max-w-sm"
      data-testid="push-prompt"
    >
      <h2 id="push-convite-titulo" className="flex items-center gap-2 text-base font-semibold">
        <BellRing className="size-5 shrink-0 text-primary-text" aria-hidden />
        Não perca o check-in
      </h2>
      <p className="text-sm text-muted">Quer receber no celular o aviso do check-in e dos resultados, mesmo com o site fechado?</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void activate()} loading={busy}>
          Ativar avisos
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            dismiss();
            onClose();
          }}
        >
          Agora não
        </Button>
      </div>
    </section>,
    document.body,
  );
}
