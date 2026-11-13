import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CertificateArt, certificateSentence, certificateTitle } from './CertificateArt';
import { ChampionsArt } from './ChampionsArt';
import { svgFor } from './exportPng';
import { ART_SIZES, CSS_THEME } from './theme';

const base = { tournamentName: 'Open 8 Ball Pool', gameName: '8 Ball Pool', gameIcon: '🎱', dateLabel: '23/10/2026', siteLabel: 'novaarena.gg/c/open-8-ball-pool', theme: CSS_THEME };
const places = [
  { place: 2, name: 'Thiago', tag: null },
  { place: 1, name: 'Bianca', tag: 'BIA' },
  { place: 3, name: 'Marina', tag: null },
];

/** O `next/og` (Satori) só aceita flexbox: nenhum elemento da arte pode usar grid, tabela ou classes. */
function assertOgCompatible(root: HTMLElement) {
  const all = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (const el of all) {
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('');
    expect(el.style.display).toBe('flex');
  }
  expect(root.querySelector('img, svg, table')).toBeNull();
}

describe('arte de resultado (issue #50)', () => {
  it('arte de campeões: campeão, 2º e 3º, jogo, campeonato e data, só com flexbox e estilos em linha', () => {
    const { container } = render(<ChampionsArt {...base} places={places} format="landscape" />);
    const root = container.firstElementChild as HTMLElement;
    assertOgCompatible(root);
    expect(root.style.width).toBe('1200px');
    expect(root.style.height).toBe('630px');
    const text = root.textContent ?? '';
    for (const expected of ['NOVA ARENA', 'Open 8 Ball Pool', '8 Ball Pool', '23/10/2026', 'CAMPEÃO', 'Bianca', '[BIA]', '2º LUGAR', 'Thiago', '3º LUGAR', 'Marina']) expect(text).toContain(expected);
    // O campeão vem antes dos demais, qualquer que seja a ordem recebida.
    expect(text.indexOf('Bianca')).toBeLessThan(text.indexOf('Thiago'));
    expect(text.indexOf('Thiago')).toBeLessThan(text.indexOf('Marina'));
  });

  it('formato quadrado tem 1080×1080 e funciona com pódio só de campeão', () => {
    const { container } = render(<ChampionsArt {...base} places={[{ place: 1, name: 'Bianca', tag: null }]} format="square" />);
    const root = container.firstElementChild as HTMLElement;
    assertOgCompatible(root);
    expect([root.style.width, root.style.height]).toEqual(['1080px', '1080px']);
    expect(ART_SIZES.square).toMatchObject({ width: 1080, height: 1080 });
  });

  it('certificado: o texto muda com a colocação', () => {
    const { container } = render(<CertificateArt {...base} participantName="Bianca" place={1} organizerName="Diego" format="landscape" />);
    assertOgCompatible(container.firstElementChild as HTMLElement);
    expect(container.textContent).toContain('CERTIFICADO DE CAMPEÃO');
    expect(container.textContent).toContain('conquistou o título de');
    expect(container.textContent).toContain('Organização: Diego');
    expect([certificateTitle(2), certificateTitle(3), certificateTitle(null)]).toEqual(['Certificado de vice-campeão', 'Certificado de 3º lugar', 'Certificado de participação']);
    expect(certificateSentence(null)).toBe('participou de');
  });

  it('o SVG de exportação embrulha o HTML no tamanho pedido', () => {
    const svg = svgFor('<div xmlns="http://www.w3.org/1999/xhtml">x</div>', 1200, 630);
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('<foreignObject');
    expect(svgFor('<div/>', 10, 10, '@font-face{font-family:x}')).toContain('<style>@font-face{font-family:x}</style>');
  });
});
