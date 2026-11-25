'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { OrganizerTournamentDetail, Registration, RegistrationStatus } from '@nova/schemas';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Modal, Select, StatusPill, Textarea, useToast, type Column, type SortState } from '@nova/ui';
import dynamic from 'next/dynamic';
import { Check, ClipboardList, Download, FileUp, Replace, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useExportRegistrations, useReviewRegistration } from '@/shared/api/hooks/organizer';
import { useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { getT } from '@/shared/i18n/core';
import { canStaffEditRoster } from '@/features/registrations/lib/rules';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { confirmedMembers, registrationKind } from '../lib/csv';
import { downloadFile } from '../lib/download';
import { WithdrawDialog } from '../operation/WithdrawDialog';
import { ImportCsvDialog } from './ImportCsvDialog';
import { RosterDialog } from './RosterDialog';
import { messages } from './messages';

// Inscrito avulso e elenco sem conta (RN-18): só baixam quando a organização abre uma das duas telas.
const AddRegistrationDialog = dynamic(() => import('./guests/AddRegistrationDialog').then((m) => m.AddRegistrationDialog));
const GuestRosterDialog = dynamic(() => import('./guests/GuestRosterDialog').then((m) => m.GuestRosterDialog));

type Filter = 'all' | 'confirmed' | 'pending' | 'waitlist' | 'out';
const FILTERS: { id: Filter; statuses: RegistrationStatus[] | null }[] = [
  { id: 'all', statuses: null },
  { id: 'confirmed', statuses: ['CONFIRMED'] },
  { id: 'pending', statuses: ['PENDING_APPROVAL', 'PENDING_MEMBERS'] },
  { id: 'waitlist', statuses: ['WAITLIST'] },
  { id: 'out', statuses: ['REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'] },
];
const STATUS_ORDER: RegistrationStatus[] = ['PENDING_APPROVAL', 'PENDING_MEMBERS', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'];
const BEFORE_START = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const STARTED = ['IN_PROGRESS', 'PAUSED'];
/** Inscrições cujo elenco a organização ainda troca (PRD §12.1). */
const ROSTER_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'PENDING_MEMBERS', 'PENDING_APPROVAL', 'WAITLIST'];

/** Validação do motivo; as mensagens vêm do catálogo, por isso o schema é montado na hora. */
function reasonInput() {
  const t = getT(messages, 'RegistrationReasonDialog');
  return z.object({ reason: z.string().trim().min(3, t('motivoMinimo')).max(300, t('motivoMaximo')) });
}
type ReasonForm = z.infer<ReturnType<typeof reasonInput>>;

type Action = { kind: 'reject' | 'remove' | 'replace' | 'withdraw' | 'roster' | 'guests'; registration: Registration } | null;

function ReasonDialog({ action, loading, onClose, onSubmit }: { action: Exclude<Action, null>; loading: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const t = useT(messages, 'RegistrationReasonDialog');
  const [schema] = useState(reasonInput);
  const form = useForm<ReasonForm>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });
  const name = action.registration.displayName;
  const isReject = action.kind === 'reject';
  const acao = isReject ? 'reject' : 'remove';
  const reasonField = form.register('reason');
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('titulo', { acao, nome: name })}
      description={
        isReject
          ? t('descricaoRecusar')
          : t('descricaoRemover')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button variant="danger" type="submit" form="motivo-inscricao" loading={loading}>
            {t('confirmar', { acao })}
          </Button>
        </>
      }
    >
      <form id="motivo-inscricao" noValidate onSubmit={(event) => void form.handleSubmit(({ reason }) => onSubmit(reason))(event)}>
        <Textarea label={t('motivo')} required rows={3} maxLength={300} autoFocus hint={t('motivoDica')} error={form.formState.errors.reason?.message} {...reasonField} />
      </form>
    </Modal>
  );
}

function ReplaceDialog({ action, waitlist, loading, onClose, onSubmit }: { action: Exclude<Action, null>; waitlist: Registration[]; loading: boolean; onClose: () => void; onSubmit: (withRegistrationId: string) => void }) {
  const t = useT(messages, 'RegistrationReplaceDialog');
  const [chosen, setChosen] = useState(waitlist[0]?.id ?? '');
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('titulo', { nome: action.registration.displayName })}
      description={t('descricao')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button loading={loading} disabled={!chosen} onClick={() => onSubmit(chosen)}>
            {t('substituir')}
          </Button>
        </>
      }
    >
      <Select
        label={t('quemEntra')}
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        options={waitlist.map((r) => ({ value: r.id, label: r.tag ? t('opcaoComTag', { posicao: r.waitlistPosition ?? '–', nome: r.displayName, tag: r.tag }) : t('opcao', { posicao: r.waitlistPosition ?? '–', nome: r.displayName }) }))}
      />
    </Modal>
  );
}

function Counter({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    // Leitor de tela: rótulo, número e detalhe (dt antes dos dd); na tela o número vem em cima.
    <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
      <dt className="order-2 text-sm text-muted">{label}</dt>
      <dd className="order-1 tabular text-2xl font-bold text-text">{value}</dd>
      {hint && <dd className="order-3 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Aba Inscrições (issue #30): lista, filtros, contadores, aprovar/recusar/remover/substituir, lista de espera e CSV. */
export function RegistrationsTab({ tournament }: { tournament: OrganizerTournamentDetail }) {
  const t = useT(messages, 'RegistrationsTab');
  const query = useTournamentRegistrations(tournament.id, 'all');
  const review = useReviewRegistration(tournament.id);
  const exporter = useExportRegistrations(tournament.id);
  const { success, error } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const isModerator = tournament.access === 'MODERATOR';
  const beforeStart = BEFORE_START.includes(tournament.status);
  const started = STARTED.includes(tournament.status);
  const isTeam = tournament.participantType === 'TEAM';
  // Titulares e reservas do modo: definem o elenco sem conta e as colunas de elenco da planilha (RN-18).
  const game = useGame(isTeam ? tournament.gameId : undefined);
  const mode = game.data?.modes.find((m) => m.id === tournament.gameModeId);
  const roster = isTeam && mode ? { teamSize: mode.teamSize, maxSubs: mode.maxSubs } : null;
  /** Em campeonato por squad, o formulário e a planilha esperam o modo carregar para saber o tamanho do elenco. */
  const rosterReady = !isTeam || roster !== null;
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
    return promoted.length === 1 ? t('promovido', { nomes: names }) : t('promovidos', { nomes: names });
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
        onError: (e) => error(t('erroConcluir'), errorMessage(e)),
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
    if (ok > 0) success(t('aprovadas', { count: ok }));
    if (failed) error(t('erroAprovarTodas'), failed);
  }

  if (tournament.status === 'DRAFT') {
    return <EmptyState icon={<ClipboardList className="size-7" />} title={t('rascunhoTitulo')} description={t('rascunhoDescricao')} />;
  }
  if (!query.data && query.error) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  /** Squad criado pela organização (planilha ou cadastro manual): o elenco é de jogadores sem conta. */
  const isStaffSquad = (r: Registration) => isTeam && r.teamId === null && r.userId === null;

  const columns: Column<Registration>[] = [
    {
      id: 'name',
      header: t('colunaNome', { tipo: isTeam ? 'team' : 'solo' }),
      primary: true,
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="font-semibold text-text">{r.displayName}</span>
          {r.tag && <span className="tabular text-xs text-muted">[{r.tag}]</span>}
        </span>
      ),
    },
    { id: 'kind', header: t('colunaTipo'), cell: (r) => registrationKind(r) },
    {
      id: 'status',
      header: t('colunaStatus'),
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={r.status === 'CANCELLED' ? 'CANCELLED' : r.status} label={r.status === 'CANCELLED' ? t('removida') : r.status === 'WAITLIST' && r.waitlistPosition ? t('listaEsperaPosicao', { posicao: r.waitlistPosition }) : undefined} />
          {r.statusReason && <span className="text-xs whitespace-normal text-muted">{t('motivo', { motivo: r.statusReason })}</span>}
        </span>
      ),
    },
    {
      id: 'members',
      header: t('colunaMembros'),
      // Squad sem conta (RN-18): não há confirmação; conta os titulares que a organização colocou.
      cell: (r) => (r.teamId ? t('membros', { confirmados: confirmedMembers(r), exigidos: r.requiredMembers }) : isStaffSquad(r) ? t('jogadoresSemConta', { titulares: r.guests.filter((g) => !g.isSub).length, exigidos: r.requiredMembers }) : '—'),
    },
    { id: 'date', header: t('colunaData'), sortable: true, cell: (r) => formatDateTime(r.createdAt, { withZone: false }) },
  ];

  function rowActions(r: Registration) {
    const buttons = [];
    if (!isModerator && isStaffSquad(r) && ROSTER_STATUSES.includes(r.status) && canStaffEditRoster(tournament.status)) {
      buttons.push(
        <Button key="guests" size="sm" variant="secondary" iconLeft={<Users className="size-4" aria-hidden />} aria-label={t('elencoRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'guests', registration: r })}>
          {t('elenco')}
        </Button>,
      );
    }
    // Elenco do squad: trocar, tirar e remanejar jogadores (também com o campeonato em andamento).
    if (!isModerator && r.teamId && ROSTER_STATUSES.includes(r.status) && canStaffEditRoster(tournament.status)) {
      buttons.push(
        <Button key="roster" size="sm" variant="secondary" iconLeft={<Users className="size-4" aria-hidden />} aria-label={t('elencoRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'roster', registration: r })}>
          {t('elenco')}
        </Button>,
      );
    }
    if (beforeStart && r.status === 'PENDING_APPROVAL') {
      buttons.push(
        <Button key="approve" size="sm" loading={review.isPending && review.variables?.registrationId === r.id} iconLeft={<Check className="size-4" aria-hidden />} aria-label={t('aprovarRotulo', { nome: r.displayName })} onClick={() => run(r, { action: 'approve' }, t('aprovado', { nome: r.displayName }))}>
          {t('aprovar')}
        </Button>,
        <Button key="reject" size="sm" variant="secondary" iconLeft={<X className="size-4" aria-hidden />} aria-label={t('recusarRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'reject', registration: r })}>
          {t('recusar')}
        </Button>,
      );
    }
    if (!isModerator && beforeStart && r.status === 'CONFIRMED' && waitlist.length > 0) {
      buttons.push(
        <Button key="replace" size="sm" variant="secondary" iconLeft={<Replace className="size-4" aria-hidden />} aria-label={t('substituirRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'replace', registration: r })}>
          {t('substituir')}
        </Button>,
      );
    }
    if (!isModerator && beforeStart && (r.status === 'CONFIRMED' || r.status === 'PENDING_MEMBERS' || r.status === 'WAITLIST')) {
      buttons.push(
        <Button key="remove" size="sm" variant="ghost" iconLeft={<UserMinus className="size-4" aria-hidden />} aria-label={t('removerRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'remove', registration: r })}>
          {t('remover')}
        </Button>,
      );
    }
    // Com o campeonato em andamento a saída é desistência ou desclassificação, com motivo (RN-06). Moderador não desclassifica.
    if (!isModerator && started && r.status === 'CONFIRMED') {
      buttons.push(
        <Button key="withdraw" size="sm" variant="ghost" iconLeft={<UserMinus className="size-4" aria-hidden />} aria-label={t('desclassificarRotulo', { nome: r.displayName })} onClick={() => setAction({ kind: 'withdraw', registration: r })}>
          {t('desclassificar')}
        </Button>,
      );
    }
    return buttons.length > 0 ? <span className="flex flex-wrap justify-end gap-2">{buttons}</span> : null;
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t('resumo')}>
        <Counter label={t('confirmadas')} value={String(count('CONFIRMED'))} />
        <Counter label={t('aguardando')} value={String(count('PENDING_APPROVAL', 'PENDING_MEMBERS'))} hint={t('aguardandoDica', { aprovacao: count('PENDING_APPROVAL'), membros: count('PENDING_MEMBERS') })} />
        <Counter label={t('listaEspera')} value={String(waitlist.length)} hint={tournament.waitlistEnabled ? undefined : t('desligada')} />
        <Counter label={t('vagasOcupadas')} value={`${count('CONFIRMED', 'PENDING_APPROVAL', 'PENDING_MEMBERS')}/${tournament.maxParticipants}`} />
      </dl>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Select
          className="md:w-64"
          label={t('mostrar')}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setSelected([]);
          }}
          options={FILTERS.map((f) => ({ value: f.id, label: t(`filtros.${f.id}`, { count: f.statuses ? count(...f.statuses) : all.length }) }))}
        />
        <div className="flex flex-wrap gap-2">
          {!isModerator && beforeStart && (
            <>
              <Button variant="secondary" disabled={!rosterReady} iconLeft={<UserPlus className="size-4" aria-hidden />} onClick={() => setAddOpen(true)}>
                {t('adicionarInscrito')}
              </Button>
              <Button variant="secondary" disabled={!rosterReady} iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => setImportOpen(true)}>
                {t('importarCsv')}
              </Button>
            </>
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
                  success(t('exportacaoPronta'), t('exportacaoDescricao'));
                },
                onError: (e) => error(t('erroExportar'), errorMessage(e)),
              })
            }
          >
            {t('exportarCsv')}
          </Button>
        </div>
      </div>

      {started && !isModerator && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text" data-testid="started-note">
          {t('emAndamento')}
        </p>
      )}

      <DataTable
        caption={t('legenda', { nome: tournament.name })}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        sort={sort}
        onSortChange={setSort}
        selected={beforeStart && tournament.manualApproval ? selected : undefined}
        onSelectedChange={beforeStart && tournament.manualApproval ? setSelected : undefined}
        bulkActions={
          <Button size="sm" loading={bulkBusy} disabled={selectedPending.length === 0} iconLeft={<Check className="size-4" aria-hidden />} onClick={() => void approveSelected()}>
            {t('aprovarSelecionadas', { count: selectedPending.length })}
          </Button>
        }
        rowActions={rowActions}
        empty={
          <EmptyState
            icon={<ClipboardList className="size-7" />}
            title={filter === 'all' ? t('vazioTitulo') : t('filtroVazioTitulo')}
            description={filter === 'all' ? t('vazioDescricao') : t('filtroVazioDescricao')}
          />
        }
      />

      {waitlist.length > 0 && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">{t('listaEspera')}</h2>
            <Badge tone="info">{t('naFila', { count: waitlist.length })}</Badge>
          </div>
          <p className="text-sm text-muted">{t('esperaExplicacao', { manual: tournament.manualApproval ? 'sim' : 'nao' })}</p>
          <ol className="flex flex-col gap-2" aria-label={t('listaEsperaOrdem')}>
            {waitlist.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft font-bold text-info-soft-text">{r.waitlistPosition}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-text">{r.displayName}</span>
                  {r.tag && <span className="tabular text-xs text-muted"> [{r.tag}]</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{t('desde', { data: formatDateTime(r.createdAt, { withZone: false }) })}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {action && (action.kind === 'reject' || action.kind === 'remove') && (
        <ReasonDialog
          key={`${action.kind}-${action.registration.id}`}
          action={action}
          loading={review.isPending}
          onClose={() => setAction(null)}
          onSubmit={(reason) =>
            run(action.registration, { action: action.kind === 'reject' ? 'reject' : 'remove', reason }, action.kind === 'reject' ? t('recusada', { nome: action.registration.displayName }) : t('removido', { nome: action.registration.displayName }))
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
          onSubmit={(withRegistrationId) => run(action.registration, { action: 'replace', withRegistrationId }, t('substituido', { nome: action.registration.displayName }))}
        />
      )}
      {action?.kind === 'roster' && (
        <RosterDialog
          key={action.registration.id}
          tournament={tournament}
          // A versão mais nova da inscrição (a lista é recarregada a cada troca).
          registration={all.find((x) => x.id === action.registration.id) ?? action.registration}
          others={all.filter((x) => x.id !== action.registration.id && x.teamId !== null && ROSTER_STATUSES.includes(x.status))}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === 'withdraw' && <WithdrawDialog key={action.registration.id} tournament={tournament} registration={action.registration} onClose={() => setAction(null)} />}
      {action?.kind === 'guests' && (
        <GuestRosterDialog
          key={action.registration.id}
          tournament={tournament}
          // A versão mais nova da inscrição (a lista é recarregada a cada troca).
          registration={all.find((x) => x.id === action.registration.id) ?? action.registration}
          roster={roster}
          onClose={() => setAction(null)}
        />
      )}
      <ImportCsvDialog tournamentId={tournament.id} isTeam={isTeam} roster={roster} open={importOpen} onOpenChange={setImportOpen} />
      {addOpen && <AddRegistrationDialog tournamentId={tournament.id} isTeam={isTeam} roster={roster} open onOpenChange={setAddOpen} />}
    </div>
  );
}
