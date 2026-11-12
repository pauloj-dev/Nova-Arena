import { cn } from '@nova/ui';
import { AlertCircle } from 'lucide-react';

/** Mensagens de validação de uma seção. Não renderiza nada quando a lista está vazia. */
export function IssueList({ messages, className, id }: { messages: string[]; className?: string; id?: string }) {
  if (messages.length === 0) return null;
  return (
    <ul id={id} role="alert" className={cn('flex flex-col gap-1 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text', className)}>
      {messages.map((message) => (
        <li key={message} className="flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}
