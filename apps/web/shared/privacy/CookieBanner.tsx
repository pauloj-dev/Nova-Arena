'use client';

import { Button } from '@nova/ui';
import { Cookie } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { onReopenConsent, saveConsent, useConsent } from './consent';

/** Os E2E de outras telas não esbarram no aviso; o E2E do próprio aviso liga `__NOVA_SHOW_CONSENT__`. */
function hiddenForTests(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as { __NOVA_E2E__?: boolean; __NOVA_SHOW_CONSENT__?: boolean };
  return Boolean(w.__NOVA_E2E__ && !w.__NOVA_SHOW_CONSENT__);
}

/**
 * Aviso de cookies (issue #115). O site só usa cookies necessários (sessão e segurança da conta); a medição de páginas
 * visitadas (Vercel Analytics) é anônima e sem cookies, mas só liga se a pessoa aceitar. As duas escolhas têm o mesmo peso e "só o necessário" vem
 * primeiro: a opção mais restritiva é o padrão. Não bloqueia a página (não é um modal).
 */
export function CookieBanner() {
  const consent = useConsent();
  const [reopened, setReopened] = useState(false);
  const titleId = useId();
  useEffect(() => onReopenConsent(() => setReopened(true)), []);

  if (consent === undefined || hiddenForTests()) return null;
  if (consent !== null && !reopened) return null;

  function choose(analytics: boolean) {
    saveConsent(analytics);
    setReopened(false);
  }

  return (
    <section aria-labelledby={titleId} className="fixed inset-x-0 bottom-0 z-50 p-3 md:p-4" data-testid="cookie-banner">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border border-border-strong bg-surface p-4 shadow-lg md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <Cookie className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              Cookies e medição de uso
            </h2>
            <p className="text-sm text-muted">
              Usamos só os cookies necessários para você entrar e manter a conta segura. Medimos a velocidade das páginas sem cookies e, com a sua permissão, também as páginas visitadas, de forma anônima.{' '}
              <Link href="/privacidade" className="font-medium text-primary-text underline">
                Política de Privacidade
              </Link>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 xs:flex-row">
          <Button variant="secondary" onClick={() => choose(false)}>
            Só o necessário
          </Button>
          <Button variant="secondary" onClick={() => choose(true)}>
            Aceitar medição
          </Button>
        </div>
      </div>
    </section>
  );
}
