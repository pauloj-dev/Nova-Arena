'use client';

import type { TwoFactorSetup } from '@nova/schemas';
import { Badge, Button, Input, Modal, Skeleton, useToast } from '@nova/ui';
import { Check, Copy, Download, FlaskConical, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useDisableTwoFactor, useEnableTwoFactor, useSetupTwoFactor, useTwoFactorDevCode, useTwoFactorStatus } from '@/shared/api/hooks/admin-security';

type Setup = z.infer<typeof TwoFactorSetup>;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": mais fácil de digitar no aplicativo. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Só no protótipo: mostra o código do momento, para a demonstração funcionar sem aplicativo autenticador.
 * Na versão final este aviso não existe (o código só existe no aparelho da pessoa).
 */
function PrototypeCode({ onUse }: { onUse: (code: string) => void }) {
  const dev = useTwoFactorDevCode(true);
  return (
    <div role="note" className="flex flex-col gap-2 rounded-md border border-border-strong bg-info-soft px-3 py-3 text-sm text-info-soft-text" data-testid="prototype-code">
      <Badge tone="info" className="self-start border border-info" icon={<FlaskConical className="size-3.5" aria-hidden />}>
        Protótipo
      </Badge>
      <p>Sem aplicativo autenticador à mão? No protótipo, o código do momento aparece aqui. Na versão final ele só existe no seu celular.</p>
      {dev.data ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular font-mono text-lg font-bold tracking-widest" data-testid="dev-code">
            {dev.data.code}
          </span>
          <span className="text-xs">troca em {dev.data.expiresInSeconds} s</span>
          <Button size="sm" variant="secondary" onClick={() => onUse(dev.data.code)}>
            Usar este código
          </Button>
        </div>
      ) : dev.isError ? (
        <p>Não foi possível buscar o código agora.</p>
      ) : (
        <Skeleton className="h-8 w-40" />
      )}
    </div>
  );
}

function RecoveryCodes({ codes, onDone, adminArea }: { codes: string[]; onDone: () => void; adminArea: boolean }) {
  const toast = useToast();
  const text = codes.join('\n');

  function download() {
    const blob = new Blob([`Nova Arena — códigos de recuperação da verificação em duas etapas\nCada código funciona uma única vez.\n\n${text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nova-arena-codigos-de-recuperacao.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="recovery-codes">
      <p role="status" className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-soft-text">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Verificação em duas etapas ativada.
      </p>
      <h3 className="text-base font-semibold">Guarde os códigos de recuperação</h3>
      <p className="text-sm text-muted">Se você perder o celular, cada código abaixo entra no lugar do aplicativo uma única vez. Eles aparecem só agora: copie ou baixe e guarde num lugar seguro.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-2 p-3" aria-label="Códigos de recuperação">
        {codes.map((code) => (
          <li key={code} className="tabular font-mono text-sm">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void copyText(text).then((ok) => (ok ? toast.success('Códigos copiados') : toast.error('Não foi possível copiar', 'Selecione os códigos e copie manualmente.')))}
          iconLeft={<Copy className="size-4" aria-hidden />}
        >
          Copiar códigos
        </Button>
        <Button variant="secondary" onClick={download} iconLeft={<Download className="size-4" aria-hidden />}>
          Baixar (.txt)
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button onClick={onDone} iconLeft={<Check className="size-4" aria-hidden />}>
          Já guardei os códigos
        </Button>
        {adminArea && (
          <Button asChild variant="secondary">
            <Link href="/admin">Ir para a administração</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function SetupSteps({ setup, onCancel, onEnabled }: { setup: Setup; onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const toast = useToast();
  const enable = useEnableTwoFactor();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return setError('O código tem 6 dígitos');
    setError(null);
    try {
      // `mutateAsync`, e não os callbacks de `mutate`: assim que a conta fica ativa este passo a passo sai da
      // tela, e callback de componente desmontado não roda — os códigos de recuperação se perderiam.
      const { recoveryCodes } = await enable.mutateAsync(clean);
      onEnabled(recoveryCodes);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_CODE') setError('Código incorreto ou vencido. Confira o aplicativo e tente de novo.');
      else toast.error('Não foi possível ativar', errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="two-factor-setup">
      <ol className="flex flex-col gap-5">
        <li className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Smartphone className="size-4 text-muted" aria-hidden />
            1. Leia o QR code no aplicativo autenticador
          </h3>
          <p className="text-sm text-muted">Use Google Authenticator, Microsoft Authenticator, Authy ou outro aplicativo de códigos. No aplicativo, escolha adicionar conta e aponte a câmera.</p>
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            {setup.qrSvg ? (
              // eslint-disable-next-line @next/next/no-img-element -- SVG gerado na hora, embutido como data URI (sem requisição nem script)
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR code para adicionar a Nova Arena ao aplicativo autenticador" width={192} height={192} className="size-48 shrink-0 rounded-md border border-border" data-testid="two-factor-qr" />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2 md:flex-1">
              <p className="text-sm">Não dá para ler o QR code? Digite esta chave no aplicativo (tipo: baseado em tempo):</p>
              <code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider [overflow-wrap:anywhere]" data-testid="two-factor-secret">
                {groupSecret(setup.secret)}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copyText(setup.secret).then(setCopied)} iconLeft={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
                  {copied ? 'Chave copiada' : 'Copiar chave'}
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href={setup.otpauthUrl}>Abrir no aplicativo</a>
                </Button>
              </div>
            </div>
          </div>
        </li>
        <li className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound className="size-4 text-muted" aria-hidden />
            2. Digite o código de 6 dígitos que o aplicativo mostra
          </h3>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate aria-label="Confirmar código">
            <Input
              label="Código do aplicativo"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={error ?? undefined}
              className="max-w-xs"
              inputClassName="tabular font-mono tracking-widest"
            />
            <PrototypeCode onUse={setCode} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={enable.isPending}>
                Ativar verificação
              </Button>
              <Button variant="secondary" onClick={onCancel} disabled={enable.isPending}>
                Cancelar
              </Button>
            </div>
          </form>
        </li>
      </ol>
    </div>
  );
}

function DisableModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const disable = useDisableTwoFactor();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6) return setError('Informe o código');
    setError(null);
    disable.mutate(code.trim(), {
      onSuccess: () => {
        toast.success('Verificação em duas etapas desligada');
        onClose();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'INVALID_CODE') setError('Código incorreto ou vencido.');
        else toast.error('Não foi possível desligar', errorMessage(e));
      },
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !disable.isPending) onClose();
      }}
      title="Desligar a verificação em duas etapas"
      description="Sua conta volta a depender só da senha. Para confirmar, informe o código do aplicativo ou um código de recuperação."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={disable.isPending}>
            Voltar
          </Button>
          <Button type="submit" form="disable-2fa" variant="danger" loading={disable.isPending}>
            Desligar
          </Button>
        </>
      }
    >
      <form id="disable-2fa" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input label="Código do aplicativo ou de recuperação" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} error={error ?? undefined} inputClassName="font-mono" />
        <PrototypeCode onUse={setCode} />
      </form>
    </Modal>
  );
}

/**
 * Verificação em duas etapas (RNF-08): ativar com QR code ou chave manual, confirmar com o código,
 * guardar os códigos de recuperação (mostrados uma vez) e desligar. Para administradores é obrigatória.
 */
export function TwoFactorSection({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const status = useTwoFactorStatus();
  const setup = useSetupTwoFactor();
  const [pending, setPending] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
        {errorMessage(status.error)}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void status.refetch()}>
          Tentar novamente
        </button>
      </p>
    );
  }

  const { enabled, required, recoveryCodesLeft } = status.data;

  function start() {
    setup.mutate(undefined, {
      onSuccess: setPending,
      onError: (error) => toast.error('Não foi possível começar a configuração', errorMessage(error)),
    });
  }

  return (
    <section aria-labelledby="seguranca-2fa" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="seguranca-2fa" className="text-lg">
          Verificação em duas etapas
        </h2>
        {enabled ? (
          <Badge tone="primary" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
            Ativa
          </Badge>
        ) : (
          <Badge tone="neutral" icon={<ShieldOff className="size-3.5" aria-hidden />}>
            Inativa
          </Badge>
        )}
      </div>

      {recoveryCodes ? (
        <RecoveryCodes codes={recoveryCodes} adminArea={isAdmin} onDone={() => setRecoveryCodes(null)} />
      ) : pending && !enabled ? (
        <SetupSteps
          setup={pending}
          onCancel={() => setPending(null)}
          onEnabled={(codes) => {
            setPending(null);
            setRecoveryCodes(codes);
          }}
        />
      ) : enabled ? (
        <>
          <p className="text-sm text-muted">Além da senha, sua conta pede um código de 6 dígitos gerado pelo aplicativo autenticador no seu celular.</p>
          <p className="text-sm">
            Códigos de recuperação restantes: <span className="tabular font-semibold">{recoveryCodesLeft}</span>
            {recoveryCodesLeft === 0 && <span className="text-muted"> — se perder o celular, só o Super Admin consegue redefinir a verificação.</span>}
          </p>
          {required ? (
            <p role="note" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
              Para administradores a verificação em duas etapas é obrigatória e não pode ser desligada. Trocou de celular? Peça ao Super Admin para redefinir e configure de novo.
            </p>
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setDisabling(true)} iconLeft={<ShieldOff className="size-4" aria-hidden />}>
              Desligar verificação
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Com a verificação em duas etapas, além da senha você informa um código de 6 dígitos gerado por um aplicativo autenticador no seu celular. Assim, mesmo que alguém descubra a sua senha, não consegue entrar na conta.
          </p>
          {required ? (
            <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
              Você é administrador: a área de administração fica bloqueada até a verificação em duas etapas estar ativa.
            </p>
          ) : (
            <p className="text-sm text-muted">Ela é obrigatória para administradores e opcional para as demais contas.</p>
          )}
          <Button className="self-start" onClick={start} loading={setup.isPending} iconLeft={<ShieldCheck className="size-4" aria-hidden />}>
            Ativar verificação em duas etapas
          </Button>
        </>
      )}

      {disabling && <DisableModal onClose={() => setDisabling(false)} />}
    </section>
  );
}
