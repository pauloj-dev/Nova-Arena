import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Select } from '../components/Field';
import { Drawer, type DrawerProps } from '../components/Overlay';
import { Checkbox } from '../components/Toggle';
import { gameOptions } from './fixtures';

const meta = {
  title: 'Sobreposição/Drawer',
  component: Drawer,
  args: { open: true, onOpenChange: () => {}, title: 'Filtros', side: 'right' },
  argTypes: { side: { control: 'inline-radio', options: ['left', 'right', 'bottom'] }, footer: { control: false }, children: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

function Filters() {
  const [open, setOpen] = useState(true);
  const [free, setFree] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Select label="Jogo" options={gameOptions} defaultValue="free-fire" />
      <Checkbox label="Só com inscrições abertas" checked={open} onCheckedChange={setOpen} />
      <Checkbox label="Só campeonatos gratuitos" checked={free} onCheckedChange={setFree} />
    </div>
  );
}

function DrawerDemo({ side, title = 'Filtros', children, withFooter = true }: Pick<DrawerProps, 'side' | 'children'> & { title?: string; withFooter?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Abrir {title.toLowerCase()}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={title}
        side={side}
        footer={
          withFooter ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Limpar
              </Button>
              <Button fullWidth onClick={() => setOpen(false)}>
                Ver 12 campeonatos
              </Button>
            </>
          ) : undefined
        }
      >
        {children ?? <Filters />}
      </Drawer>
    </div>
  );
}

export const Direita: Story = { render: () => <DrawerDemo side="right" /> };

export const Esquerda: Story = {
  name: 'Esquerda (menu)',
  render: () => (
    <DrawerDemo side="left" title="Menu" withFooter={false}>
      <nav aria-label="Principal">
        <ul className="flex flex-col">
          {['Campeonatos', 'Meus squads', 'Minhas inscrições', 'Disputas', 'Conta'].map((item) => (
            <li key={item}>
              <a href="#menu" className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-text hover:bg-neutral-soft">
                {item}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </DrawerDemo>
  ),
};

export const Embaixo: Story = {
  name: 'Embaixo (filtros no celular)',
  render: () => <DrawerDemo side="bottom" />,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
