import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from '../components/Surface';
import { squads } from './fixtures';

const meta = {
  title: 'Conteúdo/Avatar',
  component: Avatar,
  args: { name: 'Rafaela Monteiro', size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] } },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Imagem embutida (um quadrado com o acento da área), para a story não depender de rede.
const picture = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="currentColor" opacity="0.35"/><circle cx="4" cy="3" r="1.6" fill="currentColor"/><rect x="1.2" y="5.2" width="5.6" height="3" rx="1.4" fill="currentColor"/></svg>',
)}`;

export const Iniciais: Story = {};

export const Tamanhos: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar name="Rafaela Monteiro" size="sm" />
      <Avatar name="Rafaela Monteiro" size="md" />
      <Avatar name="Rafaela Monteiro" size="lg" />
      <Avatar name="Rafaela Monteiro" size="xl" />
    </div>
  ),
};

export const ComImagem: Story = {
  name: 'Com imagem',
  args: { src: picture, size: 'lg' },
};

export const ImagemQuebrada: Story = {
  name: 'Imagem que não carrega (cai nas iniciais)',
  args: { src: '/nao-existe.png', size: 'lg', name: 'Caio Ferraz' },
};

export const UmNome: Story = { name: 'Um nome só', args: { name: 'Thiago' } };

export const ElencoDoSquad: Story = {
  name: 'Elenco do squad',
  render: () => (
    <ul className="flex flex-col gap-2">
      {squads.slice(0, 4).map((s) => (
        <li key={s.id} className="flex items-center gap-3">
          <Avatar name={s.captain} />
          <span className="text-sm text-text">{s.captain}</span>
        </li>
      ))}
    </ul>
  ),
};
