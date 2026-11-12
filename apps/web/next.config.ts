import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Permite rodar mais de uma instância ao mesmo tempo (ex.: dev e E2E), cada uma com sua pasta de build.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Os pacotes internos são consumidos como código-fonte TypeScript.
  transpilePackages: ['@nova/ui', '@nova/schemas', '@nova/engine'],
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

export default nextConfig;
