/**
 * Imagem enviada pelos usuários (banner, logo, capa). Quando vem do Vercel Blob público (`images.remotePatterns`
 * no `next.config.ts`), passa pelo `next/image`: AVIF/WebP, `srcset` por largura e cache na borda (#111).
 * Outras origens (data URL da API simulada, prévia local de arquivo, endereço antigo) caem num `<img>` comum:
 * o otimizador recusaria e a imagem sumiria.
 */
import Image from 'next/image';

const BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/;

/** O otimizador do Next aceita esta URL? (Só HTTPS no Blob público.) */
export function isOptimizableImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && BLOB_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

interface BlobImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Larguras ocupadas na tela (para o `srcset`). Ex.: `(min-width: 1024px) 960px, 100vw`. */
  sizes: string;
  /** Imagem do topo da página (candidata a LCP): carrega antes das outras. */
  priority?: boolean;
}

/** Preenche o contêiner (que precisa de `position: relative` e tamanho definido). */
export function BlobImage({ src, alt, className, sizes, priority = false }: BlobImageProps) {
  if (isOptimizableImage(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} className={className} {...(priority ? { fetchPriority: 'high' as const, loading: 'eager' as const } : {})} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- origem fora do Blob (ver comentário do arquivo)
  return <img src={src} alt={alt} className={`absolute inset-0 size-full ${className ?? ''}`} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })} />;
}
