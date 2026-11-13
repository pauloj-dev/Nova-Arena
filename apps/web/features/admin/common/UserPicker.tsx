'use client';

import type { AdminUser } from '@nova/schemas';
import { Button, Input, Skeleton } from '@nova/ui';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminUsers } from '@/shared/api/hooks/admin';
import { UserIdentity, UserStatusPill } from './UserBits';
import { useDebouncedValue } from './useDebouncedValue';

interface UserPickerProps {
  label: string;
  hint?: string;
  /** Só contas com este papel (ex.: `ORGANIZER` para trocar o responsável). */
  role?: 'ORGANIZER' | 'ADMIN' | 'PARTICIPANT';
  /** IDs que não podem ser escolhidos (ex.: a própria conta de destino da mescla). */
  excludeIds?: string[];
  /** Esconde quem já tem algum destes papéis (ex.: já é organizador). */
  excludeRoles?: AdminUser['roles'];
  value: AdminUser | null;
  onChange: (user: AdminUser | null) => void;
  error?: string;
}

/** Busca de conta por apelido ou e-mail, com a escolha destacada. Usa a lista de usuários do Admin. */
export function UserPicker({ label, hint, role, excludeIds = [], excludeRoles = [], value, onChange, error }: UserPickerProps) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim());
  const listId = useId();
  const enabled = value === null && term.length >= 2;
  const results = useAdminUsers({ q: term, role, status: 'ACTIVE' }, { enabled });
  const options = (results.data?.items ?? []).filter((u) => !excludeIds.includes(u.id) && !excludeRoles.some((r) => u.roles.includes(r))).slice(0, 6);

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border-strong bg-surface-2 px-3 py-2">
          <UserIdentity user={value} />
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} iconLeft={<X className="size-4" aria-hidden />}>
            Trocar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label={label}
        hint={hint ?? 'Digite pelo menos 2 letras do apelido ou do e-mail.'}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoComplete="off"
        error={error}
        aria-controls={listId}
      />
      <div id={listId} aria-live="polite">
        {enabled && results.isPending && <Skeleton className="h-12 w-full" />}
        {enabled && results.isError && <p className="text-sm text-danger">{errorMessage(results.error)}</p>}
        {enabled && results.isSuccess && options.length === 0 && <p className="text-sm text-muted">Nenhuma conta ativa encontrada com “{term}”.</p>}
        {enabled && options.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label={`Resultados para ${label}`}>
            {options.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(user);
                    setSearch('');
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-neutral-soft"
                >
                  <UserIdentity user={user} size="sm" />
                  <UserStatusPill status={user.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
