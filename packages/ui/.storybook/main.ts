import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    // Os pacotes do Radix trazem "use client", que não tem efeito no Storybook: o aviso só polui o build.
    viteConfig.build = {
      ...viteConfig.build,
      rolldownOptions: {
        ...viteConfig.build?.rolldownOptions,
        onLog(level, log, handler) {
          if (log.code === 'MODULE_LEVEL_DIRECTIVE') return;
          handler(level, log);
        },
      },
    };
    return viteConfig;
  },
};

export default config;
