'use client';

import type { Game, TournamentTemplate } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { ArrowRight, FilePlus2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useTournamentTemplates } from '@/shared/api/hooks/organizer';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { TemplateCard } from '../templates/TemplateCard';
import { messages } from './messages';
import { WizardForm, WizardSkeleton } from './TournamentWizard';

const NEW_PATH = '/organizador/novo';

type Start = { kind: 'blank' } | { kind: 'template'; id: string };

interface StartScreenProps {
  games: Game[];
  templates: TournamentTemplate[] | undefined;
  templatesError: unknown;
  onRetry: () => void;
  onStart: (start: Start) => void;
}

function StartScreen({ games, templates, templatesError, onRetry, onStart }: StartScreenProps) {
  const t = useT(messages, 'NewTournament');
  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <Card className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
            <FilePlus2 className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-text">{t('comecarDoZero')}</h2>
            <p className="text-sm text-muted">{t('comecarDoZeroDescricao')}</p>
          </div>
        </div>
        <Button iconRight={<ArrowRight className="size-4" aria-hidden />} onClick={() => onStart({ kind: 'blank' })}>
          {t('comecarDoZero')}
        </Button>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="modelos-titulo">
        <div>
          <h2 id="modelos-titulo" className="text-lg">
            {t('modelosTitulo')}
          </h2>
          <p className="text-sm text-muted">{t('modelosDescricao')}</p>
        </div>
        {templatesError ? (
          <ErrorState description={errorMessage(templatesError)} onRetry={onRetry} />
        ) : !templates ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('carregandoModelos')}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  template={template}
                  games={games}
                  actions={
                    <Button variant="secondary" onClick={() => onStart({ kind: 'template', id: template.id })} aria-label={t('usarModeloAria', { nome: template.name })}>
                      {t('usarModelo')}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}

function NewTournamentInner() {
  const t = useT(messages, 'NewTournament');
  const params = useSearchParams();
  const pathname = usePathname();
  const games = useGames();
  const templates = useTournamentTemplates();
  const { user } = useSession();
  // `?modelo=<id>` (vindo da tela de modelos) já entra direto no assistente.
  const [choice, setChoice] = useState<Start | null>(() => {
    const fromUrl = params.get('modelo');
    return fromUrl ? { kind: 'template', id: fromUrl } : null;
  });
  // `?evento=<id>` (vindo da página do evento): o campeonato já nasce dentro do evento.
  const eventId = params.get('evento') ?? undefined;
  const [generation, setGeneration] = useState(0);
  const [seenPath, setSeenPath] = useState(pathname);
  // Quando o rascunho é criado, o endereço vira o de edição sem trocar de tela. Se a pessoa voltar
  // para "Criar campeonato" pelo menu, é um campeonato novo: o assistente recomeça.
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (pathname === NEW_PATH) {
      setChoice(null);
      setGeneration((g) => g + 1);
    }
  }

  if (!games.data && games.error) {
    return (
      <PageContainer narrow>
        <ErrorState description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      </PageContainer>
    );
  }
  if (!games.data || !user) return <WizardSkeleton />;

  const start = choice;
  if (!start) {
    return <StartScreen games={games.data} templates={templates.data} templatesError={templates.data ? null : templates.error} onRetry={() => void templates.refetch()} onStart={setChoice} />;
  }
  if (start.kind === 'blank') return <WizardForm key={`novo-${generation}`} games={games.data} userId={user.id} eventId={eventId} />;

  if (!templates.data) {
    if (templates.error) {
      return (
        <PageContainer narrow>
          <ErrorState description={errorMessage(templates.error)} onRetry={() => void templates.refetch()} />
        </PageContainer>
      );
    }
    return <WizardSkeleton />;
  }
  const template = templates.data.find((item) => item.id === start.id);
  if (!template) {
    return (
      <PageContainer narrow>
        <ErrorState title={t('modeloNaoEncontrado')} description={t('modeloNaoEncontradoDescricao')}>
          <Button variant="secondary" onClick={() => setChoice({ kind: 'blank' })}>
            {t('comecarDoZero')}
          </Button>
        </ErrorState>
      </PageContainer>
    );
  }
  return <WizardForm key={`modelo-${template.id}-${generation}`} games={games.data} userId={user.id} template={template} eventId={eventId} />;
}

/** `/organizador/novo`: tela inicial ("do zero" ou modelo) e, depois da escolha, o assistente. */
export function NewTournament() {
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <NewTournamentInner />
    </Suspense>
  );
}
