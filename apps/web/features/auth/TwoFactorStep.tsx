'use client';

import { Button, Input } from '@nova/ui';
import { KeyRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useVerifyTwoFactorLogin } from '@/shared/session/useSession';
import { PrototypeCode, prototypeCodeAvailable } from '@/features/profile/security/PrototypeCode';
import { AuthHeader, FormAlert } from './AuthParts';

const CODE_FIELD = 'codigo-duas-etapas';
const EXPIRED_MESSAGE = 'O tempo para informar o código acabou. Entre de novo com e-mail e senha.';

/**
 * Segundo passo do login (issue #95): o código de 6 dígitos do aplicativo autenticador ou, sem o celular, um
 * código de recuperação (cada um vale uma vez). O passo vale 5 minutos; depois, volta para a senha.
 */
export function TwoFactorStep({ onDone, onRestart }: { onDone: () => void; onRestart: (message: string | null) => void }) {
  const verify = useVerifyTwoFactorLogin();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Quem chega neste passo (ou troca o tipo de código) já está no campo certo.
  useEffect(() => {
    document.getElementById(CODE_FIELD)?.focus();
  }, [recovery]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = recovery ? code.trim() : code.replace(/\s/g, '');
    if (!recovery && !/^\d{6}$/.test(clean)) return setFieldError('O código tem 6 dígitos');
    if (recovery && clean.replace(/[\s-]/g, '').length < 8) return setFieldError('O código de recuperação tem 8 caracteres (ex.: abcd-efgh)');
    setFieldError(null);
    setFormError(null);
    verify.mutate(clean, {
      onSuccess: onDone,
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'INVALID_CODE') setFieldError(recovery ? 'Código de recuperação incorreto ou já usado.' : 'Código incorreto ou vencido. Confira o aplicativo e tente de novo.');
        else if (error instanceof ApiError && error.code === 'TWO_FACTOR_CHALLENGE_EXPIRED') onRestart(EXPIRED_MESSAGE);
        else setFormError(errorMessage(error));
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        icon={<KeyRound className="size-6" />}
        title="Verificação em duas etapas"
        description={recovery ? 'Digite um dos códigos de recuperação que você guardou ao ativar a verificação. Cada código funciona uma única vez.' : 'Abra o aplicativo autenticador no seu celular e digite o código de 6 dígitos da Nova Arena.'}
      />

      <form noValidate className="flex flex-col gap-4" onSubmit={submit} aria-label="Confirmar código">
        {formError && <FormAlert>{formError}</FormAlert>}
        {recovery ? (
          <Input
            id={CODE_FIELD}
            key="recovery"
            label="Código de recuperação"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="abcd-efgh"
            maxLength={20}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={fieldError ?? undefined}
            inputClassName="font-mono"
          />
        ) : (
          <Input
            id={CODE_FIELD}
            key="totp"
            label="Código do aplicativo"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={fieldError ?? undefined}
            inputClassName="tabular font-mono tracking-widest"
          />
        )}
        {!recovery && prototypeCodeAvailable() && <PrototypeCode onUse={setCode} />}
        <Button type="submit" size="lg" fullWidth loading={verify.isPending}>
          Confirmar
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2 text-sm">
        <Button
          variant="ghost"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            setFieldError(null);
          }}
        >
          {recovery ? 'Usar o código do aplicativo' : 'Sem o celular? Usar um código de recuperação'}
        </Button>
        <Button variant="ghost" onClick={() => onRestart(null)} disabled={verify.isPending}>
          Voltar e entrar com outra conta
        </Button>
      </div>
    </div>
  );
}
