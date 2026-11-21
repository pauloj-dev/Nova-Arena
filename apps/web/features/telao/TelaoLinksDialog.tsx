'use client';

import type { Stage } from '@nova/schemas';
import { Button, Modal, Select, Switch, useToast } from '@nova/ui';
import { Copy, ExternalLink, MonitorPlay } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import { pickStage, telaoHref, type TelaoView } from './telao';

export interface TelaoLinksDialogProps {
  slug: string;
  stages: readonly Stage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function absolute(href: string): string {
  return typeof window === 'undefined' ? href : `${window.location.origin}${href}`;
}

/**
 * "Abrir no telão" (issue #124): os links de tela cheia da classificação e da chave de cada fase, com o passo a
 * passo para adicionar no OBS como fonte de navegador.
 */
export function TelaoLinksDialog({ slug, stages, open, onOpenChange }: TelaoLinksDialogProps) {
  const t = useT(messages, 'TelaoLinksDialog');
  const common = useT(sharedMessages, 'comum');
  const views: { view: TelaoView; label: string; hint: string }[] = [
    { view: 'tabela', label: t('classificacao'), hint: t('classificacaoDica') },
    { view: 'chave', label: t('chave'), hint: t('chaveDica') },
  ];
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState(() => pickStage(stages, null)?.id ?? '');
  const [transparent, setTransparent] = useState(false);
  const { success, error } = useToast();
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const code = (chunks: ReactNode) => <code>{chunks}</code>;
  const steps = {
    passo2: t.rich('obsPasso2', { b: strong }),
    passo3: t.rich('obsPasso3', { b: strong }),
    passo4: t.rich('obsPasso4', { b: strong }),
    passo5: t.rich('obsPasso5', { b: strong }),
    dica: t.rich('obsDica', { b: strong, code }),
  };

  async function copy(href: string) {
    try {
      await navigator.clipboard.writeText(absolute(href));
      success(t('copiado'), t('copiadoDescricao'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('titulo')}
      description={t('descricao')}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {common('fechar')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {ordered.length > 1 && (
          <Select label={t('fase')} value={stageId} onChange={(e) => setStageId(e.target.value)} options={ordered.map((s) => ({ value: s.id, label: s.name }))} />
        )}
        <Switch
          label={t('fundoTransparente')}
          hint={t('fundoTransparenteDica')}
          checked={transparent}
          onCheckedChange={setTransparent}
        />

        <ul className="flex flex-col gap-3" data-testid="telao-links">
          {views.map(({ view, label, hint }) => {
            const href = telaoHref(slug, view, { stageId: stageId || undefined, transparent });
            return (
              <li key={view} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="text-xs text-muted">{hint}</p>
                </div>
                <code className="tabular block break-all rounded-sm bg-surface px-2 py-1 text-xs" data-testid={`telao-link-${view}`}>
                  {absolute(href)}
                </code>
                <div className="flex flex-col gap-2 xs:flex-row">
                  <Button size="sm" variant="secondary" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(href)} aria-label={t('copiarAria', { view })}>
                    {t('copiarLink')}
                  </Button>
                  <Button size="sm" asChild>
                    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t('abrirAria', { view })}>
                      <ExternalLink className="size-4" aria-hidden />
                      {t('abrir')}
                    </a>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="telao-obs" className="flex flex-col gap-2 rounded-lg bg-info-soft p-3 text-sm text-info-soft-text">
          <h3 id="telao-obs" className="flex items-center gap-2 text-sm">
            <MonitorPlay className="size-4" aria-hidden />
            {t('obsTitulo')}
          </h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>{t('obsPasso1')}</li>
            <li>{steps.passo2}</li>
            <li>{steps.passo3}</li>
            <li>{steps.passo4}</li>
            <li>{steps.passo5}</li>
          </ol>
          <p>{steps.dica}</p>
        </section>
      </div>
    </Modal>
  );
}
