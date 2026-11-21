'use client';

import { Button, Skeleton, useToast } from '@nova/ui';
import { CircleCheck, CircleX, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useResendVerification, useVerifyEmail } from '@/shared/api/hooks/users';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader, AuthSkeleton, PrototypeNotice, textLink } from './AuthParts';
import { useDevMailbox } from './devMailbox';
import { messages } from './messages';
import { safeNext, withNext } from './safeNext';

/** `/verificar-email`: sem `token`, a tela "confira seu e-mail"; com `token`, a confirmação do link. */
export function VerifyEmailScreen() {
  const params = useSearchParams();
  const token = params.get('token');
  const next = safeNext(params.get('next'));
  return token ? <ConfirmToken token={token} next={next} /> : <CheckInbox next={next} />;
}

/** Botão "Reenviar e-mail": gera um link novo (no protótipo, ele aparece no aviso da tela "confira seu e-mail"). */
function ResendButton({ email, variant = 'secondary', afterSent }: { email: string; variant?: 'primary' | 'secondary'; afterSent?: ReactNode }) {
  const t = useT(messages, 'VerifyEmailScreen');
  const resend = useResendVerification();
  const setVerifyToken = useDevMailbox((s) => s.setVerifyToken);
  const { success, error } = useToast();
  return (
    <>
      <Button
        variant={variant}
        fullWidth
        loading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: ({ devVerifyToken }) => {
              setVerifyToken(email, devVerifyToken);
              success(t('reenviadoTitulo'), t('reenviadoDescricao', { email }));
            },
            onError: (e) => error(t('erroReenviar'), errorMessage(e)),
          })
        }
      >
        {t('reenviar')}
      </Button>
      {resend.isSuccess && afterSent}
    </>
  );
}

/** O link de verificação do protótipo, quando há um para a conta logada. */
function DevVerifyLink({ email, next }: { email: string; next: string }) {
  const t = useT(messages, 'VerifyEmailScreen');
  const mailbox = useDevMailbox();
  if (!mailbox.verifyToken || mailbox.email !== email.toLowerCase()) {
    return (
      <PrototypeNotice>
        <p>{t('semLink')}</p>
      </PrototypeNotice>
    );
  }
  return (
    <PrototypeNotice>
      <p>{t('semEnvio')}</p>
      <Link href={withNext(`/verificar-email?token=${encodeURIComponent(mailbox.verifyToken)}`, next)} className={textLink}>
        {t('abrirLink')}
      </Link>
    </PrototypeNotice>
  );
}

function CheckInbox({ next }: { next: string }) {
  const t = useT(messages, 'VerifyEmailScreen');
  const { user, isLoading } = useSession();

  if (isLoading) return <AuthSkeleton />;

  if (!user) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<MailCheck className="size-6" />}
          title={t('confiraTitulo')}
          description={t('confiraSemSessao')}
        />
        <Button asChild fullWidth>
          <Link href={withNext('/entrar', '/verificar-email')}>{t('entrar')}</Link>
        </Button>
      </div>
    );
  }

  if (user.emailVerified) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={t('jaConfirmadoTitulo')} description={t('jaConfirmadoDescricao', { email: user.email })} />
        <Button asChild fullWidth>
          <Link href={next}>{t('continuar')}</Link>
        </Button>
      </div>
    );
  }

  const description = t.rich('confiraDescricao', {
    email: user.email,
    strong: (chunks) => <strong className="text-text [overflow-wrap:anywhere]">{chunks}</strong>,
  });

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        icon={<MailCheck className="size-6" />}
        title={t('confiraTitulo')}
        description={description}
      />
      <DevVerifyLink email={user.email} next={next} />
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{t('naoChegou')}</p>
        <ResendButton email={user.email} />
        <Button asChild variant="ghost" fullWidth>
          <Link href={next}>{t('verificarDepois')}</Link>
        </Button>
      </div>
    </div>
  );
}

function ConfirmToken({ token, next }: { token: string; next: string }) {
  const { user, isLoading: sessionLoading } = useSession();
  const t = useT(messages, 'VerifyEmailScreen');
  const verify = useVerifyEmail();
  const { mutate } = verify;

  // O token é de uso único: em StrictMode o efeito roda duas vezes, e a segunda chamada falharia.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === token) return;
    sent.current = token;
    mutate(token);
  }, [token, mutate]);

  if (verify.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<CircleCheck className="size-6" />}
          title={t('confirmadoTitulo')}
          description={t('confirmadoDescricao', { email: verify.data.email })}
        />
        {sessionLoading ? null : user ? (
          <Button asChild fullWidth>
            <Link href={next}>{t('continuar')}</Link>
          </Button>
        ) : (
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', next)}>{t('entrar')}</Link>
          </Button>
        )}
      </div>
    );
  }

  if (verify.isError) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t('erroTitulo')} />
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          {errorMessage(verify.error)}
        </p>
        {user && !user.emailVerified && (
          <>
            <p className="text-sm text-muted">{t('pecaNovo')}</p>
            <ResendButton
              email={user.email}
              variant="primary"
              afterSent={
                <Link href={withNext('/verificar-email', next)} className={`${textLink} text-center text-sm`}>
                  {t('verNovoLink')}
                </Link>
              }
            />
          </>
        )}
        {user?.emailVerified && (
          <Button asChild fullWidth>
            <Link href={next}>{t('continuar')}</Link>
          </Button>
        )}
        {!sessionLoading && !user && (
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', '/verificar-email')}>{t('entrar')}</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" role="status">
      <h1 className="text-xl">{t('confirmando')}</h1>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
