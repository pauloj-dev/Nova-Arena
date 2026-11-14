/**
 * Provedores de login social (issue #68) com `arctic`: autorização com `state` e PKCE, troca do código e
 * leitura do perfil. A fábrica é injetável (testes usam um provedor falso).
 */
import type { OAuthProviderName } from '@nova/schemas';
import { decodeIdToken, Discord, Google } from 'arctic';
import type { Env } from '../env';

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  /** O provedor garante que a pessoa é dona do e-mail. Sem isso, nunca assumimos uma conta existente. */
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

export interface OAuthClient {
  authorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<OAuthProfile>;
}

/** `null` quando o provedor não está configurado neste ambiente. */
export type OAuthFactory = (env: Env, provider: OAuthProviderName, redirectUri: string) => OAuthClient | null;

interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
  avatar?: string | null;
}

export const arcticFactory: OAuthFactory = (env, provider, redirectUri) => {
  if (provider === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    const google = new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
    return {
      authorizationUrl: (state, verifier) => google.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']),
      async exchange(code, verifier) {
        const tokens = await google.validateAuthorizationCode(code, verifier);
        const claims = decodeIdToken(tokens.idToken()) as GoogleClaims;
        return { providerAccountId: claims.sub, email: claims.email ?? null, emailVerified: claims.email_verified === true, name: claims.name ?? '', avatarUrl: claims.picture ?? null };
      },
    };
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return null;
  const discord = new Discord(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, redirectUri);
  return {
    authorizationUrl: (state, verifier) => discord.createAuthorizationURL(state, verifier, ['identify', 'email']),
    async exchange(code, verifier) {
      const tokens = await discord.validateAuthorizationCode(code, verifier);
      const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokens.accessToken()}` } });
      if (!res.ok) throw new Error(`Discord respondeu HTTP ${res.status}`);
      const u = (await res.json()) as DiscordUser;
      return {
        providerAccountId: u.id,
        email: u.email ?? null,
        emailVerified: u.verified === true,
        name: u.global_name || u.username,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256` : null,
      };
    },
  };
};

/** Apelido válido (3–20 caracteres: letras, números, ponto, hífen e sublinhado) a partir do nome. */
export function nicknameBase(name: string, email: string | null): string {
  const source = name.trim() || email?.split('@')[0] || 'jogador';
  const cleaned = source
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 16);
  return cleaned.length >= 3 ? cleaned : `jogador${cleaned}`.slice(0, 16);
}
