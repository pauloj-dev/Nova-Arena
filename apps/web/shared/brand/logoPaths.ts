/**
 * Símbolo da Nova Arena vetorizado a partir da arte original (nova-arena-simbolo.png, 1566 × 890):
 * o N, o traço verde do A (com a fresta entre os dois), a perna escura do A e a órbita que passa
 * por trás do N e cruza à frente do A. Coordenadas no espaço da arte original.
 *
 * Fonte única das formas: usada pelo `LogoMark` (React) e pelo script que gera favicon e ícones
 * (`scripts/brand-assets.mts`).
 */

/** Recorte justo do símbolo (com respiro de ~10 px em volta). */
export const LOGO_VIEWBOX = '44 44 1478 800';
export const LOGO_ASPECT = 1478 / 800;

/** Metade de baixo da órbita: sai de trás do N, contorna pela esquerda e afina sob o N. */
export const ORBIT_BACK =
  'M283 410C178 482 72 590 56 700C44 790 140 836 300 832C472 828 642 760 762 700C622 756 452 779 320 771C202 762 146 701 149 625C152 540 210 470 283 410Z';

/** Metade de cima da órbita: nasce fina à esquerda, contorna pela direita e cruza à frente do A. */
export const ORBIT_FRONT =
  'M883 168C1052 100 1252 50 1382 55C1482 60 1522 112 1512 186C1500 302 1318 462 1048 578C1232 470 1390 330 1410 210C1420 130 1370 98 1250 98C1130 98 1000 130 883 168Z';

/** O N: haste esquerda (cortada pela órbita embaixo), diagonal e haste direita inclinada. */
export const LETTER_N = 'M282 188H450L828 502L927 190H1118L766 670L463 403V633L282 755Z';

/** Traço verde do A, paralelo à haste direita do N, com a fresta entre eles. */
export const LETTER_A_STROKE = 'M776 682L1145 177L1300 392L1182 478L1141 423L903 748H846Z';

/** Perna escura do A, que sai de baixo da órbita. */
export const LETTER_A_LEG = 'M1000 646L1328 445L1505 702H1317L1220 560Z';

/** Gradientes em coordenadas do desenho (userSpaceOnUse). */
export const GRADIENTS = {
  /** Órbita de trás: mais clara à esquerda, escurece até a ponta sob o N. */
  back: { cx: 96, cy: 690, r: 700 },
  /** Órbita da frente: mais clara à direita, escurece nas duas pontas. */
  front: { cx: 1470, cy: 165, r: 640 },
  /** Traço do A: claro em cima, mais fundo embaixo. */
  stroke: { x1: 1070, y1: 260, x2: 870, y2: 750 },
} as const;
