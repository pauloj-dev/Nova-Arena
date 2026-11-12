import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
