// @vitest-environment node
/**
 * `sanitizeRichText` no servidor (sem DOM): cai no sanitizador de lista fechada de `@nova/schemas` e o texto vem no
 * HTML da página (#111). Mesmas garantias do navegador, e a mesma saída nos casos comuns (sem divergência na hidratação).
 */
import { describe, expect, it } from 'vitest';
import { richTextToPlain, sanitizeRichText } from './sanitize';

describe('sanitizeRichText no servidor', () => {
  it('não depende do DOM', () => {
    expect(typeof window).toBe('undefined');
  });
  it('remove script, manipuladores de evento e iframes', () => {
    const out = sanitizeRichText('<p onclick="alert(1)">Oi</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe>');
    expect(out).toBe('<p>Oi</p>');
  });
  it('recusa javascript: e abre links em nova aba com rel seguro', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a><a href="https://exemplo.com">ok</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="https://exemplo.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });
  it('mantém a formatação permitida, igual ao navegador', () => {
    const html = '<h2>Termos de Uso</h2><p>A <strong>Nova Arena</strong> é uma plataforma.</p><h3>Regras</h3><ul><li><em>Sem hack</em></li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });
  it('remove style e class', () => {
    expect(sanitizeRichText('<p style="position:fixed" class="x">a</p>')).toBe('<p>a</p>');
  });
});

describe('richTextToPlain no servidor', () => {
  it('devolve o texto, igual ao navegador (a página decide "tem descrição?" com ele)', () => {
    expect(richTextToPlain('<p>A <strong>Nova&nbsp;Arena</strong> &amp; amigos</p><ul><li>Regra</li></ul>')).toBe('A Nova Arena & amigos Regra');
  });
  it('HTML sem texto continua vazio', () => {
    expect(richTextToPlain('<p><br></p><p> </p>')).toBe('');
  });
  it('não devolve o conteúdo de script', () => {
    expect(richTextToPlain('<script>alert(1)</script><p>ok</p>')).toBe('ok');
  });
});
