import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlobImage, isOptimizableImage } from './blob-image';

describe('isOptimizableImage', () => {
  it('aceita só HTTPS no Vercel Blob público', () => {
    expect(isOptimizableImage('https://abc123.public.blob.vercel-storage.com/banners/x.webp')).toBe(true);
    expect(isOptimizableImage('http://abc123.public.blob.vercel-storage.com/x.webp')).toBe(false);
    expect(isOptimizableImage('https://public.blob.vercel-storage.com.evil.com/x.webp')).toBe(false);
    expect(isOptimizableImage('data:image/png;base64,AAAA')).toBe(false);
    expect(isOptimizableImage('/api/v1/files/123')).toBe(false);
  });
});

describe('BlobImage', () => {
  it('fora do Blob vira um <img> comum, preguiçoso quando não é o topo da página', () => {
    render(<BlobImage src="data:image/png;base64,AAAA" alt="Prévia" sizes="100vw" />);
    const img = screen.getByRole('img', { name: 'Prévia' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('no Blob passa pelo otimizador do Next (srcset)', () => {
    render(<BlobImage src="https://abc.public.blob.vercel-storage.com/b.webp" alt="Banner" sizes="100vw" priority />);
    const img = screen.getByRole('img', { name: 'Banner' });
    expect(img.getAttribute('src')).toContain('/_next/image');
    expect(img.getAttribute('srcset')).toContain('w=');
  });
});
