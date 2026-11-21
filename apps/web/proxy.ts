/**
 * Borda (issue #70): com a API real, valida o JWT de acesso e redireciona quem não pode abrir `/admin` ou
 * `/organizador` antes de a página carregar. É só conveniência: **a checagem que vale é a da API**.
 *
 * - Sem token válido → `/entrar?next=…` (se a sessão só venceu, a tela de entrar renova e volta sozinha).
 * - Token sem o papel da área → segue para a página, que mostra o "Erro 403" (como no protótipo; a API recusa os dados).
 * - `/admin` sem o 2FA feito nesta sessão (`tfa` no token) → `/minha-conta/seguranca`.
 * - Com a API simulada (protótipo) a sessão vive no navegador: a borda não tem o que conferir e deixa passar.
 */
import { ACCESS_COOKIE, edgeRedirect, readAccessClaims } from '@nova/api/edge';
import { NextResponse, type NextRequest } from 'next/server';
import { isModuleMocked } from '@/shared/api/mode';

export async function proxy(request: NextRequest) {
  const secret = process.env.AUTH_JWT_SECRET;
  if (isModuleMocked('auth') || !secret) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await readAccessClaims(secret, token) : null;
  const { pathname, search } = request.nextUrl;
  const decision = edgeRedirect(pathname, claims);
  if (decision === 'login') {
    const target = new URL('/entrar', request.url);
    target.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(target);
  }
  // Sem o papel da área: a própria página mostra "Você não tem acesso a esta área" (Erro 403), sem dado nenhum.
  if (decision === 'forbidden') return NextResponse.next();
  // Admin sem a verificação em duas etapas feita nesta sessão (issue #95): configurar ou entrar de novo com o código.
  if (decision === 'two-factor') return NextResponse.redirect(new URL('/minha-conta/seguranca', request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/organizador', '/organizador/:path*'],
};
