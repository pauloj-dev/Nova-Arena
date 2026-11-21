'use client';

import type { Stage } from '@nova/schemas';
import { Button, Modal, Select, Switch, useToast } from '@nova/ui';
import { Copy, ExternalLink, MonitorPlay } from 'lucide-react';
import { useState } from 'react';
import { pickStage, telaoHref, type TelaoView } from './telao';

export interface TelaoLinksDialogProps {
  slug: string;
  stages: readonly Stage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const VIEWS: { view: TelaoView; label: string; hint: string }[] = [
  { view: 'tabela', label: 'Classificação', hint: 'Gira entre os grupos a cada 12 s.' },
  { view: 'chave', label: 'Chave', hint: 'Gira entre as rodadas, os lados da chave ou os grupos.' },
];

function absolute(href: string): string {
  return typeof window === 'undefined' ? href : `${window.location.origin}${href}`;
}

/**
 * "Abrir no telão" (issue #124): os links de tela cheia da classificação e da chave de cada fase, com o passo a
 * passo para adicionar no OBS como fonte de navegador.
 */
export function TelaoLinksDialog({ slug, stages, open, onOpenChange }: TelaoLinksDialogProps) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState(() => pickStage(stages, null)?.id ?? '');
  const [transparent, setTransparent] = useState(false);
  const { success, error } = useToast();

  async function copy(href: string) {
    try {
      await navigator.clipboard.writeText(absolute(href));
      success('Link copiado', 'Cole na fonte de navegador do OBS.');
    } catch {
      error('Não foi possível copiar', 'Selecione o link e copie manualmente.');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Abrir no telão"
      description="Classificação e chave ao vivo em tela cheia, com letras grandes e atualização automática. Ideal para a transmissão."
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {ordered.length > 1 && (
          <Select label="Fase" value={stageId} onChange={(e) => setStageId(e.target.value)} options={ordered.map((s) => ({ value: s.id, label: s.name }))} />
        )}
        <Switch
          label="Fundo transparente"
          hint="Para sobrepor a tabela ao jogo no OBS. Os cartões continuam com fundo para garantir a leitura."
          checked={transparent}
          onCheckedChange={setTransparent}
        />

        <ul className="flex flex-col gap-3" data-testid="telao-links">
          {VIEWS.map(({ view, label, hint }) => {
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
                  <Button size="sm" variant="secondary" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(href)} aria-label={`Copiar o link da ${label.toLowerCase()}`}>
                    Copiar link
                  </Button>
                  <Button size="sm" asChild>
                    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Abrir a ${label.toLowerCase()} no telão (abre em nova aba)`}>
                      <ExternalLink className="size-4" aria-hidden />
                      Abrir
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
            Como adicionar no OBS
          </h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>Copie o link acima.</li>
            <li>
              No OBS, em <strong>Fontes</strong>, clique em <strong>+</strong> e escolha <strong>Navegador</strong>.
            </li>
            <li>Cole o link em <strong>URL</strong>.</li>
            <li>
              Use largura <strong>1920</strong> e altura <strong>1080</strong> (tamanho recomendado).
            </li>
            <li>
              Opcional: marque <strong>Atualizar navegador quando a cena ficar ativa</strong>.
            </li>
          </ol>
          <p>
            Com <strong>fundo transparente</strong> (<code>?fundo=transparente</code>), a tabela fica por cima do jogo. Para mudar o tempo de cada página, acrescente{' '}
            <code>&amp;intervalo=20</code> (em segundos); para o tema claro, <code>&amp;tema=claro</code>.
          </p>
        </section>
      </div>
    </Modal>
  );
}
