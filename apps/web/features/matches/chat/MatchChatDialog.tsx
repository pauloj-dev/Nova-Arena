'use client';

import type { Match } from '@nova/schemas';
import { Modal } from '@nova/ui';
import { matchHeading } from '../matchText';
import type { MatchViewer } from '../viewer';
import { MatchChat } from './MatchChat';

/** Chat da partida num modal (operação do organizador: a lista de partidas não tem detalhe aberto). */
export function MatchChatDialog({ match, viewer, onClose }: { match: Match; viewer: MatchViewer; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="Chat da partida" description={matchHeading(match)}>
      <MatchChat match={match} viewer={viewer} className="border-0 p-0" />
    </Modal>
  );
}
