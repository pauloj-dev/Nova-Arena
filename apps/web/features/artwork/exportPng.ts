/**
 * Exporta um elemento da tela como PNG, sem biblioteca: o HTML da arte (só estilos em linha) vai
 * para dentro de um `<foreignObject>` de SVG, o SVG vira imagem e a imagem é desenhada em um canvas.
 * As fontes do site são embutidas no SVG quando dá (o SVG como imagem não enxerga as fontes da página).
 */

const MAX_FONTS = 8;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler a fonte'));
    reader.readAsDataURL(blob);
  });
}

/** Primeira família de uma lista CSS, sem aspas e em minúsculas. */
function families(list: string): string[] {
  return list
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * `@font-face` das famílias usadas na arte, com o arquivo embutido (data URL). Só as faixas latinas
 * básicas, para não baixar dezenas de arquivos. Qualquer falha devolve vazio: a arte sai com a
 * fonte do sistema.
 */
export async function embeddedFontCss(node: HTMLElement): Promise<string> {
  try {
    const wanted = new Set<string>();
    for (const el of [node, ...node.querySelectorAll<HTMLElement>('*')]) for (const f of families(getComputedStyle(el).fontFamily)) wanted.add(f);
    const rules: CSSFontFaceRule[] = [];
    for (const sheet of [...document.styleSheets]) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // folha de outra origem
      }
      for (const rule of [...cssRules]) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = families(rule.style.getPropertyValue('font-family'))[0];
        const range = rule.style.getPropertyValue('unicode-range');
        if (!family || !wanted.has(family)) continue;
        if (range && !/U\+0{0,4}0?0?(-|,|$)|U\+0000-00FF/i.test(range)) continue;
        rules.push(rule);
      }
    }
    const out: string[] = [];
    for (const rule of rules.slice(0, MAX_FONTS)) {
      const src = rule.style.getPropertyValue('src');
      const match = /url\((["']?)([^"')]+)\1\)/.exec(src);
      if (!match?.[2]) continue;
      const response = await fetch(new URL(match[2], rule.parentStyleSheet?.href ?? window.location.href).toString());
      if (!response.ok) continue;
      const data = await toDataUrl(await response.blob());
      out.push(rule.cssText.replace(match[0], `url(${data})`));
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

/** Monta o SVG que embrulha o HTML da arte. Exportada para teste. */
export function svgFor(xhtml: string, width: number, height: number, fontCss = ''): string {
  const style = fontCss ? `<style>${fontCss.replace(/]]>/g, '')}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${style}<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
}

export async function nodeToPng(node: HTMLElement, width: number, height: number): Promise<Blob> {
  const xhtml = new XMLSerializer().serializeToString(node);
  const svg = svgFor(xhtml, width, height, await embeddedFontCss(node));
  const image = new Image();
  image.width = width;
  image.height = height;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('O navegador não conseguiu montar a imagem.'));
  });
  // Data URL (e não blob URL): assim o canvas não fica "contaminado" e pode ser exportado.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador não consegue gerar a imagem.');
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Não foi possível gerar o PNG.');
  return blob;
}
