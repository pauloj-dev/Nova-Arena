import type { Preview } from '@storybook/react-vite';
import './storybook.css';

type Theme = 'light' | 'dark';
type Area = 'participant' | 'organizer' | 'admin';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Tema',
      toolbar: {
        title: 'Tema',
        icon: 'mirror',
        dynamicTitle: true,
        items: [
          { value: 'light', title: 'Claro', icon: 'sun' },
          { value: 'dark', title: 'Escuro (Arena Night)', icon: 'moon' },
        ],
      },
    },
    area: {
      description: 'Área',
      toolbar: {
        title: 'Área',
        icon: 'user',
        dynamicTitle: true,
        items: [
          { value: 'participant', title: 'Participante' },
          { value: 'organizer', title: 'Organizador' },
          { value: 'admin', title: 'Admin' },
        ],
      },
    },
  },
  initialGlobals: { theme: 'light', area: 'participant' },
  parameters: {
    layout: 'padded',
    // O fundo vem dos tokens (--bg), não do seletor de fundo do Storybook.
    backgrounds: { disable: true },
    controls: { expanded: true },
    a11y: { test: 'error' },
    options: {
      storySort: { order: ['Fundamentos', 'Ações', 'Formulário', 'Status', 'Conteúdo', 'Feedback', 'Sobreposição', 'Navegação', 'Dados'] },
    },
  },
  decorators: [
    (Story, context) => {
      // `data-theme` e `data-area` no <html>, como no app: os tokens mudam sem trocar classe nenhuma.
      const root = document.documentElement;
      root.lang = 'pt-BR';
      root.dataset.theme = (context.globals.theme as Theme | undefined) ?? 'light';
      root.dataset.area = (context.globals.area as Area | undefined) ?? 'participant';
      return <Story />;
    },
  ],
};

export default preview;
