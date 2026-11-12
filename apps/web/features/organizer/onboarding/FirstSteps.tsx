'use client';

import type { OrganizerTournament } from '@nova/schemas';
import { Button, Card, Progress } from '@nova/ui';
import { CheckCircle2, Circle, Compass, X } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/shared/session/useSession';
import { useOnboardingFlag, writeFlag } from './storage';

/** Campeonato de demonstração que o organizador novo pode explorar em modo leitura (página pública). */
export const EXAMPLE_TOURNAMENT = { slug: 'liga-semanal-clash-royale', name: 'Liga Semanal Clash Royale 1v1' };

export interface OnboardingStep {
  id: 'perfil' | 'modelo' | 'publicar';
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

/**
 * Passos do checklist (issue #62). Função pura: o que está feito vem dos dados da conta e dos
 * campeonatos; "escolher um modelo" também vale quando a pessoa já abriu os modelos neste aparelho.
 */
export function onboardingSteps(input: { hasBio: boolean; hasAvatar: boolean; tournaments: Pick<OrganizerTournament, 'status' | 'access'>[]; sawTemplates: boolean }): OnboardingStep[] {
  const mine = input.tournaments.filter((t) => t.access === 'OWNER' || t.access === 'ADMIN');
  return [
    { id: 'perfil', title: 'Complete o seu perfil', description: 'Uma foto ou uma apresentação curta: os jogadores confiam mais em quem eles reconhecem.', href: '/minha-conta', cta: 'Abrir meu perfil', done: input.hasBio || input.hasAvatar },
    { id: 'modelo', title: 'Escolha um modelo', description: 'Comece por um formato pronto (FF Squad com grupos e final, CR mata-mata MD3…) ou do zero.', href: '/organizador/novo', cta: 'Escolher modelo', done: mine.length > 0 || input.sawTemplates },
    { id: 'publicar', title: 'Publique o seu primeiro campeonato', description: 'O assistente sugere vagas, datas, pontuação e regulamento. Dá para publicar em poucos minutos.', href: '/organizador/novo', cta: 'Abrir o assistente', done: mine.some((t) => t.status !== 'DRAFT') },
  ];
}

/** Aparece para quem ainda não publicou nenhum campeonato. */
export function needsOnboarding(tournaments: Pick<OrganizerTournament, 'status' | 'access'>[]): boolean {
  return !tournaments.some((t) => (t.access === 'OWNER' || t.access === 'ADMIN') && t.status !== 'DRAFT');
}

/**
 * Checklist "Primeiros passos" do painel do organizador: progresso, um atalho para explorar um
 * campeonato de exemplo e a opção de dispensar (a escolha fica guardada neste aparelho).
 */
export function FirstSteps({ tournaments }: { tournaments: OrganizerTournament[] }) {
  const { user } = useSession();
  // No servidor e antes de hidratar o checklist fica escondido, para não piscar para quem já dispensou.
  const [dismissed, dismiss] = useOnboardingFlag('checklist-dispensado', user?.id, true);
  const [sawTemplates] = useOnboardingFlag('modelos-vistos', user?.id, false);
  if (!user || dismissed || !needsOnboarding(tournaments)) return null;

  const steps = onboardingSteps({ hasBio: Boolean(user.bio?.trim()), hasAvatar: Boolean(user.avatarUrl), tournaments, sawTemplates });
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <Card className="flex flex-col gap-4 border-accent" data-testid="primeiros-passos">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg">Primeiros passos</h2>
          <p className="text-sm text-muted">Três coisas para o seu primeiro campeonato sair do papel.</p>
        </div>
        <Button variant="ghost" size="sm" iconLeft={<X className="size-4" aria-hidden />} onClick={() => dismiss()} aria-label="Dispensar os primeiros passos">
          Dispensar
        </Button>
      </div>
      <Progress value={done} max={steps.length} label="Primeiros passos concluídos" />
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-col gap-2 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between" data-testid={`passo-${step.id}`} data-done={step.done}>
            <div className="flex min-w-0 items-start gap-3">
              {step.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary-soft-text" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />}
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-text">
                  {step.title}
                  <span className="sr-only">{step.done ? ' (feito)' : ' (pendente)'}</span>
                </p>
                <p className="text-muted">{step.description}</p>
              </div>
            </div>
            {!step.done && (
              <Button asChild size="sm" variant={step.id === next?.id ? 'primary' : 'secondary'} className="shrink-0">
                <Link href={step.href} onClick={() => step.id === 'modelo' && writeFlag('modelos-vistos', user.id)}>
                  {step.cta}
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <Compass className="size-4 shrink-0" aria-hidden />
        Quer ver um campeonato funcionando antes?
        <Link href={`/c/${EXAMPLE_TOURNAMENT.slug}`} className="font-semibold text-text underline" data-testid="explorar-exemplo">
          Explorar um campeonato de exemplo
        </Link>
        <span className="sr-only">({EXAMPLE_TOURNAMENT.name}, só para leitura)</span>
      </p>
    </Card>
  );
}
