'use client';

import type { TwoFactorSetup } from '@nova/schemas';
import { Badge, Button, Input, Modal, Skeleton, useToast } from '@nova/ui';
import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useDisableTwoFactor, useEnableTwoFactor, useSetupTwoFactor, useTwoFactorStatus } from '@/shared/api/hooks/admin-security';
import { isModuleMocked } from '@/shared/api/mode';
import { useT } from '@/shared/i18n/react';
import { messages } from '../messages';
import { PrototypeCode } from './PrototypeCode';
import { qrSvg } from './qr';

type Setup = z.infer<typeof TwoFactorSetup>;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function safeQr(text: string): string {
  try {
    return qrSvg(text);
  } catch {
    // Sem QR code, a chave para digitar continua na tela.
    return '';
  }
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": mais fácil de digitar no aplicativo. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function RecoveryCodes({ codes, onDone, adminArea }: { codes: string[]; onDone: () => void; adminArea: boolean }) {
  const toast = useToast();
  const t = useT(messages, 'TwoFactorSection');
  const text = codes.join('\n');

  function download() {
    const blob = new Blob([t('arquivo', { codigos: text })], { type: 'text/plain;charset=utf-8' });
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
        {t('ativada')}
      </p>
      <h3 className="text-base font-semibold">{t('guarde')}</h3>
      <p className="text-sm text-muted">{t('guardeDescricao')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-2 p-3" aria-label={t('codigosRecuperacao')}>
        {codes.map((code) => (
          <li key={code} className="tabular font-mono text-sm">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void copyText(text).then((ok) => (ok ? toast.success(t('codigosCopiados')) : toast.error(t('erroCopiar'), t('copieManualmente'))))}
          iconLeft={<Copy className="size-4" aria-hidden />}
        >
          {t('copiarCodigos')}
        </Button>
        <Button variant="secondary" onClick={download} iconLeft={<Download className="size-4" aria-hidden />}>
          {t('baixar')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button onClick={onDone} iconLeft={<Check className="size-4" aria-hidden />}>
          {t('jaGuardei')}
        </Button>
        {adminArea && (
          <Button asChild variant="secondary">
            <Link href="/admin">{t('irAdmin')}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function SetupSteps({ setup, onCancel, onEnabled }: { setup: Setup; onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const toast = useToast();
  const t = useT(messages, 'TwoFactorSection');
  const enable = useEnableTwoFactor();
  const adminSettingsMocked = isModuleMocked('admin-settings');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // A API real manda só o `otpauthUrl`: o QR code é desenhado aqui mesmo, no navegador.
  const qr = useMemo(() => setup.qrSvg || safeQr(setup.otpauthUrl), [setup.qrSvg, setup.otpauthUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return setError(t('codigoSeisDigitos'));
    setError(null);
    try {
      // `mutateAsync`, e não os callbacks de `mutate`: assim que a conta fica ativa este passo a passo sai da
      // tela, e callback de componente desmontado não roda — os códigos de recuperação se perderiam.
      const { recoveryCodes } = await enable.mutateAsync(clean);
      onEnabled(recoveryCodes);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_CODE') setError(t('codigoIncorretoAtivar'));
      else toast.error(t('erroAtivar'), errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="two-factor-setup">
      <ol className="flex flex-col gap-5">
        <li className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Smartphone className="size-4 text-muted" aria-hidden />
            {t('passo1')}
          </h3>
          <p className="text-sm text-muted">{t('passo1Descricao')}</p>
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- SVG gerado na hora, embutido como data URI (sem requisição nem script)
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt={t('qrAlt')} width={192} height={192} className="size-48 shrink-0 rounded-md border border-border" data-testid="two-factor-qr" />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2 md:flex-1">
              <p className="text-sm">{t('semQr')}</p>
              <code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider [overflow-wrap:anywhere]" data-testid="two-factor-secret">
                {groupSecret(setup.secret)}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copyText(setup.secret).then(setCopied)} iconLeft={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
                  {copied ? t('chaveCopiada') : t('copiarChave')}
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href={setup.otpauthUrl}>{t('abrirApp')}</a>
                </Button>
              </div>
            </div>
          </div>
        </li>
        <li className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound className="size-4 text-muted" aria-hidden />
            {t('passo2')}
          </h3>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate aria-label={t('confirmarCodigo')}>
            <Input
              label={t('codigoApp')}
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
            {adminSettingsMocked && <PrototypeCode onUse={setCode} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={enable.isPending}>
                {t('ativarVerificacao')}
              </Button>
              <Button variant="secondary" onClick={onCancel} disabled={enable.isPending}>
                {t('cancelar')}
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
  const t = useT(messages, 'TwoFactorSection');
  const disable = useDisableTwoFactor();
  const adminSettingsMocked = isModuleMocked('admin-settings');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6) return setError(t('informeCodigo'));
    setError(null);
    disable.mutate(code.trim(), {
      onSuccess: () => {
        toast.success(t('desligada'));
        onClose();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'INVALID_CODE') setError(t('codigoIncorreto'));
        else toast.error(t('erroDesligar'), errorMessage(e));
      },
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !disable.isPending) onClose();
      }}
      title={t('desligarTitulo')}
      description={t('desligarDescricao')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={disable.isPending}>
            {t('voltar')}
          </Button>
          <Button type="submit" form="disable-2fa" variant="danger" loading={disable.isPending}>
            {t('desligar')}
          </Button>
        </>
      }
    >
      <form id="disable-2fa" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input label={t('codigoAppOuRecuperacao')} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} error={error ?? undefined} inputClassName="font-mono" />
        {adminSettingsMocked && <PrototypeCode onUse={setCode} />}
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
  const t = useT(messages, 'TwoFactorSection');
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
          {t('tentarNovamente')}
        </button>
      </p>
    );
  }

  const { enabled, required, recoveryCodesLeft } = status.data;
  const codesLeft = t.rich('restantes', { count: recoveryCodesLeft, valor: (chunks) => <span className="tabular font-semibold">{chunks}</span> });

  function start() {
    setup.mutate(undefined, {
      onSuccess: setPending,
      onError: (error) => toast.error(t('erroComecar'), errorMessage(error)),
    });
  }

  return (
    <section aria-labelledby="seguranca-2fa" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="seguranca-2fa" className="text-lg">
          {t('titulo')}
        </h2>
        {enabled ? (
          <Badge tone="primary" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
            {t('ativa')}
          </Badge>
        ) : (
          <Badge tone="neutral" icon={<ShieldOff className="size-3.5" aria-hidden />}>
            {t('inativa')}
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
          <p className="text-sm text-muted">{t('ativaDescricao')}</p>
          <p className="text-sm">
            {codesLeft}
            {recoveryCodesLeft === 0 && <span className="text-muted">{t('semRestantes')}</span>}
          </p>
          {required ? (
            <p role="note" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
              {t('obrigatoriaAdmin')}
            </p>
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setDisabling(true)} iconLeft={<ShieldOff className="size-4" aria-hidden />}>
              {t('desligarVerificacao')}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {t('inativaDescricao')}
          </p>
          {required ? (
            <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
              {t('bloqueadaAdmin')}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('opcional')}</p>
          )}
          <Button className="self-start" onClick={start} loading={setup.isPending} iconLeft={<ShieldCheck className="size-4" aria-hidden />}>
            {t('ativarDuasEtapas')}
          </Button>
        </>
      )}

      {disabling && <DisableModal onClose={() => setDisabling(false)} />}
    </section>
  );
}
