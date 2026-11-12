'use client';

import { Button, Input, Modal, useToast, type ButtonProps } from '@nova/ui';
import { Share2 } from 'lucide-react';
import { useState } from 'react';

interface ShareButtonProps {
  /** Título do que está sendo compartilhado (vai para a folha de compartilhamento do sistema). */
  title: string;
  text?: string;
  /** Caminho ou URL. Padrão: a página atual. */
  url?: string;
  size?: ButtonProps['size'];
}

function absoluteUrl(url?: string): string {
  if (!url) return window.location.href;
  return new URL(url, window.location.origin).toString();
}

/**
 * Compartilhar: usa a Web Share API quando o aparelho tem (celular) e, sem ela, copia o link.
 * Se nem a cópia for permitida, mostra o link para a pessoa copiar à mão.
 */
export function ShareButton({ title, text, url, size }: ShareButtonProps) {
  const { success } = useToast();
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  async function share() {
    const target = absoluteUrl(url);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: target });
        return;
      } catch (e) {
        // A pessoa fechou a folha de compartilhamento: não é erro.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // Qualquer outra falha cai na cópia do link.
      }
    }
    try {
      await navigator.clipboard.writeText(target);
      success('Link copiado', 'Cole onde quiser para compartilhar.');
    } catch {
      setManualUrl(target);
    }
  }

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => void share()} iconLeft={<Share2 className="size-4" aria-hidden />}>
        Compartilhar
      </Button>
      <Modal open={manualUrl !== null} onOpenChange={(open) => !open && setManualUrl(null)} title="Compartilhar" description="Não conseguimos copiar sozinhos. Selecione o link abaixo e copie." size="sm">
        <Input label="Link" value={manualUrl ?? ''} readOnly onFocus={(e) => e.currentTarget.select()} />
      </Modal>
    </>
  );
}
