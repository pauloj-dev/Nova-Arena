'use client';

import { Button, Modal, useToast, type ButtonProps } from '@nova/ui';
import { Download, Share, SquarePlus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { getInstallSnapshot, getServerInstallSnapshot, promptInstall, subscribeInstall } from './install';

/**
 * Botão "Instalar app" (issue 105). Só aparece quando dá para instalar: no Android/Chrome abre o aviso do
 * navegador; no iPhone/iPad mostra o passo a passo do Safari. Aberto como app instalado, some.
 */
export function InstallAppButton({ variant = 'secondary', size = 'sm', className }: Pick<ButtonProps, 'variant' | 'size' | 'className'>) {
  const { mode } = useSyncExternalStore(subscribeInstall, getInstallSnapshot, getServerInstallSnapshot);
  const [iosHelp, setIosHelp] = useState(false);
  const { success } = useToast();

  if (mode === 'hidden') return null;

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
            if (accepted) success('App instalado', 'A Nova Arena agora abre direto da tela inicial.');
          });
        }}
      >
        Instalar app
      </Button>
      <Modal open={iosHelp} onOpenChange={setIosHelp} title="Instalar no iPhone ou iPad" description="Leva menos de 10 segundos, direto pelo Safari.">
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            Toque em <strong>Compartilhar</strong> <Share className="inline size-4 align-text-bottom" aria-hidden /> na barra do Safari.
          </li>
          <li>
            Role e toque em <strong>Adicionar à Tela de Início</strong> <SquarePlus className="inline size-4 align-text-bottom" aria-hidden />.
          </li>
          <li>
            Confirme em <strong>Adicionar</strong>. O ícone da Nova Arena aparece na sua tela inicial.
          </li>
        </ol>
      </Modal>
    </>
  );
}
