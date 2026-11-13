import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from './qr';

const draw = (matrix: boolean[][]) => matrix.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

/** Padrão de posição (7×7) esperado em cada um dos três cantos. */
const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];

function corner(rows: string[], x: number, y: number): string[] {
  return rows.slice(y, y + 7).map((row) => row.slice(x, x + 7));
}

describe('QR Code do 2FA', () => {
  it('gera a matriz conferida com um leitor de verdade (regressão)', () => {
    // Esta matriz foi lida com sucesso pelo leitor de códigos do macOS (Vision) e devolveu "HELLO".
    expect(draw(qrMatrix('HELLO'))).toEqual([
    '#######.##.#..#######',
    '#.....#..##.#.#.....#',
    '#.###.#..####.#.###.#',
    '#.###.#.#..#..#.###.#',
    '#.###.#.#...#.#.###.#',
    '#.....#.#.##..#.....#',
    '#######.#.#.#.#######',
    '........#####........',
    '#...#.######.#####..#',
    '...###..#.###..#.####',
    '#.##..#.#.##..###..#.',
    '###..#...#...##.#....',
    '..#.###..#..###...##.',
    '........###.###..#.##',
    '#######.##..##...#.#.',
    '#.....#....##..#...#.',
    '#.###.#.#..#..###.#.#',
    '#.###.#....##....#.##',
    '#.###.#..###..####...',
    '#.....#..#...##......',
    '#######.#...#####.#.#',
    ]);
  });

  it('é determinístico e muda quando o texto muda', () => {
    expect(qrMatrix('nova arena')).toEqual(qrMatrix('nova arena'));
    expect(qrMatrix('nova arena')).not.toEqual(qrMatrix('nova arenA'));
  });

  it('escolhe a menor versão que comporta o texto (lado = 17 + 4 × versão)', () => {
    expect(qrMatrix('a'.repeat(14))).toHaveLength(21); // versão 1 leva até 14 bytes no nível M
    expect(qrMatrix('a'.repeat(15))).toHaveLength(25);
    expect(qrMatrix('a'.repeat(120))).toHaveLength(45); // versão 7
    expect(qrMatrix('a'.repeat(213))).toHaveLength(57); // versão 10 (contador de 16 bits)
    expect(() => qrMatrix('a'.repeat(500))).toThrow(/longo demais/);
  });

  it('desenha os três padrões de posição, as linhas de sincronismo e o módulo escuro fixo', () => {
    const url = 'otpauth://totp/Nova%20Arena:ana%40novaarena.gg?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Nova%20Arena&algorithm=SHA1&digits=6&period=30';
    const rows = draw(qrMatrix(url));
    const size = rows.length;
    expect(size).toBe(49); // versão 8
    expect(rows.every((row) => row.length === size)).toBe(true);
    expect(corner(rows, 0, 0)).toEqual(FINDER);
    expect(corner(rows, size - 7, 0)).toEqual(FINDER);
    expect(corner(rows, 0, size - 7)).toEqual(FINDER);
    for (let i = 8; i < size - 8; i += 1) {
      expect(rows[6]?.[i]).toBe(i % 2 === 0 ? '#' : '.');
      expect(rows[i]?.[6]).toBe(i % 2 === 0 ? '#' : '.');
    }
    expect(rows[size - 8]?.[8]).toBe('#');
    // Padrões de alinhamento da versão 8 em 6, 24 e 42 (centro escuro, anel claro).
    expect(rows[24]?.[24]).toBe('#');
    expect(rows[23]?.[24]).toBe('.');
    expect(rows[42]?.[42]).toBe('#');
  });

  it('o SVG tem margem de 4 módulos e é sempre preto sobre branco', () => {
    const svg = qrSvg('HELLO');
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
    expect(svg).not.toMatch(/<script|onload|href/i);
    // Primeiro módulo escuro: canto do padrão de posição, deslocado pela margem.
    expect(svg).toContain('M4,4h1v1h-1z');
  });
});
