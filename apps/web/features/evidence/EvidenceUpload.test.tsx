import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { UploadError, type UploadProgress } from '@/shared/api/upload';
import { EvidenceUpload, type EvidenceUploadProps } from './EvidenceUpload';

const png = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

/** Envio controlado pelo teste: cada arquivo fica pendente até `finish` ou `fail`. */
function controlledUpload() {
  const pending = new Map<string, { progress: (p: UploadProgress) => void; resolve: (url: string) => void; reject: (e: Error) => void }>();
  const upload = vi.fn((file: File, onProgress: (p: UploadProgress) => void) => new Promise<string>((resolve, reject) => pending.set(file.name, { progress: onProgress, resolve, reject })));
  return {
    upload,
    progress: (name: string, p: UploadProgress) => act(() => pending.get(name)?.progress(p)),
    finish: async (name: string) => act(async () => pending.get(name)?.resolve(`data:image/jpeg;base64,${name}`)),
    fail: async (name: string, message: string) => act(async () => pending.get(name)?.reject(new UploadError(message))),
  };
}

function Harness(props: Partial<EvidenceUploadProps> & { initial?: string[]; onValue?: (urls: string[]) => void }) {
  const { initial = [], onValue, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <>
      <EvidenceUpload
        label="Print do resultado"
        value={value}
        onChange={(urls) => {
          setValue(urls);
          onValue?.(urls);
        }}
        {...rest}
      />
      <button type="button" onClick={() => setValue([])}>
        Limpar por fora
      </button>
    </>
  );
}

describe('EvidenceUpload', () => {
  it('mostra o progresso real de cada envio e a miniatura ao terminar', async () => {
    const user = userEvent.setup();
    const ctl = controlledUpload();
    const onValue = vi.fn();
    render(<Harness upload={ctl.upload} onValue={onValue} />);
    await user.upload(screen.getByLabelText(/Print do resultado/), png('placar.png'));

    ctl.progress('placar.png', { phase: 'preparing', percent: 10 });
    expect(screen.getByText('Preparando · 10%')).toBeInTheDocument();
    ctl.progress('placar.png', { phase: 'uploading', percent: 58 });
    expect(screen.getByText('Enviando · 58%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Enviando placar.png' })).toHaveAttribute('aria-valuenow', '58');

    await ctl.finish('placar.png');
    expect(screen.getByRole('img', { name: 'Anexo 1' })).toBeInTheDocument();
    expect(screen.getByText('Enviada')).toBeInTheDocument();
    expect(onValue).toHaveBeenLastCalledWith(['data:image/jpeg;base64,placar.png']);
  });

  it('erro em um arquivo não impede os outros; tipo e tamanho são conferidos antes de enviar', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const ctl = controlledUpload();
    render(<Harness upload={ctl.upload} max={6} />);
    await user.upload(screen.getByLabelText(/Print do resultado/), [png('a.png'), png('b.png'), new File(['x'], 'doc.pdf', { type: 'application/pdf' })]);
    expect(ctl.upload).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Envie uma imagem PNG, JPG ou WebP.')).toBeInTheDocument();
    await ctl.fail('a.png', 'A conexão caiu durante o envio. Tente de novo.');
    await ctl.finish('b.png');
    const list = screen.getByRole('list', { name: 'Provas anexadas' });
    expect(within(list).getAllByRole('alert').map((a) => a.textContent).sort()).toEqual(['A conexão caiu durante o envio. Tente de novo.', 'Envie uma imagem PNG, JPG ou WebP.']);
    expect(within(list).getByText('Enviada')).toBeInTheDocument();
  });

  it('respeita o máximo e avisa quantos arquivos ficaram de fora', async () => {
    const user = userEvent.setup();
    const ctl = controlledUpload();
    render(<Harness upload={ctl.upload} max={2} />);
    await user.upload(screen.getByLabelText(/Print do resultado/), [png('1.png'), png('2.png'), png('3.png')]);
    expect(ctl.upload).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Só cabem 2 imagens. 1 arquivo ficou de fora.');
    expect(screen.getByRole('button', { name: /Print do resultado/ })).toBeDisabled();
  });

  it('avisa a tela enquanto há envio em andamento', async () => {
    const user = userEvent.setup();
    const ctl = controlledUpload();
    const onBusyChange = vi.fn();
    render(<Harness upload={ctl.upload} onBusyChange={onBusyChange} />);
    await user.upload(screen.getByLabelText(/Print do resultado/), png('placar.png'));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await ctl.finish('placar.png');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('remover tira a prova do valor; limpar por fora tira as miniaturas', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={['data:a', 'data:b']} onValue={onValue} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Remover anexo 1' }));
    expect(onValue).toHaveBeenLastCalledWith(['data:b']);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Limpar por fora' }));
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('campo obrigatório com dica e erro ligados ao campo', () => {
    const { rerender } = render(<EvidenceUpload label="Prova" required hint="Print da tela final." value={[]} onChange={() => {}} />);
    const input = screen.getByLabelText(/Prova/);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Print da tela final.');
    rerender(<EvidenceUpload label="Prova" required hint="Print da tela final." error="Anexe pelo menos um print" value={[]} onChange={() => {}} />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Anexe pelo menos um print');
    expect(screen.getByRole('alert')).toHaveTextContent('Anexe pelo menos um print');
  });
});
