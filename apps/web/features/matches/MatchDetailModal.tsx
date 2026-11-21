'use client';

import type { Match } from '@nova/schemas';
import { Modal } from '@nova/ui';
import type { ReactNode } from 'react';
import { MatchChat } from './chat/MatchChat';
import { useT } from '@/shared/i18n/react';
import { MatchCard } from './MatchCard';
import { matchHeading } from './matchText';
import { messages } from './messages';
import type { MatchViewer } from './viewer';

export interface MatchDetailModalProps {
  /** A partida aberta (nulo = fechado). Passe sempre o objeto mais recente da consulta, para o detalhe se atualizar sozinho. */
  match: Match | null;
  onClose: () => void;
  viewer?: MatchViewer;
  /** Conteúdo extra abaixo do cartão (ex.: ações da organização). */
  children?: ReactNode;
}

/** Detalhe da partida: o `MatchCard` completo em um modal (tela cheia no celular). */
export function MatchDetailModal({ match, onClose, viewer, children }: MatchDetailModalProps) {
  const t = useT(messages, 'MatchDetailModal');
  return (
    <Modal open={match !== null} onOpenChange={(open) => !open && onClose()} title={t('titulo')} description={match ? matchHeading(match) : undefined}>
      {match && (
        <div className="flex flex-col gap-4">
          <MatchCard match={match} viewer={viewer} variant="full" headingLevel={3} className="border-0 p-0 shadow-none" />
          {children}
          <MatchChat match={match} viewer={viewer} />
        </div>
      )}
    </Modal>
  );
}
