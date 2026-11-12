/**
 * Prepara a logo no navegador: lê o arquivo, corta um quadrado central e reduz para 256 px.
 * O resultado é um data URL pequeno — é o "upload simulado" do protótipo (em B1 o arquivo vai para o Vercel Blob).
 */
import { validateLogoFile } from './rules';

const LOGO_PX = 256;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('imagem inválida'));
    image.src = src;
  });
}

/** Devolve o data URL da logo pronta, ou lança `Error` com a mensagem para mostrar à pessoa. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  const problem = validateLogoFile(file);
  if (problem) throw new Error(problem);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_PX;
    canvas.height = LOGO_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx || side === 0) throw new Error('canvas indisponível');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, LOGO_PX, LOGO_PX);
    // WebP mantém a transparência da logo; navegador sem WebP devolve PNG, que também é aceito.
    return canvas.toDataURL('image/webp', 0.9);
  } catch {
    throw new Error('Não foi possível ler esta imagem. Tente outro arquivo.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
