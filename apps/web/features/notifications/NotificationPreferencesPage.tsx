'use client';

import { NOTIFICATION_TYPE_LABELS, type NotificationPreference, type NotificationType } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton, useToast } from '@nova/ui';
import { Lock } from 'lucide-react';
import { Switch } from 'radix-ui';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useNotificationPreferences, useSaveNotificationPreferences } from '@/shared/api/hooks/notifications';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';

type Channel = 'inApp' | 'email';
const CHANNELS: { key: Channel; label: string; aria: string }[] = [
  { key: 'inApp', label: 'No site', aria: 'no site' },
  { key: 'email', label: 'E-mail', aria: 'por e-mail' },
];

/** Avisos da moderação não podem ser desligados (a API também recusa). */
const LOCKED: NotificationType = 'SANCTION';

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <span className="flex min-h-11 items-center justify-center">
      <Switch.Root
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onChange}
        className="relative h-6 w-11 shrink-0 rounded-full border border-border-strong bg-neutral-soft transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-60"
      >
        <Switch.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-border-strong shadow-sm transition-transform data-[state=checked]:translate-x-5.5 data-[state=checked]:bg-surface" />
      </Switch.Root>
    </span>
  );
}

/** `/minha-conta/notificacoes`: preferências por tipo, com os canais "No site" e "E-mail". */
export function NotificationPreferencesPage() {
  const preferences = useNotificationPreferences();
  return (
    <PageContainer>
      <PageHeader title="Preferências de notificação" description="Escolha o que você quer receber no site e por e-mail." />
      {preferences.isPending ? (
        <div className="flex max-w-3xl flex-col gap-3" role="status" aria-label="Carregando preferências">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : preferences.isError ? (
        <ErrorState className="max-w-3xl" title="Não foi possível carregar as preferências" description={errorMessage(preferences.error)} onRetry={() => void preferences.refetch()} />
      ) : (
        <PreferencesForm saved={preferences.data} />
      )}
    </PageContainer>
  );
}

function PreferencesForm({ saved }: { saved: NotificationPreference[] }) {
  const { success, error } = useToast();
  const save = useSaveNotificationPreferences();
  // Rascunho local: só as linhas que a pessoa mexeu. O que não mudou continua vindo do servidor.
  const [draft, setDraft] = useState<Partial<Record<NotificationType, NotificationPreference>>>({});
  const rows = saved.map((p) => draft[p.type] ?? p);
  const changed = rows.filter((row, i) => row.inApp !== saved[i]?.inApp || row.email !== saved[i]?.email);

  function set(row: NotificationPreference, channel: Channel, value: boolean) {
    setDraft((d) => ({ ...d, [row.type]: { ...row, [channel]: value } }));
  }

  function submit() {
    save.mutate(changed, {
      onSuccess: () => {
        setDraft({});
        success('Preferências salvas');
      },
      onError: (e) => error('Não foi possível salvar as preferências', errorMessage(e)),
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card padding="none" className="overflow-hidden">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Preferências de notificação por tipo e por canal</caption>
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <th scope="col" className="px-3 py-2 md:px-6">
                Aviso
              </th>
              {CHANNELS.map((c) => (
                <th key={c.key} scope="col" className="w-16 px-1 py-2 text-center md:w-24">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meta = NOTIFICATION_TYPE_LABELS[row.type];
              const locked = row.type === LOCKED;
              return (
                <tr key={row.type} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-3 align-top font-normal md:px-6">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
                      {meta.label}
                      {locked && <Lock className="size-3.5 shrink-0 text-muted" aria-hidden />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{meta.description}</span>
                  </th>
                  {CHANNELS.map((c) => (
                    <td key={c.key} className="px-1 py-1 align-middle">
                      <Toggle checked={locked ? true : row[c.key]} disabled={locked || save.isPending} label={`${meta.label}: ${c.aria}`} onChange={(v) => set(row, c.key, v)} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted">No protótipo os e-mails não são enviados de verdade: a preferência fica gravada e passa a valer quando o envio de e-mail entrar no ar.</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={changed.length === 0} loading={save.isPending}>
          Salvar preferências
        </Button>
        {changed.length > 0 && (
          <Button variant="ghost" onClick={() => setDraft({})} disabled={save.isPending}>
            Desfazer alterações
          </Button>
        )}
      </div>
    </div>
  );
}
