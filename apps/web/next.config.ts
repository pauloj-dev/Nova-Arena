import { withSentryConfig } from '@sentry/nextjs/config';
import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './shared/security/headers';

const nextConfig: NextConfig = {
  // Permite rodar mais de uma instância ao mesmo tempo (ex.: dev e E2E), cada uma com sua pasta de build.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Não anuncia o framework (#113).
  poweredByHeader: false,
  // Headers de segurança em toda resposta (#113): HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options.
  // A CSP (com nonce) sai do `proxy.ts`, por página.
  async headers() {
    return [{ source: '/:path*', headers: staticSecurityHeaders() }];
  },
  // Os pacotes internos são consumidos como código-fonte TypeScript.
  transpilePackages: ['@nova/ui', '@nova/schemas', '@nova/engine', '@nova/api', '@nova/db', '@nova/email'],
  // Imagens otimizadas (#111): só as do Vercel Blob público da Nova Arena (banners, logos, capas, avatares).
  // Provas e denúncias são privadas (`/api/v1/files/:id`, com sessão) e não passam pelo otimizador.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com', pathname: '/**' }],
  },
  experimental: {
    // Componentes importados pelo barril `radix-ui`: só o que a página usa entra no pacote
    // (`lucide-react` e `recharts` já estão na lista padrão do Next).
    optimizePackageImports: ['radix-ui'],
  },
  turbopack: {
    // `msw/browser` não resolve no servidor; lá entra um módulo vazio.
    resolveAlias: { '#msw-browser': { browser: 'msw/browser', default: './mocks/msw-server-stub.ts' } },
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

// Sentry (issue #116): só entra no build quando há DSN. Sem DSN, nada muda (nem plugin, nem túnel).
// Os erros do navegador vão por `/monitoring` (mesmo domínio: passa pela CSP e por bloqueadores de anúncio).
// Mapas de código só sobem com `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT`.
const sentryEnabled = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
const withSentry = (config: NextConfig): NextConfig =>
  sentryEnabled
    ? withSentryConfig(config, {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        silent: !process.env.CI,
        telemetry: false,
        tunnelRoute: '/monitoring',
        sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      })
    : config;

// BotID (issue #69): rotas do desafio anti-bot servidas pelo próprio domínio.
export default withSentry(withBotId(nextConfig));
