'use client';

import { Button } from '@nova/ui';
import { Cookie } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { sharedMessages } from '../i18n/messages';
import { useT } from '../i18n/react';
import { onReopenConsent, saveConsent, useConsent } from './consent';

/**
 * Aviso de cookies (issue #115). O site só usa cookies necessários (sessão e segurança da conta); a medição de páginas
 * visitadas (Vercel Analytics) é anônima e sem cookies, mas só liga se a pessoa aceitar. As duas escolhas têm o mesmo peso e "só o necessário" vem
 * primeiro: a opção mais restritiva é o padrão. Não bloqueia a página (não é um modal).
 *
 * Vem no HTML do servidor (a escolha mora no navegador, então o servidor não sabe se já houve): pintado junto com a
 * página, o aviso não vira um LCP atrasado (#111). Quem já escolheu não o vê nem por um instante: o script inline do
 * layout (`consentInitScript`) marca `<html data-consent>` antes da pintura e o CSS o esconde.
 */
export function CookieBanner() {
  const t = useT(sharedMessages, 'CookieBanner');
  const consent = useConsent();
  const [reopened, setReopened] = useState(false);
  const titleId = useId();
  useEffect(() => onReopenConsent(() => setReopened(true)), []);

  // `undefined` = servidor e hidratação: renderiza (o CSS esconde se a escolha já existe).
  if (consent && !reopened) return null;

  // Fora do JSX: a regra de texto fixo só reconhece a chamada `t(…)`, não `t.rich(…)`.
  const text = t.rich('texto', {
    link: (chunks) => (
      <Link href="/privacidade" className="font-medium text-primary-text underline">
        {chunks}
      </Link>
    ),
  });

  function choose(analytics: boolean) {
    saveConsent(analytics);
    setReopened(false);
  }

  return (
    <section aria-labelledby={titleId} className="fixed inset-x-0 bottom-0 z-50 p-3 md:p-4 [html[data-consent]_&]:hidden" data-testid="cookie-banner">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border border-border-strong bg-surface p-4 shadow-lg md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <Cookie className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {t('titulo')}
            </h2>
            <p className="text-sm text-muted">{text}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 xs:flex-row">
          <Button variant="secondary" onClick={() => choose(false)}>
            {t('soONecessario')}
          </Button>
          <Button variant="secondary" onClick={() => choose(true)}>
            {t('aceitarMedicao')}
          </Button>
        </div>
      </div>
    </section>
  );
}
