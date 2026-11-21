'use client';

import { Button, Card, EmptyState, Input } from '@nova/ui';
import { ChevronDown, LifeBuoy, Mail, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { FAQ, filterFaq } from './faq';

/**
 * Central de ajuda (issue 110): perguntas frequentes por assunto, com busca. Cada resposta é um
 * `<details>` nativo (abre e fecha pelo teclado, sem script) e tem âncora própria (`/ajuda#check-in`).
 */
export function HelpCenter() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const sections = filterFaq(FAQ, deferred);
  const total = sections.reduce((n, s) => n + s.itens.length, 0);

  return (
    <PageContainer narrow>
      <PageHeader title="Central de ajuda" description="Respostas rápidas sobre inscrição, check-in, W.O., disputas e como organizar campeonatos." />

      <div className="flex flex-col gap-2">
        <Input
          label="Buscar na ajuda"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Ex.: check-in, W.O., squad"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Leitor de tela: avisa quantas respostas a busca encontrou, sem tirar o foco do campo. */}
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {deferred.trim() === '' ? `${total} perguntas em ${sections.length} assuntos.` : total === 0 ? 'Nenhuma resposta encontrada.' : `${total} ${total === 1 ? 'resposta encontrada' : 'respostas encontradas'}.`}
        </p>
      </div>

      {deferred.trim() === '' && (
        <nav aria-label="Assuntos da ajuda">
          <ul className="flex flex-wrap gap-2">
            {FAQ.map((s) => (
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
          title="Nada por aqui com essas palavras"
          description="Tente outra palavra (por exemplo, “inscrição” ou “disputa”) ou fale com o suporte."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setQuery('')}>
                Limpar a busca
              </Button>
              <Button asChild>
                <Link href="/contato">Falar com o suporte</Link>
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
            <h2 className="text-lg">Não achou a resposta?</h2>
            <p className="text-sm text-muted">A equipe de suporte responde por e-mail em dias úteis.</p>
          </div>
        </div>
        <Button asChild>
          <Link href="/contato">
            <Mail className="size-4" aria-hidden />
            Falar com o suporte
          </Link>
        </Button>
      </Card>
    </PageContainer>
  );
}
