'use client';

import { SetPasswordInput, type OAuthLink, type OAuthProviderName } from '@nova/schemas';
import { Badge, Button, Input, Skeleton, useToast } from '@nova/ui';
import { CheckCircle2, KeyRound, Link2, Unlink } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { oauthStartUrl, useLoginMethods, useSetPassword, useUnlinkProvider } from '@/shared/api/hooks/login-methods';
import { isModuleMocked } from '@/shared/api/mode';
import { useT } from '@/shared/i18n/react';
import { formatDate } from '@/shared/lib/datetime';
import { PrototypeNotice } from '@/features/auth/AuthParts';
import { messages } from '../messages';

const PROVIDERS: { id: OAuthProviderName; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
];

/** Retorno do provedor depois de vincular (`?vinculado=` / `?erro=`). */
function LinkResult() {
  const params = useSearchParams();
  const t = useT(messages, 'LoginMethodsSection');
  const linked = PROVIDERS.find((p) => p.id === params.get('vinculado'));
  if (linked) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm font-medium text-primary-soft-text">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t('vinculado', { provedor: linked.label })}
      </p>
    );
  }
  if (params.get('erro') === 'oauth_ja_vinculado') {
    return (
      <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
        {t('jaVinculada')}
      </p>
    );
  }
  return null;
}

function SetPasswordForm() {
  const setPassword = useSetPassword();
  const t = useT(messages, 'LoginMethodsSection');
  const toast = useToast();
  const [password, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = SetPasswordInput.safeParse({ password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setPassword.mutate(parsed.data.password, {
      onSuccess: () => toast.success(t('senhaDefinida'), t('senhaDefinidaDescricao')),
      onError: (err) => toast.error(t('erroDefinir'), errorMessage(err)),
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-sm text-muted">{t('semSenhaAviso')}</p>
      <Input label={t('novaSenha')} type="password" autoComplete="new-password" value={password} onChange={(e) => setValue(e.target.value)} error={fieldError} />
      <Button type="submit" className="self-start" loading={setPassword.isPending} iconLeft={<KeyRound className="size-4" aria-hidden />}>
        {t('definirSenha')}
      </Button>
    </form>
  );
}

function ProviderRow({ id, label, link, mocked }: { id: OAuthProviderName; label: string; link: OAuthLink | undefined; mocked: boolean }) {
  const unlink = useUnlinkProvider();
  const t = useT(messages, 'LoginMethodsSection');
  const toast = useToast();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold">{label}</span>
        {link ? (
          <span className="text-sm text-muted [overflow-wrap:anywhere]">
            {t('vinculadaDesde', { conta: link.email ?? t('contaVinculada'), data: formatDate(link.linkedAt) })}
          </span>
        ) : (
          <span className="text-sm text-muted">{t('naoVinculado')}</span>
        )}
      </div>
      {link ? (
        <div className="flex items-center gap-2">
          <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
            {t('vinculadoSelo')}
          </Badge>
          <Button
            size="sm"
            variant="secondary"
            loading={unlink.isPending}
            iconLeft={<Unlink className="size-4" aria-hidden />}
            onClick={() =>
              unlink.mutate(id, {
                onSuccess: () => toast.success(t('desvinculado', { provedor: label })),
                onError: (err) => toast.error(t('erroDesvincular', { provedor: label }), errorMessage(err)),
              })
            }
          >
            {t('desvincular')}
          </Button>
        </div>
      ) : mocked ? (
        <Button size="sm" variant="secondary" disabled aria-describedby="vinculo-prototipo" iconLeft={<Link2 className="size-4" aria-hidden />}>
          {t('vincular')}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" asChild>
          <a href={oauthStartUrl(id, { mode: 'link' })}>
            <Link2 className="size-4" aria-hidden />
            {t('vincular')}
          </a>
        </Button>
      )}
    </li>
  );
}

/** Senha e provedores de login social da conta (issue #68). */
export function LoginMethodsSection() {
  const methods = useLoginMethods();
  const mocked = isModuleMocked('auth');
  const t = useT(messages, 'LoginMethodsSection');

  return (
    <section aria-labelledby="seguranca-acesso" className="flex flex-col gap-3">
      <h2 id="seguranca-acesso" className="text-lg">
        {t('titulo')}
      </h2>
      <LinkResult />
      {methods.isPending ? (
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : methods.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t('erroCarregar')}</span>
          <Button size="sm" variant="secondary" onClick={() => void methods.refetch()}>
            {t('tentarDeNovo')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {methods.data.hasPassword ? t('emailESenha') : t('semSenha')}
            {methods.data.links.length > 0 ? t('provedores', { count: methods.data.links.length }) : ''}
          </p>
          <ul className="divide-y divide-border">
            {PROVIDERS.map((p) => (
              <ProviderRow key={p.id} id={p.id} label={p.label} link={methods.data.links.find((l) => l.provider === p.id)} mocked={mocked} />
            ))}
          </ul>
          {mocked && (
            <PrototypeNotice id="vinculo-prototipo">
              <p>{t('prototipo')}</p>
            </PrototypeNotice>
          )}
          {!methods.data.hasPassword && <SetPasswordForm />}
        </>
      )}
    </section>
  );
}
