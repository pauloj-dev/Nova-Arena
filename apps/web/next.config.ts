import { withSerwist } from '@serwist/turbopack';
import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Permite rodar mais de uma instância ao mesmo tempo (ex.: dev e E2E), cada uma com sua pasta de build.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Os pacotes internos são consumidos como código-fonte TypeScript.
  transpilePackages: ['@nova/ui', '@nova/schemas', '@nova/engine', '@nova/api', '@nova/db', '@nova/email'],
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
// Serwist (issue #105): o esbuild que empacota o service worker fica fora do bundle do servidor.
export default withBotId(withSerwist(nextConfig));
