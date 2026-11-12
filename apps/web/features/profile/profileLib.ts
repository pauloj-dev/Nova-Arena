/**
 * Lógica pura das telas de conta e perfil: opções de fuso horário, validação dos IDs de jogo
 * e links de redes sociais.
 */
import type { AccountField } from '@nova/schemas';
import { z } from 'zod';
import { timeZoneLabel } from '@/shared/lib/datetime';

// ── Fuso horário ─────────────────────────────────────────────────────
/** Fusos oferecidos sempre: os do Brasil, Lisboa e UTC. */
export const BASE_TIME_ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'UTC'] as const;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cityOf(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}

/**
 * Opções do seletor de fuso. `extra` são fusos que precisam aparecer mesmo fora da lista fixa
 * (o do navegador e o que já está salvo na conta).
 */
export function timeZoneOptions(extra: Array<string | null | undefined> = [], at: Date = new Date()): Array<{ value: string; label: string }> {
  const options = BASE_TIME_ZONES.map((tz) => ({ value: tz as string, label: capitalize(timeZoneLabel(tz, at)) }));
  for (const tz of extra) {
    if (!tz || options.some((o) => o.value === tz)) continue;
    // Fora da lista fixa, o nome do fuso pode repetir (ex.: Fortaleza também é horário de Brasília): a cidade desfaz a dúvida.
    options.push({ value: tz, label: `${cityOf(tz)} — ${timeZoneLabel(tz, at)}` });
  }
  return options;
}

// ── IDs de jogo ──────────────────────────────────────────────────────
function patternOf(field: AccountField): RegExp | null {
  if (!field.pattern) return null;
  try {
    return new RegExp(field.pattern);
  } catch {
    // Padrão mal cadastrado no jogo não pode travar o formulário: a API confere de novo.
    return null;
  }
}

/**
 * Schema do formulário de ID de um jogo, montado a partir dos campos que o jogo exige.
 * O resultado tem o formato de `UpsertGameAccountInput` (`{ fields: { chave: valor } }`).
 */
export function gameAccountSchema(fields: AccountField[]) {
  const shape: Record<string, z.ZodType<string, string>> = {};
  for (const field of fields) {
    const pattern = patternOf(field);
    const base = z.string().trim().min(1, 'Preencha este campo');
    shape[field.key] = pattern ? base.regex(pattern, `Confira o formato de "${field.label}"`) : base;
  }
  return z.object({ fields: z.object(shape) });
}

/** Valores iniciais do formulário: o que já está salvo, ou vazio para cada campo exigido. */
export function gameAccountDefaults(fields: AccountField[], saved: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, saved?.[f.key] ?? '']));
}

// ── Redes sociais ────────────────────────────────────────────────────
/** Só vira link o que for uma URL `https://` válida. Qualquer outra coisa é mostrada como texto. */
export function socialHref(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export const SOCIAL_NETWORKS = [
  { key: 'discord', label: 'Discord', placeholder: 'Seu usuário ou link do servidor' },
  { key: 'instagram', label: 'Instagram', placeholder: '@seuperfil' },
  { key: 'youtube', label: 'YouTube', placeholder: 'Link do canal' },
  { key: 'twitch', label: 'Twitch', placeholder: 'Seu canal' },
] as const;
export type SocialKey = (typeof SOCIAL_NETWORKS)[number]['key'];

/** "MG, Brasil" — ou nulo se a pessoa não informou nada. */
export function locationLabel(state: string | null, country: string | null): string | null {
  const parts = [state, country].map((p) => p?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
