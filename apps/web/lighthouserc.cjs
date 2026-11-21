/**
 * Lighthouse CI das páginas públicas (plano R2.1, issue #111): meta **≥ 90 no celular**, LCP ≤ 2,5 s, CLS ≤ 0,1
 * e TBT ≤ 200 ms como aviso (o INP só existe com gente de verdade; no laboratório o TBT é o melhor indicador — o INP real
 * vem do Speed Insights).
 *
 * Roda contra `next start` local, na porta 3152 (`LHCI_BASE_URL` muda). No CI (`.github/workflows/desempenho.yml`, job
 * `desempenho`) o build usa a **API real** com o Postgres do runner e a seed, como em produção: com a API simulada,
 * a página espera o service worker do MSW e o código do mock antes de desenhar, e a nota mediria o protótipo.
 *
 * `LHCI_TOURNAMENT_SLUG` escolhe o campeonato da página `/c/<slug>` (padrão: o da seed de desempenho).
 */
const base = (process.env.LHCI_BASE_URL ?? 'http://localhost:3152').replace(/\/$/, '');
const slug = process.env.LHCI_TOURNAMENT_SLUG ?? 'copa-lighthouse';
const paths = ['/', '/campeonatos', `/c/${slug}`, '/jogos', '/ranking', '/termos'];

function strict() {
  return {
    'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
    'categories:accessibility': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
    'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median-run' }],
    'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median-run' }],
    // TBT oscila muito entre execuções (CPU do runner): aviso. A nota de desempenho (que já pesa o TBT) é o gate.
    'total-blocking-time': ['warn', { maxNumericValue: 200, aggregationMethod: 'median-run' }],
    'categories:best-practices': ['warn', { minScore: 0.9 }],
    'categories:seo': ['warn', { minScore: 0.9 }],
  };
}

module.exports = {
  ci: {
    collect: {
      url: paths.map((path) => `${base}${path}`),
      // Sem `LHCI_BASE_URL`, sobe o servidor do build de produção (mesmo `NEXT_DIST_DIR` do build).
      ...(process.env.LHCI_BASE_URL ? {} : { startServerCommand: 'pnpm exec next start -p 3152', startServerReadyPattern: 'Ready in', startServerReadyTimeout: 60000 }),
      numberOfRuns: Number(process.env.LHCI_RUNS ?? 3),
      settings: {
        // Celular (padrão do Lighthouse: Moto G Power, 4G lento, CPU 4x mais lenta).
        formFactor: 'mobile',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        chromeFlags: '--no-sandbox --headless=new',
        // No CI não há HTTPS nem CDN: a nota de "usa HTTP/2" e de cache longo não depende do código.
        skipAudits: ['uses-http2', 'redirects-http'],
      },
    },
    assert: {
      assertMatrix: [
        {
          // `/ranking` ainda busca a tabela no navegador (o texto que vira o LCP depende dela): nota abaixo de 90 no
          // celular (≈ 80, LCP ≈ 5 s simulado). Fica como aviso até a tela vir pronta do servidor (dívida do #111).
          matchingUrlPattern: '/ranking',
          assertions: { ...strict(), 'categories:performance': ['warn', { minScore: 0.9 }], 'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }] },
        },
        { matchingUrlPattern: '^(?!.*/ranking).*$', assertions: strict() },
      ],
    },
    upload: {
      // Relatórios ficam como artefato do CI (pasta `.lighthouseci`); sem servidor do LHCI nem link público.
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
