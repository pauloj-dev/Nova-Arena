'use client';

import { CHAT_MESSAGE_MAX_LENGTH, type Match, type MatchChatMessage } from '@nova/schemas';
import { Avatar, Badge, Button, cn, ErrorState, Skeleton, Textarea, useToast } from '@nova/ui';
import { EyeOff, Lock, MessagesSquare, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useHideChatMessage, useMatchChat, useSendChatMessage } from '@/shared/api/hooks/chat';
import { formatDateTime, formatTime } from '@/shared/lib/datetime';
import { ReportButton } from '@/features/reports/ReportButton';
import { useMatchViewer, type MatchViewer } from '../viewer';

/** Quem pode abrir o chat (a API confere de novo): a organização ou quem tem lado nesta partida. */
export function canSeeMatchChat(match: Pick<Match, 'participants'>, viewer: MatchViewer): boolean {
  if (!viewer.userId) return false;
  if (viewer.isStaff) return true;
  const mine = viewer.registration?.id;
  return Boolean(mine && match.participants.some((p) => p.registrationId === mine));
}

const sameDay = (a: string, b: Date) => new Date(a).toDateString() === b.toDateString();

function MessageItem({ message, mine, canModerate, onHide, hiding }: { message: MatchChatMessage; mine: boolean; canModerate: boolean; onHide: () => void; hiding: boolean }) {
  const staff = message.authorRole === 'STAFF';
  const when = sameDay(message.createdAt, new Date()) ? formatTime(message.createdAt) : formatDateTime(message.createdAt);
  return (
    <li className={cn('flex gap-2 rounded-md px-2 py-2', mine ? 'bg-accent-soft [&_.text-muted]:text-accent-soft-text' : 'bg-surface-2')} data-testid="chat-message">
      <Avatar name={message.authorNickname} src={message.authorAvatarUrl} size="sm" className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold text-text">{mine ? 'Você' : message.authorNickname}</span>
          {staff && (
            <Badge tone="info" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
              Organização
            </Badge>
          )}
          <time dateTime={message.createdAt} className="text-xs text-muted">
            {when}
          </time>
        </p>
        {message.hidden && !message.body ? (
          <p className="flex items-center gap-1 text-sm italic text-muted">
            <EyeOff className="size-3.5 shrink-0" aria-hidden />
            Mensagem ocultada pela organização.
          </p>
        ) : (
          <>
            <p className={cn('text-sm break-words whitespace-pre-wrap text-text', message.hidden && 'text-muted line-through')}>{message.body}</p>
            {message.hidden && (
              <p className="flex items-center gap-1 text-xs text-muted">
                <EyeOff className="size-3.5 shrink-0" aria-hidden />
                Oculta para os jogadores
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-start">
        {!mine && !message.hidden && <ReportButton variant="icon" targetType="CHAT_MESSAGE" targetId={message.id} targetLabel={`a mensagem de ${message.authorNickname}`} />}
        {(canModerate || mine) && !message.hidden && (
          <button
            type="button"
            onClick={onHide}
            disabled={hiding}
            aria-label={mine && !canModerate ? 'Apagar minha mensagem' : `Ocultar a mensagem de ${mine ? 'você' : message.authorNickname}`}
            title={mine && !canModerate ? 'Apagar' : 'Ocultar'}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text disabled:opacity-50"
          >
            <EyeOff className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

export interface MatchChatProps {
  match: Pick<Match, 'id' | 'participants'>;
  viewer?: MatchViewer;
  /** Nível do título da seção. Padrão: 3. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * Chat da partida (issue 125): jogadores da partida e organização combinam horário e sala sem sair da Nova Arena.
 * Mensagens chegam pelo canal `match:{id}`; dá para denunciar (`ReportButton`) e a organização oculta o que for preciso.
 */
export function MatchChat({ match, viewer: viewerProp, headingLevel = 3, className }: MatchChatProps) {
  const contextViewer = useMatchViewer();
  const viewer = viewerProp ?? contextViewer;
  const visible = canSeeMatchChat(match, viewer);
  const chat = useMatchChat(match.id, { enabled: visible });
  const send = useSendChatMessage(match.id);
  const hide = useHideChatMessage(match.id);
  const { error: toastError, success } = useToast();
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const listRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const count = chat.data?.messages.length ?? 0;

  // Mensagem nova: a lista desce até o fim (sem roubar o foco de quem está digitando).
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  if (!visible) return null;
  // Não é desta partida (a API recusou): o chat simplesmente não aparece.
  if (chat.error instanceof ApiError && chat.error.status === 403) return null;

  const trimmed = text.trim();
  const remaining = CHAT_MESSAGE_MAX_LENGTH - text.length;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed) {
      setFieldError('Escreva a mensagem');
      return;
    }
    send.mutate(
      { body: trimmed },
      {
        onSuccess: () => {
          setText('');
          setFieldError(undefined);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.fieldErrors.body) setFieldError(e.fieldErrors.body);
          else toastError('Não foi possível enviar a mensagem', errorMessage(e));
        },
      },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function hideMessage(message: MatchChatMessage) {
    hide.mutate(message.id, {
      onSuccess: () => success(message.authorId === viewer.userId && !chat.data?.canModerate ? 'Mensagem apagada' : 'Mensagem ocultada'),
      onError: (e) => toastError('Não foi possível ocultar a mensagem', errorMessage(e)),
    });
  }

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3 rounded-lg border border-border p-3', className)} data-testid="match-chat">
      <div className="flex flex-col gap-0.5">
        <Heading id={headingId} className="flex items-center gap-2 text-base">
          <MessagesSquare className="size-4 text-muted" aria-hidden />
          Chat da partida
        </Heading>
        <p className="text-xs text-muted">Só quem joga esta partida e a organização leem. Combine horário e sala com respeito: mensagens podem ser denunciadas.</p>
      </div>

      {chat.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Carregando o chat">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-3/4" />
        </div>
      ) : chat.error ? (
        <ErrorState title="Não foi possível carregar o chat" description={errorMessage(chat.error)} onRetry={() => void chat.refetch()} />
      ) : (
        <>
          {chat.data.messages.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-3 text-sm text-muted">
              <MessagesSquare className="size-4 shrink-0" aria-hidden />
              Nenhuma mensagem ainda. {chat.data.canPost ? 'Comece a conversa.' : ''}
            </p>
          ) : (
            <div ref={listRef} role="log" aria-live="polite" aria-label="Mensagens do chat" tabIndex={0} className="max-h-80 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <ol className="flex flex-col gap-1.5">
              {chat.data.messages.map((m) => (
                <MessageItem key={m.id} message={m} mine={m.authorId === viewer.userId} canModerate={chat.data.canModerate} onHide={() => hideMessage(m)} hiding={hide.isPending && hide.variables === m.id} />
              ))}
              </ol>
            </div>
          )}

          {chat.data.canPost ? (
            <form onSubmit={submit} noValidate className="flex flex-col gap-2">
              <Textarea
                label="Mensagem"
                rows={2}
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (fieldError) setFieldError(undefined);
                }}
                onKeyDown={onKeyDown}
                error={fieldError}
                hint={`Enter envia; Shift+Enter quebra a linha. ${remaining} ${remaining === 1 ? 'caractere restante' : 'caracteres restantes'}.`}
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={send.isPending} iconLeft={<Send className="size-4" aria-hidden />}>
                  Enviar
                </Button>
              </div>
            </form>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <Lock className="size-4 shrink-0" aria-hidden />
              {chat.data.closedReason ?? 'O chat está fechado.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
