'use client';

import type { Match } from '@nova/schemas';
import { Modal } from '@nova/ui';
import { useT } from '@/shared/i18n/react';
import { matchHeading } from '../matchText';
import { messages } from '../messages';
import type { MatchViewer } from '../viewer';
import { MatchChat } from './MatchChat';

/** Chat da partida num modal (operação do organizador: a lista de partidas não tem detalhe aberto). */
export function MatchChatDialog({ match, viewer, onClose }: { match: Match; viewer: MatchViewer; onClose: () => void }) {
  const t = useT(messages, 'MatchChatDialog');
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={t('titulo')} description={matchHeading(match)}>
      <MatchChat match={match} viewer={viewer} className="border-0 p-0" />
    </Modal>
  );
}
