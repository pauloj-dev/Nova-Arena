/**
 * CT-06 — "planilha de referência" do campeonato de Free Fire com 48 squads.
 *
 *   Fase 1 · 4 grupos BR de 12 squads, 3 quedas por grupo. Os 2 primeiros de cada grupo avançam.
 *   Fase 2 · Mata-mata 4v4 (Contra Squad) em MD3 com os 8 classificados, até sobrarem 2.
 *   Fase 3 · Final BR de 5 quedas: os 2 finalistas + repescagem (os 2 semifinalistas
 *            eliminados) completando a sala de 4. A última queda vale ×2.
 *
 * Pontuação BR (modelo padrão do Free Fire): 1 ponto por kill + 3 pontos pelo Booyah (1º lugar).
 * Desempate: pontos → Booyahs → kills.
 *
 * Este arquivo NÃO importa o motor. Os resultados são dados fixos (gerados uma
 * única vez por um script à parte e congelados aqui) e os valores `EXPECTED_*`
 * foram calculados por soma direta. As funções no fim do arquivo refazem essas
 * somas da forma mais simples possível, para o teste conferir três coisas:
 * planilha = soma simples = motor.
 *
 * Coisas que valem conferir à mão:
 * - Grupo A: Fúria Carioca (sq09) e Fúria Norte (sq01) empatam em 18 pontos; a
 *   vaga fica com a sq09, que tem 1 Booyah contra 0 (é o CT-05 dentro do CT-06).
 * - Cabeças de chave da Fase 2: os quatro 1ºs (seeds 1–4) e os quatro 2ºs
 *   (seeds 5–8), cada bloco pela ordem pontos → Booyahs → kills. O cruzamento
 *   1×8, 4×5, 2×7, 3×6 daria sq48 × sq09, os dois do Grupo A; por isso a sq09
 *   troca de lugar com a 2ª colocada de seed mais próxima (sq34).
 * - A campeã (sq38) perdeu a semifinal e voltou pela repescagem.
 */

export interface Squad {
  id: string;
  name: string;
}
export type GroupName = 'A' | 'B' | 'C' | 'D';
/** [squad, colocação na queda, kills] */
export type DropRow = [squadId: string, placement: number, kills: number];
/** [squad, pontos, Booyahs, kills] */
export type TableRow = [squadId: string, points: number, booyahs: number, kills: number];
export interface Series {
  a: string;
  b: string;
  /** Jogos vencidos na MD3. */
  scoreA: number;
  scoreB: number;
}

export const GROUP_NAMES: GroupName[] = ['A', 'B', 'C', 'D'];
export const POINTS_PER_KILL = 1;
export const POINTS_PER_BOOYAH = 3;
/** Multiplicador de cada queda da final (a última vale em dobro). */
export const FINAL_DROP_MULTIPLIERS = [1, 1, 1, 1, 2];

export const SQUADS: Squad[] = [
  { id: 'sq01', name: 'Fúria Norte' },
  { id: 'sq02', name: 'Tropa Norte' },
  { id: 'sq03', name: 'Legião Norte' },
  { id: 'sq04', name: 'Garra Norte' },
  { id: 'sq05', name: 'Clã Norte' },
  { id: 'sq06', name: 'Esquadrão Norte' },
  { id: 'sq07', name: 'Bonde Norte' },
  { id: 'sq08', name: 'Império Norte' },
  { id: 'sq09', name: 'Fúria Carioca' },
  { id: 'sq10', name: 'Tropa Carioca' },
  { id: 'sq11', name: 'Legião Carioca' },
  { id: 'sq12', name: 'Garra Carioca' },
  { id: 'sq13', name: 'Clã Carioca' },
  { id: 'sq14', name: 'Esquadrão Carioca' },
  { id: 'sq15', name: 'Bonde Carioca' },
  { id: 'sq16', name: 'Império Carioca' },
  { id: 'sq17', name: 'Fúria Sertão' },
  { id: 'sq18', name: 'Tropa Sertão' },
  { id: 'sq19', name: 'Legião Sertão' },
  { id: 'sq20', name: 'Garra Sertão' },
  { id: 'sq21', name: 'Clã Sertão' },
  { id: 'sq22', name: 'Esquadrão Sertão' },
  { id: 'sq23', name: 'Bonde Sertão' },
  { id: 'sq24', name: 'Império Sertão' },
  { id: 'sq25', name: 'Fúria Pantanal' },
  { id: 'sq26', name: 'Tropa Pantanal' },
  { id: 'sq27', name: 'Legião Pantanal' },
  { id: 'sq28', name: 'Garra Pantanal' },
  { id: 'sq29', name: 'Clã Pantanal' },
  { id: 'sq30', name: 'Esquadrão Pantanal' },
  { id: 'sq31', name: 'Bonde Pantanal' },
  { id: 'sq32', name: 'Império Pantanal' },
  { id: 'sq33', name: 'Fúria Capital' },
  { id: 'sq34', name: 'Tropa Capital' },
  { id: 'sq35', name: 'Legião Capital' },
  { id: 'sq36', name: 'Garra Capital' },
  { id: 'sq37', name: 'Clã Capital' },
  { id: 'sq38', name: 'Esquadrão Capital' },
  { id: 'sq39', name: 'Bonde Capital' },
  { id: 'sq40', name: 'Império Capital' },
  { id: 'sq41', name: 'Fúria Litoral' },
  { id: 'sq42', name: 'Tropa Litoral' },
  { id: 'sq43', name: 'Legião Litoral' },
  { id: 'sq44', name: 'Garra Litoral' },
  { id: 'sq45', name: 'Clã Litoral' },
  { id: 'sq46', name: 'Esquadrão Litoral' },
  { id: 'sq47', name: 'Bonde Litoral' },
  { id: 'sq48', name: 'Império Litoral' },
];

export const GROUPS: Record<GroupName, string[]> = {
  A: ['sq01', 'sq08', 'sq09', 'sq16', 'sq17', 'sq24', 'sq25', 'sq32', 'sq33', 'sq40', 'sq41', 'sq48'],
  B: ['sq02', 'sq07', 'sq10', 'sq15', 'sq18', 'sq23', 'sq26', 'sq31', 'sq34', 'sq39', 'sq42', 'sq47'],
  C: ['sq03', 'sq06', 'sq11', 'sq14', 'sq19', 'sq22', 'sq27', 'sq30', 'sq35', 'sq38', 'sq43', 'sq46'],
  D: ['sq04', 'sq05', 'sq12', 'sq13', 'sq20', 'sq21', 'sq28', 'sq29', 'sq36', 'sq37', 'sq44', 'sq45'],
};

export const PHASE1_DROPS: Record<GroupName, DropRow[][]> = {
  A: [
    // Grupo A · Queda 1
    [
      ['sq48', 1, 8],
      ['sq08', 2, 5],
      ['sq16', 3, 3],
      ['sq09', 4, 6],
      ['sq24', 5, 4],
      ['sq17', 6, 8],
      ['sq01', 7, 8],
      ['sq32', 8, 3],
      ['sq41', 9, 1],
      ['sq33', 10, 5],
      ['sq25', 11, 5],
      ['sq40', 12, 0],
    ],
    // Grupo A · Queda 2
    [
      ['sq48', 1, 3],
      ['sq08', 2, 4],
      ['sq16', 3, 3],
      ['sq40', 4, 1],
      ['sq24', 5, 1],
      ['sq17', 6, 7],
      ['sq25', 7, 2],
      ['sq41', 8, 7],
      ['sq33', 9, 2],
      ['sq01', 10, 6],
      ['sq32', 11, 0],
      ['sq09', 12, 0],
    ],
    // Grupo A · Queda 3
    [
      ['sq09', 1, 9],
      ['sq24', 2, 8],
      ['sq16', 3, 10],
      ['sq41', 4, 6],
      ['sq25', 5, 1],
      ['sq33', 6, 0],
      ['sq01', 7, 4],
      ['sq48', 8, 7],
      ['sq40', 9, 2],
      ['sq08', 10, 2],
      ['sq17', 11, 0],
      ['sq32', 12, 1],
    ],
  ],
  B: [
    // Grupo B · Queda 1
    [
      ['sq02', 1, 10],
      ['sq15', 2, 5],
      ['sq18', 3, 9],
      ['sq26', 4, 3],
      ['sq34', 5, 3],
      ['sq42', 6, 7],
      ['sq23', 7, 3],
      ['sq31', 8, 3],
      ['sq07', 9, 8],
      ['sq39', 10, 3],
      ['sq10', 11, 6],
      ['sq47', 12, 6],
    ],
    // Grupo B · Queda 2
    [
      ['sq26', 1, 4],
      ['sq34', 2, 10],
      ['sq02', 3, 2],
      ['sq42', 4, 0],
      ['sq39', 5, 2],
      ['sq47', 6, 4],
      ['sq15', 7, 5],
      ['sq23', 8, 8],
      ['sq18', 9, 1],
      ['sq10', 10, 4],
      ['sq07', 11, 5],
      ['sq31', 12, 0],
    ],
    // Grupo B · Queda 3
    [
      ['sq26', 1, 10],
      ['sq15', 2, 2],
      ['sq02', 3, 3],
      ['sq47', 4, 1],
      ['sq31', 5, 6],
      ['sq39', 6, 1],
      ['sq18', 7, 0],
      ['sq10', 8, 6],
      ['sq34', 9, 6],
      ['sq42', 10, 1],
      ['sq07', 11, 4],
      ['sq23', 12, 3],
    ],
  ],
  C: [
    // Grupo C · Queda 1
    [
      ['sq38', 1, 8],
      ['sq06', 2, 2],
      ['sq19', 3, 8],
      ['sq03', 4, 6],
      ['sq35', 5, 6],
      ['sq46', 6, 6],
      ['sq11', 7, 4],
      ['sq30', 8, 7],
      ['sq14', 9, 7],
      ['sq27', 10, 2],
      ['sq43', 11, 5],
      ['sq22', 12, 5],
    ],
    // Grupo C · Queda 2
    [
      ['sq43', 1, 3],
      ['sq35', 2, 7],
      ['sq19', 3, 10],
      ['sq11', 4, 2],
      ['sq03', 5, 4],
      ['sq30', 6, 8],
      ['sq06', 7, 6],
      ['sq22', 8, 1],
      ['sq38', 9, 7],
      ['sq14', 10, 0],
      ['sq46', 11, 0],
      ['sq27', 12, 5],
    ],
    // Grupo C · Queda 3
    [
      ['sq14', 1, 7],
      ['sq11', 2, 10],
      ['sq19', 3, 4],
      ['sq43', 4, 2],
      ['sq46', 5, 8],
      ['sq06', 6, 1],
      ['sq03', 7, 7],
      ['sq35', 8, 5],
      ['sq22', 9, 2],
      ['sq30', 10, 0],
      ['sq27', 11, 5],
      ['sq38', 12, 1],
    ],
  ],
  D: [
    // Grupo D · Queda 1
    [
      ['sq44', 1, 4],
      ['sq29', 2, 8],
      ['sq37', 3, 5],
      ['sq13', 4, 0],
      ['sq12', 5, 8],
      ['sq21', 6, 6],
      ['sq45', 7, 5],
      ['sq05', 8, 0],
      ['sq20', 9, 0],
      ['sq36', 10, 1],
      ['sq04', 11, 6],
      ['sq28', 12, 4],
    ],
    // Grupo D · Queda 2
    [
      ['sq12', 1, 8],
      ['sq21', 2, 8],
      ['sq37', 3, 2],
      ['sq45', 4, 8],
      ['sq29', 5, 2],
      ['sq44', 6, 8],
      ['sq20', 7, 7],
      ['sq04', 8, 2],
      ['sq05', 9, 1],
      ['sq13', 10, 1],
      ['sq28', 11, 2],
      ['sq36', 12, 2],
    ],
    // Grupo D · Queda 3
    [
      ['sq04', 1, 7],
      ['sq20', 2, 4],
      ['sq37', 3, 3],
      ['sq13', 4, 8],
      ['sq36', 5, 3],
      ['sq05', 6, 0],
      ['sq44', 7, 7],
      ['sq45', 8, 5],
      ['sq21', 9, 7],
      ['sq12', 10, 5],
      ['sq29', 11, 5],
      ['sq28', 12, 2],
    ],
  ],
};

export const EXPECTED_GROUP_TABLES: Record<GroupName, TableRow[]> = {
  A: [
    ['sq48', 24, 2, 18],
    ['sq09', 18, 1, 15],
    ['sq01', 18, 0, 18],
    ['sq16', 16, 0, 16],
    ['sq17', 15, 0, 15],
    ['sq41', 14, 0, 14],
    ['sq24', 13, 0, 13],
    ['sq08', 11, 0, 11],
    ['sq25', 8, 0, 8],
    ['sq33', 7, 0, 7],
    ['sq32', 4, 0, 4],
    ['sq40', 3, 0, 3],
  ],
  B: [
    ['sq26', 23, 2, 17],
    ['sq34', 19, 0, 19],
    ['sq02', 18, 1, 15],
    ['sq07', 17, 0, 17],
    ['sq10', 16, 0, 16],
    ['sq23', 14, 0, 14],
    ['sq15', 12, 0, 12],
    ['sq47', 11, 0, 11],
    ['sq18', 10, 0, 10],
    ['sq31', 9, 0, 9],
    ['sq42', 8, 0, 8],
    ['sq39', 6, 0, 6],
  ],
  C: [
    ['sq19', 22, 0, 22],
    ['sq38', 19, 1, 16],
    ['sq35', 18, 0, 18],
    ['sq14', 17, 1, 14],
    ['sq03', 17, 0, 17],
    ['sq11', 16, 0, 16],
    ['sq30', 15, 0, 15],
    ['sq46', 14, 0, 14],
    ['sq43', 13, 1, 10],
    ['sq27', 12, 0, 12],
    ['sq06', 9, 0, 9],
    ['sq22', 8, 0, 8],
  ],
  D: [
    ['sq12', 24, 1, 21],
    ['sq44', 22, 1, 19],
    ['sq21', 21, 0, 21],
    ['sq04', 18, 1, 15],
    ['sq45', 18, 0, 18],
    ['sq29', 15, 0, 15],
    ['sq20', 11, 0, 11],
    ['sq37', 10, 0, 10],
    ['sq13', 9, 0, 9],
    ['sq28', 8, 0, 8],
    ['sq36', 6, 0, 6],
    ['sq05', 1, 0, 1],
  ],
};

export const EXPECTED_PHASE2_SEEDS: string[] = ['sq48', 'sq12', 'sq26', 'sq19', 'sq44', 'sq38', 'sq34', 'sq09'];

export const QUARTERFINALS: Series[] = [
  { a: 'sq48', b: 'sq34', scoreA: 2, scoreB: 1 },
  { a: 'sq19', b: 'sq44', scoreA: 0, scoreB: 2 },
  { a: 'sq12', b: 'sq09', scoreA: 2, scoreB: 0 },
  { a: 'sq26', b: 'sq38', scoreA: 1, scoreB: 2 },
];

export const SEMIFINALS: Series[] = [
  { a: 'sq48', b: 'sq44', scoreA: 1, scoreB: 2 },
  { a: 'sq12', b: 'sq38', scoreA: 2, scoreB: 1 },
];

export const EXPECTED_FINALISTS: string[] = ['sq44', 'sq12'];
export const EXPECTED_REPECHAGE: string[] = ['sq48', 'sq38'];

export const FINAL_DROPS: DropRow[][] = [
  // Final · Queda 1
  [
    ['sq12', 1, 2],
    ['sq48', 2, 0],
    ['sq44', 3, 5],
    ['sq38', 4, 7],
  ],
  // Final · Queda 2
  [
    ['sq12', 1, 1],
    ['sq48', 2, 3],
    ['sq38', 3, 3],
    ['sq44', 4, 5],
  ],
  // Final · Queda 3
  [
    ['sq44', 1, 6],
    ['sq48', 2, 6],
    ['sq38', 3, 3],
    ['sq12', 4, 2],
  ],
  // Final · Queda 4
  [
    ['sq12', 1, 2],
    ['sq38', 2, 7],
    ['sq44', 3, 6],
    ['sq48', 4, 3],
  ],
  // Final · Queda 5 (vale ×2)
  [
    ['sq48', 1, 2],
    ['sq44', 2, 1],
    ['sq38', 3, 6],
    ['sq12', 4, 5],
  ],
];

export const EXPECTED_FINAL_TABLE: Array<[squadId: string, points: number]> = [
  ['sq38', 32],
  ['sq44', 27],
  ['sq12', 26],
  ['sq48', 22],
];

export const EXPECTED_CHAMPION = 'sq38'; // Esquadrão Capital


// ─────────────── Conferência independente (somas diretas, sem o motor) ───────────────

const byTable = (x: TableRow, y: TableRow): number => y[1] - x[1] || y[2] - x[2] || y[3] - x[3];

/** Soma as quedas de uma sala: pontos = (kills + 3 se Booyah) × multiplicador da queda. */
export function sumDrops(drops: DropRow[][], multipliers: number[] = []): TableRow[] {
  const table = new Map<string, TableRow>();
  drops.forEach((drop, index) => {
    const multiplier = multipliers[index] ?? 1;
    for (const [squadId, placement, kills] of drop) {
      const row = table.get(squadId) ?? [squadId, 0, 0, 0];
      const booyah = placement === 1 ? 1 : 0;
      row[1] += (kills * POINTS_PER_KILL + booyah * POINTS_PER_BOOYAH) * multiplier;
      row[2] += booyah;
      row[3] += kills;
      table.set(squadId, row);
    }
  });
  return [...table.values()].sort(byTable);
}

/** Vencedor de uma série MD3. */
export const seriesWinner = (series: Series): string => (series.scoreA > series.scoreB ? series.a : series.b);
export const seriesLoser = (series: Series): string => (series.scoreA > series.scoreB ? series.b : series.a);

/** Acha a série entre dois squads, em qualquer ordem. */
export function findSeries(list: Series[], x: string, y: string): Series | undefined {
  return list.find((s) => (s.a === x && s.b === y) || (s.a === y && s.b === x));
}
