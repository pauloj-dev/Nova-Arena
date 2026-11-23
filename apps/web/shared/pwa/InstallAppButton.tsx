'use client';

import { Button, Modal, useToast, type ButtonProps } from '@nova/ui';
import { Download, Share, SquarePlus } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { sharedMessages } from '../i18n/messages';
import { useT } from '../i18n/react';
import { getInstallSnapshot, getServerInstallSnapshot, promptInstall, subscribeInstall } from './install';

const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

/**
 * Botão "Instalar app" (issue 105). Só aparece quando dá para instalar: no Android/Chrome abre o aviso do
 * navegador; no iPhone/iPad mostra o passo a passo do Safari. Aberto como app instalado, some.
 */
export function InstallAppButton({ variant = 'secondary', size = 'sm', className }: Pick<ButtonProps, 'variant' | 'size' | 'className'>) {
  const { mode } = useSyncExternalStore(subscribeInstall, getInstallSnapshot, getServerInstallSnapshot);
  const [iosHelp, setIosHelp] = useState(false);
  const { success } = useToast();
  const t = useT(sharedMessages, 'InstallAppButton');

  if (mode === 'hidden') return null;
  // Fora do JSX: a regra de texto fixo só reconhece a chamada `t(…)`, não `t.rich(…)`.
  const steps = [
    t.rich('passoCompartilhar', { strong, icone: () => <Share className="inline size-4 align-text-bottom" aria-hidden /> }),
    t.rich('passoAdicionarTela', { strong, icone: () => <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> }),
    t.rich('passoConfirmar', { strong }),
  ];

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        iconLeft={<Download className="size-4" aria-hidden />}
        onClick={() => {
          if (mode === 'ios') {
            setIosHelp(true);
            return;
          }
          void promptInstall().then((accepted) => {
            if (accepted) success(t('instaladoTitulo'), t('instaladoTexto'));
          });
        }}
      >
        {t('instalar')}
      </Button>
      <Modal open={iosHelp} onOpenChange={setIosHelp} title={t('iosTitulo')} description={t('iosDescricao')}>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </Modal>
    </>
  );
}
