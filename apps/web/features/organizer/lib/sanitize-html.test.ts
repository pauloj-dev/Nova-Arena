import { describe, expect, it } from 'vitest';
import { safeHref, sanitizeHtmlAllowlist, sanitizeTournamentHtml } from './sanitize-html';

describe('sanitizeHtmlAllowlist (limpeza feita pela API antes de gravar)', () => {
  it('mantém a formatação permitida', () => {
    const html = '<h2>Regras</h2><p>Texto <strong>forte</strong>, <em>itálico</em> e <u>sublinhado</u>.</p><ul><li>Um</li><li>Dois</li></ul><ol><li>A</li></ol><blockquote>Citação</blockquote><hr><p>Linha<br>nova</p>';
    expect(sanitizeHtmlAllowlist(html)).toBe(html);
  });

  it('remove script, style e iframe com o conteúdo', () => {
    expect(sanitizeHtmlAllowlist('<p>Oi</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><p>Tchau</p>')).toBe('<p>Oi</p><p>Tchau</p>');
    expect(sanitizeHtmlAllowlist('<p>Oi</p><SCRIPT>alert(1)')).toBe('<p>Oi</p>');
    expect(sanitizeHtmlAllowlist('<svg onload="alert(1)"><circle/></svg>ok')).toBe('ok');
  });

  it('remove todos os atributos, inclusive manipuladores de evento', () => {
    expect(sanitizeHtmlAllowlist('<p onclick="alert(1)" style="color:red" class="x">Oi</p>')).toBe('<p>Oi</p>');
    expect(sanitizeHtmlAllowlist('<b onmouseover=alert(1)>x</b>')).toBe('<b>x</b>');
  });

  it('tira tags fora da lista e mantém o texto', () => {
    expect(sanitizeHtmlAllowlist('<div><span>Olá</span> <img src=x onerror=alert(1)> <h1>Título</h1></div>')).toBe('Olá  Título');
    expect(sanitizeHtmlAllowlist('<table><tr><td>célula</td></tr></table>')).toBe('célula');
  });

  it('links: só http, https e mailto, sempre em nova aba e sem acesso à página de origem', () => {
    expect(sanitizeHtmlAllowlist('<a href="https://novaarena.gg/regras" onclick="x()">Regras</a>')).toBe(
      '<a href="https://novaarena.gg/regras" target="_blank" rel="noopener noreferrer nofollow">Regras</a>',
    );
    expect(sanitizeHtmlAllowlist("<a href='mailto:oi@novaarena.gg'>E-mail</a>")).toContain('href="mailto:oi@novaarena.gg"');
    expect(sanitizeHtmlAllowlist('<a href="javascript:alert(1)">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a href="JaVaScRiPt:alert(1)">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a href="java&#115;cript:alert(1)">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a href=" java\tscript:alert(1)">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a href="data:text/html,<script>alert(1)</script>">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a href="/relativo">clique</a>')).toBe('clique');
    expect(sanitizeHtmlAllowlist('<a>sem destino</a>')).toBe('sem destino');
  });

  it('escapa aspas no href para não abrir outro atributo', () => {
    const out = sanitizeHtmlAllowlist(`<a href='https://x.com/?q="onmouseover="alert(1)'>x</a>`);
    expect(out).toBe('<a href="https://x.com/?q=&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer nofollow">x</a>');
  });

  it('não deixa uma tag se formar a partir de pedaços', () => {
    expect(sanitizeHtmlAllowlist('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toMatch(/<script/i);
    expect(sanitizeHtmlAllowlist('<<script>script>alert(1)</script>')).not.toMatch(/<script/i);
    expect(sanitizeHtmlAllowlist('a < b e c > d')).toBe('a &lt; b e c &gt; d');
    expect(sanitizeHtmlAllowlist('<p>incompleta <b')).toBe('<p>incompleta &lt;b</p>');
  });

  it('remove comentários e fecha o que ficou aberto', () => {
    expect(sanitizeHtmlAllowlist('<p>a<!-- <script>alert(1)</script> -->b</p>')).toBe('<p>ab</p>');
    expect(sanitizeHtmlAllowlist('<ul><li>um<li>dois')).toBe('<ul><li>um<li>dois</li></li></ul>');
    expect(sanitizeHtmlAllowlist('texto</p></div>')).toBe('texto');
  });

  it('texto que já veio escapado continua sendo texto', () => {
    expect(sanitizeHtmlAllowlist('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; cia</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; cia</p>');
  });

  it('aceita vazio e valores estranhos sem lançar', () => {
    expect(sanitizeHtmlAllowlist('')).toBe('');
    expect(sanitizeHtmlAllowlist(undefined as unknown as string)).toBe('');
  });
});

describe('safeHref', () => {
  it('devolve o endereço limpo ou nulo', () => {
    expect(safeHref('https://www.twitch.tv/novaarena')).toBe('https://www.twitch.tv/novaarena');
    expect(safeHref('HTTP://exemplo.com')).toBe('HTTP://exemplo.com');
    expect(safeHref('&#x6A;avascript:alert(1)')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
    expect(safeHref('//exemplo.com')).toBeNull();
  });
});

describe('sanitizeTournamentHtml (o que o handler grava)', () => {
  it('limpa descrição, regulamento e premiação e não toca no resto', () => {
    const input = {
      name: '<b>Copa</b>',
      description: '<p>Oi<script>alert(1)</script></p>',
      rules: '<p onclick="x()">Regra</p>',
      prize: 'R$ 100 <img src=x onerror=alert(1)>',
      maxParticipants: 16,
    };
    expect(sanitizeTournamentHtml(input)).toEqual({ name: '<b>Copa</b>', description: '<p>Oi</p>', rules: '<p>Regra</p>', prize: 'R$ 100 ', maxParticipants: 16 });
  });

  it('campo ausente continua ausente (o rascunho é parcial)', () => {
    expect(sanitizeTournamentHtml({ rules: '<p>x</p>' })).toEqual({ rules: '<p>x</p>' });
  });
});
