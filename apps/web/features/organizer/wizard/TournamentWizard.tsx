'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TournamentDraftInput, type Game, type GameMode, type OrganizerTournamentDetail, type TournamentTemplate } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton, Stepper, useToast } from '@nova/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Rocket, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, get, useForm, useWatch, type Resolver } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useOrganizerTournament, usePublishTournament } from '@/shared/api/hooks/organizer';
import { keys } from '@/shared/api/keys';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { Tip } from '../onboarding/Tip';
import { formatDate } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { NoAccess, TournamentNotFound } from '../components/NoAccess';
import {
  defaultWizardValues,
  findMode,
  isValidName,
  selectableGames,
  stagesFitMode,
  templateToValues,
  toDraftPayload,
  tournamentToValues,
  valuesForValidation,
  withStageKeys,
  type WizardValues,
} from '../lib/draft';
import { defaultMaxParticipants, suggestedStages } from '../lib/formats';
import { IssueList } from '../stage-builder/IssueList';
import { isRichTextEmpty, REVIEW_STEP, validateDraft, WIZARD_STEPS } from '../validation';
import { WizardContext, type WizardContextValue } from './context';
import { SaveIndicator } from './SaveIndicator';
import { GameStep } from './steps/GameStep';
import { InfoStep } from './steps/InfoStep';
import { RegistrationStep } from './steps/RegistrationStep';
import { ReviewStep } from './steps/ReviewStep';
import { RulesStep } from './steps/RulesStep';
import { ScoringStep } from './steps/ScoringStep';
import { StagesStep } from './steps/StagesStep';
import { useAutosave } from './useAutosave';

const editPath = (id: string) => `/organizador/campeonatos/${id}/editar`;
const managePath = (id: string) => `/organizador/campeonatos/${id}`;

// O formulário guarda mais do que o contrato (a chave local de cada fase); o schema da API valida os campos em comum.
const resolver = zodResolver(TournamentDraftInput) as unknown as Resolver<WizardValues>;

export interface WizardFormProps {
  games: Game[];
  userId: string;
  /** Rascunho ou campeonato existente. Ausente = campeonato novo. */
  tournament?: OrganizerTournamentDetail;
  /** Começar a partir de um modelo. */
  template?: TournamentTemplate;
}

export function WizardSkeleton() {
  return (
    <PageContainer>
      <div role="status" aria-label="Carregando o assistente" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="hidden h-96 lg:block" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full lg:hidden" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/** Assistente de criação em 7 passos (issue #22), com rascunho automático. */
export function WizardForm({ games, userId, tournament, template }: WizardFormProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { success, error: toastError, toast } = useToast();
  const publish = usePublishTournament();

  const selectable = useMemo(() => selectableGames(games, null), [games]);
  const [boot] = useState(() => {
    const now = new Date();
    const base = defaultWizardValues(now, selectableGames(games, null));
    return { now, initial: tournament ? tournamentToValues(tournament) : template ? templateToValues(template, base) : base };
  });
  const form = useForm<WizardValues>({ defaultValues: boot.initial, resolver, mode: 'onChange' });
  const values = useWatch({ control: form.control }) as WizardValues;

  const status = tournament?.status ?? 'DRAFT';
  const isPublished = status !== 'DRAFT';
  const hasStarted = status === 'IN_PROGRESS' || status === 'PAUSED';
  const takenSlots = tournament?.takenSlots ?? 0;
  const [lockedStageIds] = useState(() => (tournament?.stages ?? []).filter((s) => s.status !== 'PENDING').map((s) => s.id));

  const [tournamentId, setTournamentId] = useState<string | null>(tournament?.id ?? null);
  const [step, setStep] = useState(() => (isPublished ? 0 : (tournament?.draftStep ?? 0)));
  const [reached, setReached] = useState(() => (isPublished ? REVIEW_STEP : (tournament?.draftStep ?? 0)));
  const [attempted, setAttempted] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const { game, mode } = findMode(games, values.gameId, values.gameModeId);
  const issues = useMemo(
    () => validateDraft(valuesForValidation(values), { games, now: boot.now, alreadyPublished: isPublished, takenSlots: isPublished ? takenSlots : undefined }),
    [values, games, boot.now, isPublished, takenSlots],
  );
  const payload = useMemo(() => toDraftPayload(values, step), [values, step]);

  const mounted = useRef(true);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { getValues, setValue } = form;
  const onSaved = useCallback(
    (saved: OrganizerTournamentDetail, sent: TournamentDraftInput, created: boolean) => {
      // A gravação pode terminar depois de a pessoa sair do assistente: aí não há tela para atualizar.
      if (!mounted.current) return;
      if (created) {
        setTournamentId(saved.id);
        // O rascunho passou a existir: o endereço vira o de edição, sem recarregar a tela.
        window.history.replaceState(null, '', editPath(saved.id));
      }
      // As fases novas ganham `id` na API; a tela passa a mandar esse `id` nas próximas gravações.
      const current = getValues('stages');
      const ordered = [...saved.stages].sort((a, b) => a.order - b.order);
      if (current.length !== ordered.length || current.every((s, i) => s.id === ordered[i]?.id)) return;
      const unchangedSinceSent = JSON.stringify(toDraftPayload(getValues(), stepRef.current)) === JSON.stringify(sent);
      setValue(
        'stages',
        current.map((s, i) => ({ ...s, id: ordered[i]?.id })),
      );
      return unchangedSinceSent ? toDraftPayload(getValues(), stepRef.current) : undefined;
    },
    [getValues, setValue],
  );

  const autosave = useAutosave({ tournamentId, payload, templateId: template?.id, canCreate: isValidName(values.name), auto: !isPublished, onSaved });

  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const goToStep = useCallback(
    (next: number) => {
      const target = Math.min(REVIEW_STEP, Math.max(0, next));
      const current = getValues();
      // Chegando às Fases sem nenhuma: já deixa a sugestão para o modo e as vagas escolhidos.
      if (target >= 3 && current.stages.length === 0 && !isPublished) {
        const found = findMode(games, current.gameId, current.gameModeId);
        if (found.game && found.mode) {
          setValue('stages', withStageKeys(suggestedStages({ game: found.game, mode: found.mode, userId, maxParticipants: current.maxParticipants })), { shouldDirty: true });
        }
      }
      setStep(target);
      setReached((r) => Math.max(r, target));
      setPublishError(null);
      // Trocar de passo grava o rascunho na hora, já com o passo novo.
      if (!isPublished) void autosave.flush(toDraftPayload(getValues(), target));
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0 });
        headingRef.current?.focus({ preventScroll: true });
      });
    },
    [autosave, games, getValues, isPublished, setValue, userId],
  );

  function selectGameMode(nextGame: Game, nextMode: GameMode) {
    const current = getValues();
    if (current.gameId === nextGame.id && current.gameModeId === nextMode.id) return;
    const previous = findMode(games, current.gameId, current.gameModeId).mode;
    setValue('gameId', nextGame.id, { shouldDirty: true });
    setValue('gameModeId', nextMode.id, { shouldDirty: true });
    // As vagas acompanham o modo enquanto a pessoa não mexeu nelas.
    if (current.maxParticipants === defaultMaxParticipants(previous)) setValue('maxParticipants', defaultMaxParticipants(nextMode), { shouldDirty: true });
    if (current.stages.length > 0 && !stagesFitMode(current.stages, nextGame, nextMode)) {
      setValue('stages', [], { shouldDirty: true });
      toast({ title: 'As fases foram reiniciadas', description: `As fases que você tinha não servem para ${nextGame.name} · ${nextMode.name}. No passo Fases há uma nova sugestão.` });
    }
    if (!current.gameModeId || !nextMode.teamSize || nextMode.teamSize < 2) setValue('rosterLockAt', null);
  }

  const stepIssues = issues.filter((i) => i.step === step);
  const showStepIssues = attempted.includes(step) || reached > step;

  function fieldError(field: string): string | undefined {
    const fromForm = (get(form.formState.errors, field) as { message?: unknown } | undefined)?.message;
    if (typeof fromForm === 'string' && fromForm !== '') return fromForm;
    const issue = issues.find((i) => i.field === field);
    return issue && (attempted.includes(issue.step) || reached > issue.step) ? issue.message : undefined;
  }

  function handleContinue() {
    if (stepIssues.length > 0) {
      setAttempted((list) => (list.includes(step) ? list : [...list, step]));
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    goToStep(step + 1);
  }

  async function handlePublish() {
    setPublishError(null);
    if (issues.length > 0) {
      setAttempted([0, 1, 2, 3, 4, 5]);
      return;
    }
    const id = await autosave.flush(toDraftPayload(getValues(), REVIEW_STEP));
    if (!id) {
      setPublishError(`Não foi possível salvar o rascunho. ${errorMessage(autosave.lastError.current)}`);
      return;
    }
    publish.mutate(
      { id },
      {
        onSuccess: (published) => {
          success('Campeonato publicado!', published.status === 'REGISTRATION_OPEN' ? 'As inscrições já estão abertas.' : 'As inscrições abrem na data que você marcou.');
          router.push(managePath(published.id));
        },
        onError: (e) => {
          const details = e instanceof ApiError ? Object.values(e.fieldErrors) : [];
          setPublishError([errorMessage(e), ...details].join(' '));
        },
      },
    );
  }

  async function handleSaveChanges() {
    setPublishError(null);
    if (issues.length > 0) {
      setAttempted([0, 1, 2, 3, 4, 5]);
      goToStep(REVIEW_STEP);
      return;
    }
    const id = await autosave.flush();
    if (!id) {
      const message = errorMessage(autosave.lastError.current);
      setPublishError(message);
      toastError('Não foi possível salvar', message);
      return;
    }
    await qc.invalidateQueries({ queryKey: keys.tournaments.all });
    success('Alterações salvas');
    router.push(managePath(id));
  }

  async function handleSaveAndLeave() {
    setLeaving(true);
    if (!isPublished) await autosave.flush();
    router.push(tournamentId || !isPublished ? '/organizador/campeonatos' : '/organizador');
  }

  const steps = WIZARD_STEPS.map((s, index) => {
    const pending = issues.filter((i) => i.step === index).length;
    const visited = reached > index || attempted.includes(index);
    let description: string;
    switch (index) {
      case 0:
        description = values.name.trim() || 'Sem nome ainda';
        break;
      case 1:
        description = game && mode ? `${game.name} · ${mode.name}` : 'Escolha o jogo';
        break;
      case 2:
        description = `${values.maxParticipants} vagas${values.startsAt ? ` · começa em ${formatDate(values.startsAt)}` : ''}`;
        break;
      case 3:
        description = values.stages.length === 0 ? 'Nenhuma fase' : `${values.stages.length} ${values.stages.length === 1 ? 'fase' : 'fases'}`;
        break;
      case 4:
        description = values.stages.length === 0 ? 'Definida por fase' : 'Modelo e desempate por fase';
        break;
      case 5:
        description = isRichTextEmpty(values.rules) ? 'Sem regulamento' : 'Regulamento escrito';
        break;
      default:
        description = issues.length === 0 ? (isPublished ? 'Pronto para salvar' : 'Pronto para publicar') : `${issues.length} ${issues.length === 1 ? 'pendência' : 'pendências'}`;
    }
    if (index < REVIEW_STEP && pending > 0 && visited) description = `${description} · ${pending} ${pending === 1 ? 'pendência' : 'pendências'}`;
    return { id: s.id, label: s.label, description };
  });

  const context: WizardContextValue = { values, selectableGames: selectable, game, mode, userId, issues, fieldError, isPublished, hasStarted, lockedStageIds, takenSlots, goToStep };
  const current = WIZARD_STEPS[step];
  const busy = publish.isPending || autosave.state === 'saving';

  return (
    <FormProvider {...form}>
      <WizardContext.Provider value={context}>
        <PageContainer className="pb-28 md:pb-8">
          <PageHeader
            title={isPublished ? 'Editar campeonato' : 'Criar campeonato'}
            description={isPublished ? `${tournament?.name} já está publicado: as mudanças só valem depois de salvar.` : template ? `A partir do modelo "${template.name}". Ajuste o que quiser.` : 'Sete passos, com sugestões em tudo. Dá para publicar em poucos minutos.'}
            actions={
              <>
                <SaveIndicator state={autosave.state} savedAt={autosave.savedAt} manual={isPublished} dirty={autosave.dirty} onRetry={() => void autosave.retry()} />
                {isPublished ? (
                  <Button asChild variant="secondary">
                    <Link href={tournamentId ? managePath(tournamentId) : '/organizador/campeonatos'}>Sair sem salvar</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" loading={leaving} onClick={() => void handleSaveAndLeave()}>
                    {tournamentId || isValidName(values.name) ? 'Salvar e sair' : 'Sair'}
                  </Button>
                )}
              </>
            }
          />
          {!isPublished && (
            <Tip id="assistente" title="O rascunho se salva sozinho">
              Pode sair e voltar quando quiser: o campeonato fica em Meus campeonatos como rascunho. Tudo já vem com uma sugestão — mude só o que precisar e publique no último passo.
            </Tip>
          )}

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <Card padding="sm" className="sticky top-20">
                <Stepper steps={steps} current={step} reached={reached} onStepClick={goToStep} orientation="vertical" />
              </Card>
            </aside>

            <div className="flex min-w-0 flex-col gap-4">
              <Stepper className="lg:hidden" steps={steps} current={step} reached={reached} onStepClick={goToStep} />

              <Card className="flex min-w-0 flex-col gap-5">
                <h2 ref={headingRef} tabIndex={-1} className="text-lg outline-none md:text-xl" data-testid="wizard-step-title">
                  {current?.label}
                </h2>
                {showStepIssues && stepIssues.length > 0 && step < REVIEW_STEP && (
                  <div ref={summaryRef} tabIndex={-1} className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-accent" data-testid="step-issues">
                    <p className="mb-1 text-sm font-semibold text-text">Antes de continuar, resolva:</p>
                    <IssueList messages={stepIssues.map((i) => i.message)} />
                  </div>
                )}
                {step === 0 && <InfoStep />}
                {step === 1 && <GameStep onSelect={selectGameMode} />}
                {step === 2 && <RegistrationStep />}
                {step === 3 && <StagesStep />}
                {step === 4 && <ScoringStep />}
                {step === 5 && <RulesStep />}
                {step === REVIEW_STEP && <ReviewStep publishError={publishError} />}
              </Card>

              <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 pb-safe md:static md:border-0 md:bg-transparent md:p-0">
                {step > 0 && (
                  <Button variant="secondary" iconLeft={<ArrowLeft className="size-4" aria-hidden />} onClick={() => goToStep(step - 1)}>
                    Voltar
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {step < REVIEW_STEP ? (
                    <Button iconRight={<ArrowRight className="size-4" aria-hidden />} onClick={handleContinue}>
                      Continuar
                    </Button>
                  ) : isPublished ? (
                    <Button loading={busy} iconLeft={<Save className="size-4" aria-hidden />} onClick={() => void handleSaveChanges()}>
                      Salvar alterações
                    </Button>
                  ) : (
                    <Button loading={busy} disabled={issues.length > 0} iconLeft={<Rocket className="size-4" aria-hidden />} onClick={() => void handlePublish()}>
                      Publicar campeonato
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </PageContainer>
      </WizardContext.Provider>
    </FormProvider>
  );
}

/** `/organizador/campeonatos/[id]/editar`: retoma o rascunho (ou edita um campeonato publicado). */
export function TournamentWizard({ tournamentId }: { tournamentId: string }) {
  const tournament = useOrganizerTournament(tournamentId);
  const games = useGames();
  const { user } = useSession();

  if (!tournament.data && tournament.error) {
    if (tournament.error instanceof ApiError && tournament.error.status === 403) return <NoAccess />;
    if (tournament.error instanceof ApiError && tournament.error.status === 404) return <TournamentNotFound />;
    return (
      <PageContainer narrow>
        <ErrorState description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />
      </PageContainer>
    );
  }
  if (!games.data && games.error) {
    return (
      <PageContainer narrow>
        <ErrorState description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      </PageContainer>
    );
  }
  if (!tournament.data || !games.data || !user) return <WizardSkeleton />;
  if (tournament.data.access === 'MODERATOR') return <NoAccess />;
  if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(tournament.data.status)) {
    return (
      <PageContainer narrow>
        <ErrorState title="Este campeonato não pode mais ser editado" description="Campeonatos finalizados, arquivados ou cancelados ficam só para consulta. Você pode duplicar para criar uma nova edição.">
          <Button asChild variant="secondary">
            <Link href={managePath(tournament.data.id)}>Voltar ao campeonato</Link>
          </Button>
        </ErrorState>
      </PageContainer>
    );
  }
  return <WizardForm key={tournament.data.id} games={games.data} userId={user.id} tournament={tournament.data} />;
}
