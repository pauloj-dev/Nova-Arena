'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateRoleInviteInput, type RoleInvite } from '@nova/schemas';
import { Button, Input, Select } from '@nova/ui';
import { Check, Copy, Link2, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { formatDateTime } from '@/shared/lib/datetime';

type FormValues = z.input<typeof CreateRoleInviteInput>;
type Delivery = 'link' | 'email';

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'ORGANIZER', label: 'Organizador' },
];
const VALIDITY_OPTIONS = [
  { value: '1h', label: '1 hora' },
  { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 dias' },
];

const baseResolver = zodResolver(CreateRoleInviteInput);

interface InviteFormProps {
  /** Cria o convite e devolve o registro com o `link` (só vem nesta resposta). */
  onCreate: (input: CreateRoleInviteInput) => Promise<RoleInvite>;
  defaultRole?: 'ADMIN' | 'ORGANIZER';
}

/**
 * Formulário de convite (US-ADM-02): papel, por link ou por e-mail, validade (1 h, 24 h, 7 dias)
 * e limite de usos (1 a 10). Depois de criar, mostra o link completo uma única vez, com botão de copiar.
 */
export function InviteForm({ onCreate, defaultRole = 'ADMIN' }: InviteFormProps) {
  const [delivery, setDelivery] = useState<Delivery>('link');
  const [created, setCreated] = useState<RoleInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState, reset, setError } = useForm<FormValues>({
    // Campo de e-mail vazio chega como texto vazio: para o contrato, isso é "sem e-mail".
    resolver: (values, context, options) => baseResolver({ ...values, email: values.email?.trim() ? values.email.trim() : undefined }, context, options),
    defaultValues: { role: defaultRole, validity: '24h', maxUses: 1, email: undefined },
  });
  const role = useWatch({ control, name: 'role' });

  async function submit(values: FormValues) {
    setSubmitError(null);
    setCopied(false);
    // No contrato o e-mail é opcional (convite por link); neste modo ele é o próprio convite.
    if (delivery === 'email' && !values.email) {
      setError('email', { message: 'Informe o e-mail do convidado' }, { shouldFocus: true });
      return;
    }
    try {
      const input = CreateRoleInviteInput.parse(values);
      // Convite por e-mail vale para uma pessoa só.
      const invite = await onCreate(delivery === 'email' ? { ...input, maxUses: 1 } : { ...input, email: undefined });
      setCreated(invite);
      reset({ role: values.role, validity: values.validity, maxUses: 1, email: undefined });
    } catch (error) {
      setSubmitError(errorMessage(error));
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setSubmitError('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(event) => void handleSubmit(submit)(event)} className="flex flex-col gap-4" noValidate aria-label="Novo convite">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Como convidar</legend>
          <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
            {(
              [
                { value: 'link', label: 'Link compartilhável', hint: 'Mande por WhatsApp ou Discord.', icon: Link2 },
                { value: 'email', label: 'Por e-mail', hint: 'Só aquele e-mail consegue aceitar.', icon: Mail },
              ] as const
            ).map((option) => (
              <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border-strong px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="delivery" value={option.value} checked={delivery === option.value} onChange={() => setDelivery(option.value)} className="mt-1 size-4 accent-(--accent)" />
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <option.icon className="size-4" aria-hidden />
                    {option.label}
                  </span>
                  <span className="text-xs text-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select label="Papel" options={ROLE_OPTIONS} error={formState.errors.role?.message} {...register('role')} />
          <Select label="Validade" options={VALIDITY_OPTIONS} hint="Depois disso o link para de funcionar." error={formState.errors.validity?.message} {...register('validity')} />
          {delivery === 'link' ? (
            // `key`: sem ela o React reaproveita o mesmo <input> ao trocar de modo e o "1" dos usos vira o e-mail.
            <Input key="maxUses" label="Limite de usos" type="number" inputMode="numeric" min={1} max={10} hint="De 1 a 10 pessoas." error={formState.errors.maxUses?.message} {...register('maxUses', { valueAsNumber: true })} />
          ) : (
            <Input
              key="email"
              label="E-mail do convidado"
              type="email"
              autoComplete="off"
              placeholder="pessoa@exemplo.com"
              error={formState.errors.email?.message}
              {...register('email')}
            />
          )}
        </div>

        {role === 'ADMIN' && <p className="text-sm text-muted">Quem aceitar vira administrador e precisa ativar a verificação em duas etapas antes de entrar no painel.</p>}
        {submitError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            {submitError}
          </p>
        )}
        <Button type="submit" loading={formState.isSubmitting} className="self-start">
          Gerar convite
        </Button>
      </form>

      {created?.link && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft p-3 text-accent-soft-text" data-testid="invite-created">
          <p className="text-sm font-semibold">Convite criado. Copie o link agora: ele não aparece de novo.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1.5 font-mono text-xs text-text [overflow-wrap:anywhere]" data-testid="invite-link">
              {created.link}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copy(created.link ?? '')} iconLeft={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
              {copied ? 'Copiado' : 'Copiar link'}
            </Button>
          </div>
          <p className="text-xs">
            {created.email ? `Só ${created.email} consegue aceitar. ` : `Vale para ${created.maxUses} ${created.maxUses === 1 ? 'pessoa' : 'pessoas'}. `}
            Expira em {formatDateTime(created.expiresAt)}.
            {created.email && ' No protótipo o e-mail não é enviado: mande o link você mesmo.'}
          </p>
        </div>
      )}
    </div>
  );
}
