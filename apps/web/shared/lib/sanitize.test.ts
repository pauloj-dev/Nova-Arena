import { describe, expect, it } from 'vitest';
import { richTextToPlain, sanitizeRichText, streamEmbed } from './sanitize';

describe('sanitizeRichText', () => {
  it('remove script, manipuladores de evento e iframes', () => {
    const out = sanitizeRichText('<p onclick="alert(1)">Oi</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe>');
    expect(out).toBe('<p>Oi</p>');
  });
  it('recusa links javascript: e mantém https com rel seguro', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a><a href="https://exemplo.com">ok</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="https://exemplo.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });
  it('mantém a formatação permitida', () => {
    const html = '<h3>Regras</h3><ul><li><strong>Sem hack</strong></li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });
  it('remove style e class', () => {
    expect(sanitizeRichText('<p style="position:fixed" class="x">a</p>')).toBe('<p>a</p>');
  });
  it('extrai texto puro', () => {
    expect(richTextToPlain('<p>Copa <strong>Nova</strong></p><script>x</script>')).toBe('Copa Nova');
  });
});

describe('streamEmbed', () => {
  it('aceita YouTube e Twitch', () => {
    expect(streamEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'localhost')?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(streamEmbed('https://youtu.be/dQw4w9WgXcQ', 'localhost')?.provider).toBe('youtube');
    expect(streamEmbed('https://www.twitch.tv/novaarena', 'novaarena.gg')?.embedUrl).toBe('https://player.twitch.tv/?channel=novaarena&parent=novaarena.gg&autoplay=false');
  });
  it('recusa outros domínios, http e links malformados', () => {
    expect(streamEmbed('https://evil.test/watch?v=dQw4w9WgXcQ', 'localhost')).toBeNull();
    expect(streamEmbed('http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'localhost')).toBeNull();
    expect(streamEmbed('https://youtube.com.evil.test/watch?v=abc', 'localhost')).toBeNull();
    expect(streamEmbed('não é link', 'localhost')).toBeNull();
    expect(streamEmbed('https://www.youtube.com/watch?v="><script>', 'localhost')).toBeNull();
  });
});
