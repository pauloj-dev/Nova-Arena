/** `robots.txt` (issue #77): páginas públicas liberadas; áreas logadas e a API fora da indexação. */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/shared/server/seo';

export default function robots(): MetadataRoute.Robots {
  // Preview e desenvolvimento não entram no Google.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/organizador', '/minha-conta', '/notificacoes', '/disputas', '/entrar', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/verificar-email', '/confirmar-email', '/convite/', '/equipe/convite/', '/sem-conexao'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
