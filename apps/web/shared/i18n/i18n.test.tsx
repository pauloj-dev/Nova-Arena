import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_LOCALE, isLocale, LOCALES } from './config';
import { defineMessages, getFormat, getT } from './core';
import { LocaleProvider, useT } from './react';

const messages = defineMessages({
  'pt-BR': {
    titulo: 'Campeonatos',
    inscritos: '{count, plural, =0 {Nenhum inscrito} one {# inscrito} other {# inscritos}}',
    status: '{s, select, OPEN {Inscrições abertas} other {Encerrado}}',
    termos: 'Li e aceito os <link>Termos</link>',
    Card: { vazio: 'Nada por aqui ainda' },
  },
});

function Titulo() {
  const t = useT(messages, 'Card');
  return <h1>{t('vazio')}</h1>;
}

describe('i18n (issue 108)', () => {
  it('pt-BR é o único idioma e o padrão', () => {
    expect(LOCALES).toEqual(['pt-BR']);
    expect(DEFAULT_LOCALE).toBe('pt-BR');
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('en')).toBe(false);
  });

  it('traduz com plural, select e trecho do catálogo', () => {
    const t = getT(messages);
    expect(t('titulo')).toBe('Campeonatos');
    expect(t('inscritos', { count: 0 })).toBe('Nenhum inscrito');
    expect(t('inscritos', { count: 1 })).toBe('1 inscrito');
    expect(t('inscritos', { count: 1200 })).toBe('1.200 inscritos');
    expect(t('status', { s: 'OPEN' })).toBe('Inscrições abertas');
    expect(getT(messages, 'Card')('vazio')).toBe('Nada por aqui ainda');
  });

  it('trecho com marcação vira elemento (t.rich)', () => {
    const t = getT(messages);
    render(<p>{t.rich('termos', { link: (chunks) => <a href="/termos">{chunks}</a> })}</p>);
    expect(screen.getByRole('link', { name: 'Termos' })).toHaveAttribute('href', '/termos');
  });

  it('chave ausente quebra fora de produção (não passa despercebida)', () => {
    const t = getT(messages);
    expect(() => (t as unknown as (k: string) => string)('naoExiste')).toThrow();
  });

  it('números no formato do idioma', () => {
    expect(getFormat().number(1234.5)).toBe('1.234,5');
  });

  it('useT funciona sem provider (pt-BR) e com o LocaleProvider', () => {
    const { unmount } = render(<Titulo />);
    expect(screen.getByRole('heading', { name: 'Nada por aqui ainda' })).toBeInTheDocument();
    unmount();
    render(
      <LocaleProvider locale="pt-BR">
        <Titulo />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Nada por aqui ainda' })).toBeInTheDocument();
  });
});
