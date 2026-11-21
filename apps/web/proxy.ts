/**
 * Borda (Next.js `proxy.ts`). Duas tarefas:
 *
 * 1. **CSP com nonce (issue #113):** cada página ganha um nonce novo, posto no header `Content-Security-Policy` da
 *    resposta e repassado ao Next (`x-nonce` + CSP na requisição), que o aplica aos próprios scripts. O layout raiz lê
 *    o `x-nonce` para o script inline do tema. Os headers fixos (HSTS, nosniff…) vêm do `next.config.ts`.
 * 2. **Áreas restritas (issue #70):** com a API real, valida o JWT de acesso e redireciona quem não pode abrir
 *    `/admin` ou `/organizador` antes de a página carregar. É só conveniência: **a checagem que vale é a da API**.
 *    - Sem token válido → `/entrar?next=…` (se a sessão só venceu, a tela de entrar renova e volta sozinha).
 *    - Token sem o papel da área → página inicial.
 *    - `/admin` sem o 2FA feito nesta sessão (`tfa` no token) → `/minha-conta/seguranca`.
 *    - Com a API simulada (protótipo) a sessão vive no navegador: a borda não tem o que conferir e deixa passar.
 */
import { ACCESS_COOKIE, edgeRedirect, readAccessClaims } from '@nova/api/edge';
import { NextResponse, type NextRequest } from 'next/server';
import { isModuleMocked } from '@/shared/api/mode';
import { contentSecurityPolicy, createNonce } from '@/shared/security/headers';

const RESTRICTED = /^\/(admin|organizador)(\/|$)/;

async function areaRedirect(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (!RESTRICTED.test(pathname)) return null;
  const secret = process.env.AUTH_JWT_SECRET;
  if (isModuleMocked('auth') || !secret) return null;

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await readAccessClaims(secret, token) : null;
  const decision = edgeRedirect(pathname, claims);
  if (decision === 'login') {
    const target = new URL('/entrar', request.url);
    target.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(target);
  }
  if (decision === 'forbidden') return NextResponse.redirect(new URL('/', request.url));
  // Admin sem a verificação em duas etapas feita nesta sessão (issue #95): configurar ou entrar de novo com o código.
  if (decision === 'two-factor') return NextResponse.redirect(new URL('/minha-conta/seguranca', request.url));
  return null;
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === 'development', https: request.nextUrl.protocol === 'https:' });

  const redirect = await areaRedirect(request);
  if (redirect) {
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Páginas: tudo menos a API, os arquivos do build, a imagem otimizada, os scripts da Vercel e arquivos estáticos.
      source: '/((?!api/|_next/static|_next/image|_vercel|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|mockServiceWorker.js|sw.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml|js|css|map|woff2?)$).*)',
      // Pré-carregamento do `next/link` não é documento: não precisa de nonce.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
