'use client';

import { Button, Skeleton, useToast } from '@nova/ui';
import { CircleCheck, CircleX, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useResendVerification, useVerifyEmail } from '@/shared/api/hooks/users';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader, AuthSkeleton, PrototypeNotice, textLink } from './AuthParts';
import { useDevMailbox } from './devMailbox';
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
              success('E-mail reenviado', `Mandamos um novo link para ${email}.`);
            },
            onError: (e) => error('Não foi possível reenviar', errorMessage(e)),
          })
        }
      >
        Reenviar e-mail
      </Button>
      {resend.isSuccess && afterSent}
    </>
  );
}

/** O link de verificação do protótipo, quando há um para a conta logada. */
function DevVerifyLink({ email, next }: { email: string; next: string }) {
  const mailbox = useDevMailbox();
  if (!mailbox.verifyToken || mailbox.email !== email.toLowerCase()) {
    return (
      <PrototypeNotice>
        <p>Nenhum e-mail é enviado de verdade. Toque em “Reenviar e-mail” para gerar o link de verificação aqui na tela.</p>
      </PrototypeNotice>
    );
  }
  return (
    <PrototypeNotice>
      <p>Nenhum e-mail é enviado de verdade. Este é o link que chegaria na sua caixa de entrada:</p>
      <Link href={withNext(`/verificar-email?token=${encodeURIComponent(mailbox.verifyToken)}`, next)} className={textLink}>
        Abrir link de verificação
      </Link>
    </PrototypeNotice>
  );
}

function CheckInbox({ next }: { next: string }) {
  const { user, isLoading } = useSession();

  if (isLoading) return <AuthSkeleton />;

  if (!user) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<MailCheck className="size-6" />}
          title="Confira seu e-mail"
          description="Abra o link que mandamos para o e-mail do seu cadastro. Para pedir um link novo, entre na sua conta."
        />
        <Button asChild fullWidth>
          <Link href={withNext('/entrar', '/verificar-email')}>Entrar</Link>
        </Button>
      </div>
    );
  }

  if (user.emailVerified) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title="Seu e-mail já está confirmado" description={`O e-mail ${user.email} já foi verificado. Não precisa fazer mais nada.`} />
        <Button asChild fullWidth>
          <Link href={next}>Continuar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        icon={<MailCheck className="size-6" />}
        title="Confira seu e-mail"
        description={
          <>
            Mandamos um link de verificação para <strong className="text-text [overflow-wrap:anywhere]">{user.email}</strong>. Abra o link para confirmar que o e-mail é seu.
          </>
        }
      />
      <DevVerifyLink email={user.email} next={next} />
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Não chegou? Olhe a caixa de spam ou peça um link novo.</p>
        <ResendButton email={user.email} />
        <Button asChild variant="ghost" fullWidth>
          <Link href={next}>Verificar depois</Link>
        </Button>
      </div>
    </div>
  );
}

function ConfirmToken({ token, next }: { token: string; next: string }) {
  const { user, isLoading: sessionLoading } = useSession();
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
          title="E-mail confirmado"
          description={`Pronto! O e-mail ${verify.data.email} está verificado e sua conta está liberada para inscrições e convites.`}
        />
        {sessionLoading ? null : user ? (
          <Button asChild fullWidth>
            <Link href={next}>Continuar</Link>
          </Button>
        ) : (
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', next)}>Entrar</Link>
          </Button>
        )}
      </div>
    );
  }

  if (verify.isError) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title="Não foi possível confirmar seu e-mail" />
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          {errorMessage(verify.error)}
        </p>
        {user && !user.emailVerified && (
          <>
            <p className="text-sm text-muted">Peça um link novo: o anterior deixa de valer.</p>
            <ResendButton
              email={user.email}
              variant="primary"
              afterSent={
                <Link href={withNext('/verificar-email', next)} className={`${textLink} text-center text-sm`}>
                  Ver o novo link
                </Link>
              }
            />
          </>
        )}
        {user?.emailVerified && (
          <Button asChild fullWidth>
            <Link href={next}>Continuar</Link>
          </Button>
        )}
        {!sessionLoading && !user && (
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', '/verificar-email')}>Entrar</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" role="status">
      <h1 className="text-xl">Confirmando seu e-mail…</h1>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
