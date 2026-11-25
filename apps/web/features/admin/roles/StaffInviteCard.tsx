'use client';

import { CreateStaffInviteInput, type TournamentStaffInvite } from '@nova/schemas';
import { Button, Card, Input, Select } from '@nova/ui';
import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminTournaments } from '@/shared/api/hooks/admin-tournaments';
import { useCreateStaffInvite } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { adminRolesMessages } from './messages';

/** Campeonatos que ainda aceitam gente nova na equipe (encerrado, arquivado e cancelado não mudam mais). */
const CLOSED = new Set(['FINISHED', 'ARCHIVED', 'CANCELLED']);

/**
 * Convite para a equipe de **um campeonato** (co-organizador ou moderador), feito pela administração. Fica ao lado dos
 * convites de Admin e Organizador: daqui a administração manda link para todos os papéis. O link é o mesmo que o
 * responsável gera na aba Equipe do campeonato (`/equipe/convite/<token>`).
 */
export function StaffInviteCard() {
  const t = useT(adminRolesMessages, 'StaffInviteCard');
  const [query, setQuery] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [role, setRole] = useState<'CO_ORGANIZER' | 'MODERATOR'>('CO_ORGANIZER');
  const [validity, setValidity] = useState<'1h' | '24h' | '7d'>('24h');
  const [maxUses, setMaxUses] = useState('1');
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<TournamentStaffInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const tournaments = useAdminTournaments({ q: query.trim() || undefined });
  const create = useCreateStaffInvite(tournamentId);

  const open = (tournaments.data?.items ?? []).filter((x) => !CLOSED.has(x.status));
  const tournamentOptions = open.map((x) => ({ value: x.id, label: t('opcaoCampeonato', { nome: x.name, dono: x.ownerNickname }) }));
  const selected = open.find((x) => x.id === tournamentId);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    setCopied(false);
    if (!selected) {
      setProblem(t('escolhaCampeonato'));
      return;
    }
    const input = CreateStaffInviteInput.safeParse({ role, validity, maxUses: Number(maxUses) });
    if (!input.success) {
      setProblem(input.error.issues[0]?.message ?? t('confira'));
      return;
    }
    create.mutate(input.data, { onSuccess: (invite) => setCreated(invite), onError: (err) => setProblem(errorMessage(err)) });
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setProblem(t('erroCopiar'));
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-base">{t('titulo')}</h3>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label={t('titulo')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label={t('buscar')} placeholder={t('buscarPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          <Select
            label={t('campeonato')}
            placeholder={tournaments.isPending ? t('carregando') : open.length === 0 ? t('nenhum') : t('escolha')}
            options={tournamentOptions}
            value={tournamentId}
            onChange={(e) => {
              setTournamentId(e.target.value);
              setCreated(null);
            }}
            error={tournaments.isError ? errorMessage(tournaments.error) : undefined}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select
            label={t('papel')}
            options={[
              { value: 'CO_ORGANIZER', label: t('coOrganizador') },
              { value: 'MODERATOR', label: t('moderador') },
            ]}
            value={role}
            onChange={(e) => setRole(e.target.value === 'MODERATOR' ? 'MODERATOR' : 'CO_ORGANIZER')}
            hint={role === 'MODERATOR' ? t('moderadorDica') : t('coOrganizadorDica')}
          />
          <Select
            label={t('validade')}
            options={[
              { value: '1h', label: t('umaHora') },
              { value: '24h', label: t('vinteQuatroHoras') },
              { value: '7d', label: t('seteDias') },
            ]}
            value={validity}
            onChange={(e) => setValidity(e.target.value === '1h' ? '1h' : e.target.value === '7d' ? '7d' : '24h')}
          />
          <Input label={t('usos')} type="number" inputMode="numeric" min={1} max={10} hint={t('usosDica')} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
        {problem && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            {problem}
          </p>
        )}
        <Button type="submit" loading={create.isPending} className="self-start">
          {t('gerar')}
        </Button>
      </form>
      {created?.link && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft p-3 text-accent-soft-text" data-testid="staff-invite-created">
          <p className="text-sm font-semibold">{t('criado', { nome: selected?.name ?? '' })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1.5 font-mono text-xs text-text [overflow-wrap:anywhere]">{created.link}</code>
            <Button size="sm" variant="secondary" onClick={() => void copy(created.link ?? '')} iconLeft={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
              {copied ? t('copiado') : t('copiar')}
            </Button>
          </div>
          <p className="text-xs">{t('expira', { data: formatDateTime(created.expiresAt) })}</p>
        </div>
      )}
    </Card>
  );
}
