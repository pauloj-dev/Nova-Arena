import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Permite rodar mais de uma instância ao mesmo tempo (ex.: dev e E2E), cada uma com sua pasta de build.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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

// BotID (issue #69): rotas do desafio anti-bot servidas pelo próprio domínio.
export default withBotId(nextConfig);
