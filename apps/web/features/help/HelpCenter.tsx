'use client';

import { Button, Card, EmptyState, Input } from '@nova/ui';
import { ChevronDown, LifeBuoy, Mail, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useLocale, useT } from '@/shared/i18n/react';
import { filterFaq, getFaq } from './faq';
import { messages } from './messages';

/**
 * Central de ajuda (issue 110): perguntas frequentes por assunto, com busca. Cada resposta é um
 * `<details>` nativo (abre e fecha pelo teclado, sem script) e tem âncora própria (`/ajuda#check-in`).
 */
export function HelpCenter() {
  const t = useT(messages, 'HelpCenter');
  const locale = useLocale();
  const faq = useMemo(() => getFaq(locale), [locale]);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const sections = filterFaq(faq, deferred);
  const total = sections.reduce((n, s) => n + s.itens.length, 0);

  return (
    <PageContainer narrow>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      <div className="flex flex-col gap-2">
        <Input
          label={t('buscar')}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('buscarPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Leitor de tela: avisa quantas respostas a busca encontrou, sem tirar o foco do campo. */}
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {deferred.trim() === '' ? t('resumo', { total, assuntos: sections.length }) : total === 0 ? t('nenhumaResposta') : t('respostasEncontradas', { total })}
        </p>
      </div>

      {deferred.trim() === '' && (
        <nav aria-label={t('assuntos')}>
          <ul className="flex flex-wrap gap-2">
            {faq.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="inline-flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-2">
                  {s.titulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon={<SearchX className="size-7" />}
          title={t('vazioTitulo')}
          description={t('vazioDescricao')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setQuery('')}>
                {t('limparBusca')}
              </Button>
              <Button asChild>
                <Link href="/contato">{t('falarComSuporte')}</Link>
              </Button>
            </div>
          }
        />
      ) : (
        sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titulo`} className="flex scroll-mt-24 flex-col gap-3">
            <div>
              <h2 id={`${section.id}-titulo`} className="text-lg">
                {section.titulo}
              </h2>
              <p className="text-sm text-muted">{section.descricao}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {section.itens.map((item) => (
                <li key={item.id}>
                  <details id={item.id} className="group scroll-mt-24 rounded-lg border border-border bg-surface shadow-sm open:shadow-md" open={deferred.trim() !== '' || undefined}>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-semibold text-text [&::-webkit-details-marker]:hidden">
                      <span>{item.pergunta}</span>
                      <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                    </summary>
                    <div className="flex flex-col gap-2 px-4 pb-4 text-sm leading-relaxed text-text">
                      {item.resposta.map((p) => (
                        <p key={p}>{p}</p>
                      ))}
                      {item.link && (
                        <p>
                          <Link href={item.link.href} className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-2">
                            {item.link.texto}
                          </Link>
                        </p>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Card className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-0.5 size-6 shrink-0 text-primary-text" aria-hidden />
          <div>
            <h2 className="text-lg">{t('naoAchou')}</h2>
            <p className="text-sm text-muted">{t('naoAchouDescricao')}</p>
          </div>
        </div>
        <Button asChild>
          <Link href="/contato">
            <Mail className="size-4" aria-hidden />
            {t('falarComSuporte')}
          </Link>
        </Button>
      </Card>
    </PageContainer>
  );
}
