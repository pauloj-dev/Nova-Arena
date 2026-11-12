'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { OrganizerTournamentDetail, Registration, RegistrationStatus } from '@nova/schemas';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Modal, Select, StatusPill, Textarea, useToast, type Column, type SortState } from '@nova/ui';
import { Check, ClipboardList, Download, FileUp, Replace, UserMinus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useExportRegistrations, useReviewRegistration } from '@/shared/api/hooks/organizer';
import { useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { formatDateTime } from '@/shared/lib/datetime';
import { confirmedMembers, registrationKind } from '../lib/csv';
import { downloadFile } from '../lib/download';
import { ImportCsvDialog } from './ImportCsvDialog';

type Filter = 'all' | 'confirmed' | 'pending' | 'waitlist' | 'out';
const FILTERS: { id: Filter; label: string; statuses: RegistrationStatus[] | null }[] = [
  { id: 'all', label: 'Todas', statuses: null },
  { id: 'confirmed', label: 'Confirmadas', statuses: ['CONFIRMED'] },
  { id: 'pending', label: 'Aguardando', statuses: ['PENDING_APPROVAL', 'PENDING_MEMBERS'] },
  { id: 'waitlist', label: 'Lista de espera', statuses: ['WAITLIST'] },
  { id: 'out', label: 'Recusadas e removidas', statuses: ['REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'] },
];
const STATUS_ORDER: RegistrationStatus[] = ['PENDING_APPROVAL', 'PENDING_MEMBERS', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'];
const BEFORE_START = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const STARTED = ['IN_PROGRESS', 'PAUSED'];

const ReasonInput = z.object({ reason: z.string().trim().min(3, 'Informe o motivo (pelo menos 3 letras)').max(300, 'Use no máximo 300 caracteres') });
type ReasonForm = z.infer<typeof ReasonInput>;

type Action = { kind: 'reject' | 'remove' | 'replace'; registration: Registration } | null;

function ReasonDialog({ action, started, loading, onClose, onSubmit }: { action: Exclude<Action, null>; started: boolean; loading: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const form = useForm<ReasonForm>({ resolver: zodResolver(ReasonInput), defaultValues: { reason: '' } });
  const name = action.registration.displayName;
  const isReject = action.kind === 'reject';
  const verb = isReject ? 'Recusar' : started ? 'Desclassificar' : 'Remover';
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${verb} ${name}?`}
      description={
        isReject
          ? 'A inscrição é recusada e a pessoa fica sabendo o motivo.'
          : started
            ? 'Com o campeonato em andamento, a saída é uma desclassificação e a vaga não é reposta.'
            : 'A vaga é liberada e, se houver lista de espera, o primeiro da fila assume.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" type="submit" form="motivo-inscricao" loading={loading}>
            {verb} inscrição
          </Button>
        </>
      }
    >
      <form id="motivo-inscricao" noValidate onSubmit={(event) => void form.handleSubmit(({ reason }) => onSubmit(reason))(event)}>
        <Textarea label="Motivo" required rows={3} maxLength={300} autoFocus hint="Quem se inscreveu vê este texto." error={form.formState.errors.reason?.message} {...form.register('reason')} />
      </form>
    </Modal>
  );
}

function ReplaceDialog({ action, waitlist, loading, onClose, onSubmit }: { action: Exclude<Action, null>; waitlist: Registration[]; loading: boolean; onClose: () => void; onSubmit: (withRegistrationId: string) => void }) {
  const [chosen, setChosen] = useState(waitlist[0]?.id ?? '');
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Substituir ${action.registration.displayName}`}
      description="Quem você escolher sai da lista de espera e assume a vaga. A inscrição substituída é cancelada."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={loading} disabled={!chosen} onClick={() => onSubmit(chosen)}>
            Substituir
          </Button>
        </>
      }
    >
      <Select
        label="Quem entra no lugar"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        options={waitlist.map((r) => ({ value: r.id, label: `${r.waitlistPosition ?? '–'}º da fila · ${r.displayName}${r.tag ? ` [${r.tag}]` : ''}` }))}
      />
    </Modal>
  );
}

function Counter({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dd className="tabular text-2xl font-bold text-text">{value}</dd>
      <dt className="text-sm text-muted">{label}</dt>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Aba Inscrições (issue #30): lista, filtros, contadores, aprovar/recusar/remover/substituir, lista de espera e CSV. */
export function RegistrationsTab({ tournament: t }: { tournament: OrganizerTournamentDetail }) {
  const query = useTournamentRegistrations(t.id, 'all');
  const review = useReviewRegistration(t.id);
  const exporter = useExportRegistrations(t.id);
  const { success, error } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const isModerator = t.access === 'MODERATOR';
  const beforeStart = BEFORE_START.includes(t.status);
  const started = STARTED.includes(t.status);
  const isTeam = t.participantType === 'TEAM';
  const all = useMemo(() => query.data ?? [], [query.data]);
  const waitlist = useMemo(() => all.filter((r) => r.status === 'WAITLIST').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0)), [all]);
  const count = (...statuses: RegistrationStatus[]) => all.filter((r) => statuses.includes(r.status)).length;

  const rows = useMemo(() => {
    const statuses = FILTERS.find((f) => f.id === filter)?.statuses;
    const list = all.filter((r) => !statuses || statuses.includes(r.status));
    const byDefault = (a: Registration, b: Registration) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt);
    if (!sort) return list.sort(byDefault);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.id === 'name') return a.displayName.localeCompare(b.displayName, 'pt-BR') * dir;
      if (sort.id === 'date') return a.createdAt.localeCompare(b.createdAt) * dir;
      return byDefault(a, b) * dir;
    });
  }, [all, filter, sort]);

  function notifyPromoted(promoted: Registration[]) {
    if (promoted.length === 0) return undefined;
    const names = promoted.map((p) => p.displayName).join(', ');
    return promoted.length === 1 ? `${names} saiu da lista de espera e ficou com a vaga.` : `Saíram da lista de espera: ${names}.`;
  }

  function run(registration: Registration, input: Parameters<typeof review.mutate>[0]['input'], done: string) {
    review.mutate(
      { registrationId: registration.id, input },
      {
        onSuccess: (result) => {
          success(done, notifyPromoted(result.promoted));
          setAction(null);
          setSelected((list) => list.filter((id) => id !== registration.id));
        },
        onError: (e) => error('Não foi possível concluir', errorMessage(e)),
      },
    );
  }

  const selectedPending = all.filter((r) => selected.includes(r.id) && r.status === 'PENDING_APPROVAL');
  async function approveSelected() {
    setBulkBusy(true);
    let ok = 0;
    let failed: string | null = null;
    for (const r of selectedPending) {
      try {
        await review.mutateAsync({ registrationId: r.id, input: { action: 'approve' } });
        ok += 1;
      } catch (e) {
        failed = errorMessage(e);
        break;
      }
    }
    setBulkBusy(false);
    setSelected([]);
    if (ok > 0) success(ok === 1 ? '1 inscrição aprovada' : `${ok} inscrições aprovadas`);
    if (failed) error('Nem todas foram aprovadas', failed);
  }

  if (t.status === 'DRAFT') {
    return <EmptyState icon={<ClipboardList className="size-7" />} title="As inscrições começam depois de publicar" description="Enquanto o campeonato é um rascunho, ninguém consegue se inscrever." />;
  }
  if (!query.data && query.error) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const columns: Column<Registration>[] = [
    {
      id: 'name',
      header: isTeam ? 'Squad' : 'Jogador',
      primary: true,
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="font-semibold text-text">{r.displayName}</span>
          {r.tag && <span className="tabular text-xs text-muted">[{r.tag}]</span>}
        </span>
      ),
    },
    { id: 'kind', header: 'Tipo', cell: (r) => registrationKind(r) },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={r.status === 'CANCELLED' ? 'CANCELLED' : r.status} label={r.status === 'CANCELLED' ? 'Removida' : r.status === 'WAITLIST' && r.waitlistPosition ? `Lista de espera · ${r.waitlistPosition}º` : undefined} />
          {r.statusReason && <span className="text-xs whitespace-normal text-muted">Motivo: {r.statusReason}</span>}
        </span>
      ),
    },
    { id: 'members', header: 'Membros confirmados', cell: (r) => (r.teamId ? `${confirmedMembers(r)} de ${r.requiredMembers}` : '—') },
    { id: 'date', header: 'Inscrição em', sortable: true, cell: (r) => formatDateTime(r.createdAt, { withZone: false }) },
  ];

  function rowActions(r: Registration) {
    const buttons = [];
    if (beforeStart && r.status === 'PENDING_APPROVAL') {
      buttons.push(
        <Button key="approve" size="sm" loading={review.isPending && review.variables?.registrationId === r.id} iconLeft={<Check className="size-4" aria-hidden />} aria-label={`Aprovar ${r.displayName}`} onClick={() => run(r, { action: 'approve' }, `${r.displayName} aprovado`)}>
          Aprovar
        </Button>,
        <Button key="reject" size="sm" variant="secondary" iconLeft={<X className="size-4" aria-hidden />} aria-label={`Recusar ${r.displayName}`} onClick={() => setAction({ kind: 'reject', registration: r })}>
          Recusar
        </Button>,
      );
    }
    if (!isModerator && beforeStart && r.status === 'CONFIRMED' && waitlist.length > 0) {
      buttons.push(
        <Button key="replace" size="sm" variant="secondary" iconLeft={<Replace className="size-4" aria-hidden />} aria-label={`Substituir ${r.displayName}`} onClick={() => setAction({ kind: 'replace', registration: r })}>
          Substituir
        </Button>,
      );
    }
    if (!isModerator && (beforeStart || started) && (r.status === 'CONFIRMED' || r.status === 'PENDING_MEMBERS' || r.status === 'WAITLIST')) {
      buttons.push(
        <Button key="remove" size="sm" variant="ghost" iconLeft={<UserMinus className="size-4" aria-hidden />} aria-label={`${started ? 'Desclassificar' : 'Remover'} ${r.displayName}`} onClick={() => setAction({ kind: 'remove', registration: r })}>
          {started ? 'Desclassificar' : 'Remover'}
        </Button>,
      );
    }
    return buttons.length > 0 ? <span className="flex flex-wrap justify-end gap-2">{buttons}</span> : null;
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Resumo das inscrições">
        <Counter label="Confirmadas" value={String(count('CONFIRMED'))} />
        <Counter label="Aguardando" value={String(count('PENDING_APPROVAL', 'PENDING_MEMBERS'))} hint={`${count('PENDING_APPROVAL')} aprovação · ${count('PENDING_MEMBERS')} membros`} />
        <Counter label="Lista de espera" value={String(waitlist.length)} hint={t.waitlistEnabled ? undefined : 'Desligada'} />
        <Counter label="Vagas ocupadas" value={`${count('CONFIRMED', 'PENDING_APPROVAL', 'PENDING_MEMBERS')}/${t.maxParticipants}`} />
      </dl>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Select
          className="md:w-64"
          label="Mostrar"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setSelected([]);
          }}
          options={FILTERS.map((f) => ({ value: f.id, label: `${f.label} (${f.statuses ? count(...f.statuses) : all.length})` }))}
        />
        <div className="flex flex-wrap gap-2">
          {!isModerator && beforeStart && (
            <Button variant="secondary" iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => setImportOpen(true)}>
              Importar CSV
            </Button>
          )}
          <Button
            variant="secondary"
            loading={exporter.isPending}
            disabled={all.length === 0}
            iconLeft={<Download className="size-4" aria-hidden />}
            onClick={() =>
              exporter.mutate(undefined, {
                onSuccess: ({ blob, filename }) => {
                  downloadFile(blob, filename);
                  success('Exportação pronta', 'O arquivo abre direto no Excel.');
                },
                onError: (e) => error('Não foi possível exportar', errorMessage(e)),
              })
            }
          >
            Exportar CSV
          </Button>
        </div>
      </div>

      <DataTable
        caption={`Inscrições de ${t.name}`}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        sort={sort}
        onSortChange={setSort}
        selected={beforeStart && t.manualApproval ? selected : undefined}
        onSelectedChange={beforeStart && t.manualApproval ? setSelected : undefined}
        bulkActions={
          <Button size="sm" loading={bulkBusy} disabled={selectedPending.length === 0} iconLeft={<Check className="size-4" aria-hidden />} onClick={() => void approveSelected()}>
            {selectedPending.length === 0 ? 'Nenhuma aguardando aprovação' : selectedPending.length === 1 ? 'Aprovar 1 selecionada' : `Aprovar ${selectedPending.length} selecionadas`}
          </Button>
        }
        rowActions={rowActions}
        empty={
          <EmptyState
            icon={<ClipboardList className="size-7" />}
            title={filter === 'all' ? 'Ninguém se inscreveu ainda' : 'Nenhuma inscrição neste filtro'}
            description={filter === 'all' ? 'Compartilhe o link da página pública. Quem se inscrever aparece aqui.' : 'Troque o filtro para ver as outras inscrições.'}
          />
        }
      />

      {waitlist.length > 0 && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">Lista de espera</h2>
            <Badge tone="info">{waitlist.length} na fila</Badge>
          </div>
          <p className="text-sm text-muted">Quando uma vaga é liberada, o primeiro da fila assume sozinho{t.manualApproval ? ' (e entra aguardando a sua aprovação)' : ''}.</p>
          <ol className="flex flex-col gap-2" aria-label="Lista de espera, em ordem">
            {waitlist.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft font-bold text-info-soft-text">{r.waitlistPosition}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-text">{r.displayName}</span>
                  {r.tag && <span className="tabular text-xs text-muted"> [{r.tag}]</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">desde {formatDateTime(r.createdAt, { withZone: false })}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {action && action.kind !== 'replace' && (
        <ReasonDialog
          key={`${action.kind}-${action.registration.id}`}
          action={action}
          started={started}
          loading={review.isPending}
          onClose={() => setAction(null)}
          onSubmit={(reason) =>
            run(action.registration, { action: action.kind === 'reject' ? 'reject' : 'remove', reason }, action.kind === 'reject' ? `Inscrição de ${action.registration.displayName} recusada` : `${action.registration.displayName} ${started ? 'desclassificado' : 'removido'}`)
          }
        />
      )}
      {action?.kind === 'replace' && (
        <ReplaceDialog
          key={action.registration.id}
          action={action}
          waitlist={waitlist}
          loading={review.isPending}
          onClose={() => setAction(null)}
          onSubmit={(withRegistrationId) => run(action.registration, { action: 'replace', withRegistrationId }, `${action.registration.displayName} foi substituído`)}
        />
      )}
      <ImportCsvDialog tournamentId={t.id} isTeam={isTeam} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
