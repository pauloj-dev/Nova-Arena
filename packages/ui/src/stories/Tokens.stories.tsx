import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactNode } from 'react';

const meta = {
  title: 'Fundamentos/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Lê o valor em vigor de cada token e relê quando o tema ou a área mudam na barra do Storybook. */
function useTokenValues(names: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  const key = names.join(',');
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const style = getComputedStyle(root);
      setValues(Object.fromEntries(key.split(',').map((n) => [n, style.getPropertyValue(n).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-area'] });
    return () => observer.disconnect();
  }, [key]);
  return values;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg text-text">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

interface Swatch {
  token: string;
  use: string;
}

function Swatches({ items }: { items: Swatch[] }) {
  const values = useTokenValues(items.map((i) => i.token));
  return (
    <ul className="grid grid-cols-2 gap-3 xs:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <li key={i.token} className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="h-14 border-b border-border" style={{ background: `var(${i.token})` }} />
          <div className="flex flex-col gap-0.5 p-2">
            <code className="font-mono text-xs font-semibold text-text">{i.token}</code>
            <span className="font-mono text-xs text-muted">{values[i.token] ?? '…'}</span>
            <span className="text-xs text-muted">{i.use}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TextPair({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <li className="rounded-md border border-border px-3 py-2" style={{ background: `var(${bg})`, color: `var(${fg})` }}>
      <span className="block text-sm font-semibold">{label}</span>
      <code className="font-mono text-xs">
        {fg} sobre {bg}
      </code>
    </li>
  );
}

const brand: Swatch[] = [
  { token: '--color-primary-50', use: 'Fundo de seções' },
  { token: '--color-primary-100', use: 'Fundo de badge, linha selecionada' },
  { token: '--color-primary-500', use: 'Hover, indicador ao vivo' },
  { token: '--color-primary-600', use: 'Cor da marca' },
  { token: '--color-primary-700', use: 'Pressionado, títulos' },
  { token: '--color-primary-900', use: 'Barra escura, área Admin' },
];
const neutrals: Swatch[] = [
  { token: '--color-white', use: 'Cards' },
  { token: '--color-gray-50', use: 'Fundo da aplicação' },
  { token: '--color-gray-200', use: 'Bordas, divisores' },
  { token: '--color-gray-500', use: 'Texto secundário (referência)' },
  { token: '--color-gray-900', use: 'Texto principal' },
];
const support: Swatch[] = [
  { token: '--color-teal-700', use: 'Área do Organizador' },
  { token: '--color-gold-400', use: '1º lugar, Booyah, capitão' },
  { token: '--color-silver-300', use: '2º lugar' },
  { token: '--color-bronze-600', use: '3º lugar' },
  { token: '--color-info-500', use: 'Informação' },
  { token: '--color-warning-500', use: 'Check-in pendente, disputa' },
  { token: '--color-danger-600', use: 'Erro, eliminação' },
];
const semantic: Swatch[] = [
  { token: '--bg', use: 'Fundo da página' },
  { token: '--surface', use: 'Cards, modais, campos' },
  { token: '--surface-2', use: 'Cabeçalho de tabela, hover' },
  { token: '--border', use: 'Divisores' },
  { token: '--border-strong', use: 'Borda de controles (3:1)' },
  { token: '--text', use: 'Texto principal' },
  { token: '--text-muted', use: 'Texto secundário' },
  { token: '--neutral-soft', use: 'Trilhos, skeleton, hover' },
];
const action: Swatch[] = [
  { token: '--accent', use: 'Ação principal (muda com a área)' },
  { token: '--accent-hover', use: 'Ação principal em hover' },
  { token: '--accent-soft', use: 'Fundo suave da área' },
  { token: '--accent-detail', use: 'Detalhe da área' },
  { token: '--primary', use: 'Verde de ação' },
  { token: '--danger', use: 'Ação destrutiva' },
  { token: '--chrome-bg', use: 'Barra da área' },
];

export const Paleta: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Section title="Verde da marca" description="Identidade verde e branca. Troque o tema e a área na barra do Storybook para ver os valores em vigor.">
        <Swatches items={brand} />
      </Section>
      <Section title="Neutros">
        <Swatches items={neutrals} />
      </Section>
      <Section title="Apoio">
        <Swatches items={support} />
      </Section>
      <Section title="Semânticos" description="Mudam com o tema. São estes que os componentes usam.">
        <Swatches items={semantic} />
      </Section>
      <Section title="Ação e área" description="O acento muda com a área: participante (verde), organizador (verde-azulado) e admin (verde-escuro com detalhe dourado).">
        <Swatches items={action} />
      </Section>
      <Section title="Pares de texto e fundo" description="Todos passam contraste AA (teste automático em src/styles/contrast.test.ts).">
        <ul className="grid grid-cols-1 gap-2 xs:grid-cols-2 lg:grid-cols-3">
          <TextPair fg="--text" bg="--surface" label="Texto principal" />
          <TextPair fg="--text-muted" bg="--surface-2" label="Texto secundário" />
          <TextPair fg="--text-on-accent" bg="--accent" label="Sobre o acento" />
          <TextPair fg="--text-on-accent" bg="--danger" label="Sobre perigo" />
          <TextPair fg="--primary-soft-text" bg="--primary-soft" label="Verde suave" />
          <TextPair fg="--accent-soft-text" bg="--accent-soft" label="Acento suave" />
          <TextPair fg="--info-soft-text" bg="--info-soft" label="Informação" />
          <TextPair fg="--warning-soft-text" bg="--warning-soft" label="Atenção" />
          <TextPair fg="--danger-soft-text" bg="--danger-soft" label="Perigo suave" />
          <TextPair fg="--neutral-soft-text" bg="--neutral-soft" label="Neutro" />
          <TextPair fg="--gold-soft-text" bg="--gold-soft" label="Ouro suave" />
          <TextPair fg="--gold-text" bg="--color-gold-400" label="Sobre ouro" />
          <TextPair fg="--chrome-text" bg="--chrome-bg" label="Barra da área" />
        </ul>
      </Section>
      <Section title="Gradientes">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <li className="bg-hero flex h-20 items-end rounded-md p-3 font-mono text-xs text-white">--gradient-hero</li>
          <li className="bg-gold-gradient flex h-20 items-end rounded-md p-3 font-mono text-xs text-gold-text">--gradient-gold</li>
          <li className="bg-hero rounded-md p-3">
            <div className="bg-glass flex h-14 items-end rounded-sm p-2 font-mono text-xs text-text">--gradient-glass</div>
          </li>
        </ul>
      </Section>
    </div>
  ),
};

const headings = [
  { className: 'text-3xl', label: 'Título 1 · 48 px', sample: 'Copa Booyah de Verão' },
  { className: 'text-2xl', label: 'Título 2 · 36 px', sample: 'Final · Queda 6 de 6' },
  { className: 'text-xl', label: 'Título 3 · 28 px', sample: 'Tabela de classificação' },
  { className: 'text-lg', label: 'Título 4 · 22 px', sample: 'Fúria Nordestina' },
];
const body = [
  { className: 'text-base', label: 'Texto · 16 px', sample: 'Cada squad joga as 6 quedas da fase classificatória.' },
  { className: 'text-sm', label: 'Texto · 14 px', sample: 'O check-in abre 30 minutos antes da primeira queda.' },
  { className: 'text-xs', label: 'Legenda · 12 px', sample: 'Atualizado há 2 minutos' },
];

export const Tipografia: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Section title="Títulos — Rajdhani 600–700" description="Altura de linha de 1,2.">
        <ul className="flex flex-col gap-4">
          {headings.map((h) => (
            <li key={h.className} className="flex flex-col">
              <span className="text-xs text-muted">{h.label}</span>
              <span className={`font-display font-bold leading-tight text-text ${h.className}`}>{h.sample}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Interface — Inter 400–600" description="Altura de linha de 1,5.">
        <ul className="flex flex-col gap-3">
          {body.map((b) => (
            <li key={b.className} className="flex flex-col">
              <span className="text-xs text-muted">{b.label}</span>
              <span className={`text-text ${b.className}`}>{b.sample}</span>
            </li>
          ))}
          <li className="flex gap-6 text-base text-text">
            <span className="font-normal">Regular 400</span>
            <span className="font-medium">Médio 500</span>
            <span className="font-semibold">Seminegrito 600</span>
          </li>
        </ul>
      </Section>
      <Section title="Placar — JetBrains Mono 600" description="Algarismos de largura fixa: as colunas não dançam quando o placar muda.">
        <ul className="flex flex-col gap-1">
          {[
            ['Fúria Nordestina', '118'],
            ['Tropa do Rush', '109'],
            ['Los Brabos', '87'],
          ].map(([name, points]) => (
            <li key={name} className="flex max-w-xs items-baseline justify-between gap-4 text-text">
              <span className="text-sm">{name}</span>
              <span className="tabular text-xl">{points}</span>
            </li>
          ))}
          <li className="tabular text-3xl text-text">12 × 08</li>
        </ul>
      </Section>
    </div>
  ),
};

const spaces = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12'];
const radii = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-full'];
const shadows = ['--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-glow'];

function Scale() {
  const values = useTokenValues([...spaces, ...radii, '--duration-fast', '--duration-base']);
  return (
    <div className="flex flex-col gap-8">
      <Section title="Espaçamento" description="Base de 4 px.">
        <ul className="flex flex-col gap-2">
          {spaces.map((s) => (
            <li key={s} className="flex items-center gap-3">
              <code className="w-28 font-mono text-xs text-text">{s}</code>
              <span className="w-12 font-mono text-xs text-muted">{values[s]}</span>
              <span className="block h-4 rounded-sm bg-accent" style={{ width: `var(${s})` }} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Raio">
        <ul className="flex flex-wrap gap-4">
          {radii.map((r) => (
            <li key={r} className="flex flex-col items-center gap-1">
              <span className="block size-16 border border-border-strong bg-accent-soft" style={{ borderRadius: `var(${r})` }} />
              <code className="font-mono text-xs text-text">{r}</code>
              <span className="font-mono text-xs text-muted">{values[r]}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Sombra">
        <ul className="flex flex-wrap gap-6">
          {shadows.map((s) => (
            <li key={s} className="flex flex-col items-center gap-2">
              <span className="block size-16 rounded-md bg-surface" style={{ boxShadow: `var(${s})` }} />
              <code className="font-mono text-xs text-text">{s}</code>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Movimento" description="Com prefers-reduced-motion ligado, animações e transições ficam instantâneas.">
        <ul className="flex flex-col gap-1 font-mono text-xs text-text">
          <li>--duration-fast: {values['--duration-fast']}</li>
          <li>--duration-base: {values['--duration-base']}</li>
          <li>--ease-out</li>
        </ul>
      </Section>
    </div>
  );
}

export const EspacamentoRaioESombra: Story = { name: 'Espaçamento, raio e sombra', render: () => <Scale /> };
