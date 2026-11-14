/**
 * Cookies da sessão. `httpOnly` (o JavaScript da página não lê), `SameSite=Lax` (protege contra CSRF
 * junto com a checagem de `Origin`) e `Secure` sempre que a requisição é HTTPS. O refresh token só é
 * enviado para a rota de refresh (e de logout): nas demais requisições ele nem sai do navegador.
 */
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../context';
import { ACCESS_TTL_SECONDS } from './jwt';

export const ACCESS_COOKIE = 'na_at';
export const REFRESH_COOKIE = 'na_rt';
export const REFRESH_PATH = '/api/v1/auth';
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

const secure = (c: AppContext) => new URL(c.req.url).protocol === 'https:';

export function setSessionCookies(c: AppContext, accessToken: string, refreshToken: string): void {
  setCookie(c, ACCESS_COOKIE, accessToken, { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: '/', maxAge: ACCESS_TTL_SECONDS });
  setCookie(c, REFRESH_COOKIE, refreshToken, { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: REFRESH_PATH, maxAge: REFRESH_TTL_SECONDS });
}

export function clearSessionCookies(c: AppContext): void {
  deleteCookie(c, ACCESS_COOKIE, { path: '/', secure: secure(c) });
  deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_PATH, secure: secure(c) });
}

export const accessCookie = (c: AppContext) => getCookie(c, ACCESS_COOKIE);
export const refreshCookie = (c: AppContext) => getCookie(c, REFRESH_COOKIE);
