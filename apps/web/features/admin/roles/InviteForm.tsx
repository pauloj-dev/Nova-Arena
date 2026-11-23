'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateRoleInviteInput, type RoleInvite } from '@nova/schemas';
import { Button, Input, Select } from '@nova/ui';
import { Check, Copy, Link2, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { adminRolesMessages } from './messages';

type FormValues = z.input<typeof CreateRoleInviteInput>;
type Delivery = 'link' | 'email';

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
  const t = useT(adminRolesMessages, 'InviteForm');
  const roleOptions = [
    { value: 'ADMIN', label: t('papelAdmin') },
    { value: 'ORGANIZER', label: t('papelOrganizador') },
  ];
  const validityOptions = [
    { value: '1h', label: t('umaHora') },
    { value: '24h', label: t('vinteQuatroHoras') },
    { value: '7d', label: t('seteDias') },
  ];
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
      setError('email', { message: t('informeEmail') }, { shouldFocus: true });
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
      setSubmitError(t('erroCopiar'));
    }
  }

  const deliveryOptions = [
    { value: 'link', label: t('link'), hint: t('linkDica'), icon: Link2 },
    { value: 'email', label: t('email'), hint: t('emailDica'), icon: Mail },
  ] as const;
  // Fora do JSX: a verificação de texto fixo confunde o nome do campo com texto de interface.
  const registerRole = () => register('role');
  const registerValidity = () => register('validity');
  const registerMaxUses = () => register('maxUses', { valueAsNumber: true });
  const registerEmail = () => register('email');

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(event) => void handleSubmit(submit)(event)} className="flex flex-col gap-4" noValidate aria-label={t('novoConvite')}>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">{t('comoConvidar')}</legend>
          <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
            {deliveryOptions.map((option) => (
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
          <Select label={t('papel')} options={roleOptions} error={formState.errors.role?.message} {...registerRole()} />
          <Select label={t('validade')} options={validityOptions} hint={t('validadeDica')} error={formState.errors.validity?.message} {...registerValidity()} />
          {delivery === 'link' ? (
            // `key`: sem ela o React reaproveita o mesmo <input> ao trocar de modo e o "1" dos usos vira o e-mail.
            <Input key="maxUses" label={t('limiteUsos')} type="number" inputMode="numeric" min={1} max={10} hint={t('limiteUsosDica')} error={formState.errors.maxUses?.message} {...registerMaxUses()} />
          ) : (
            <Input
              key="email"
              label={t('emailConvidado')}
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              error={formState.errors.email?.message}
              {...registerEmail()}
            />
          )}
        </div>

        {role === 'ADMIN' && <p className="text-sm text-muted">{t('avisoAdmin')}</p>}
        {submitError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            {submitError}
          </p>
        )}
        <Button type="submit" loading={formState.isSubmitting} className="self-start">
          {t('gerar')}
        </Button>
      </form>

      {created?.link && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft p-3 text-accent-soft-text" data-testid="invite-created">
          <p className="text-sm font-semibold">{t('criado')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1.5 font-mono text-xs text-text [overflow-wrap:anywhere]" data-testid="invite-link">
              {created.link}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copy(created.link ?? '')} iconLeft={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
              {copied ? t('copiado') : t('copiarLink')}
            </Button>
          </div>
          <p className="text-xs">
            {created.email ? t('soEmail', { email: created.email }) : t('valePara', { n: String(created.maxUses), count: created.maxUses })}
            {t('expiraEm', { data: formatDateTime(created.expiresAt) })}
            {created.email && t('prototipo')}
          </p>
        </div>
      )}
    </div>
  );
}
