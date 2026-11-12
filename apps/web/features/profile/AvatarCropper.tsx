'use client';

import { Button, Modal } from '@nova/ui';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { canPan, cropRect, encodeWithinLimit, INITIAL_CROP, MAX_ZOOM, MIN_ZOOM, nudgeCrop, panCrop, type CropState } from './avatarImage';

/** Lado interno do canvas da prévia (o CSS ajusta o tamanho na tela). */
const PREVIEW_PX = 320;

/** Fundo para imagens com transparência (o JPEG não tem canal alfa). Vem do token, não de cor solta. */
function backdropColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-white').trim() || 'white';
}

function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: CropState, outputPx: number): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  canvas.width = outputPx;
  canvas.height = outputPx;
  const { sx, sy, size } = cropRect(image.naturalWidth, image.naturalHeight, crop);
  ctx.fillStyle = backdropColor();
  ctx.fillRect(0, 0, outputPx, outputPx);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, size, size, 0, 0, outputPx, outputPx);
  return true;
}

interface AvatarCropperProps {
  /** Imagem já carregada. Nulo = modal fechado. */
  image: HTMLImageElement | null;
  onCancel: () => void;
  /** Recebe o data URL quadrado (JPEG), já dentro do limite de tamanho. */
  onConfirm: (dataUrl: string) => void;
}

/** Recorte quadrado com zoom, feito em `<canvas>`. Dá para arrastar a foto ou usar os botões de seta. */
export function AvatarCropper({ image, onCancel, onConfirm }: AvatarCropperProps) {
  return (
    <Modal open={image !== null} onOpenChange={(open) => !open && onCancel()} title="Recortar foto" description="Ajuste o zoom e a posição. A área dentro do círculo é a que aparece no seu avatar." size="sm">
      {/* A chave reinicia zoom e posição a cada foto escolhida. */}
      {image && <CropperBody key={image.src} image={image} onCancel={onCancel} onConfirm={onConfirm} />}
    </Modal>
  );
}

function CropperBody({ image, onCancel, onConfirm }: { image: HTMLImageElement; onCancel: () => void; onConfirm: (dataUrl: string) => void }) {
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const zoomId = useId();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const pan = canPan(width, height, crop);

  useEffect(() => {
    if (canvasRef.current) drawCrop(canvasRef.current, image, crop, PREVIEW_PX);
  }, [image, crop]);

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const start = drag.current;
    if (!start) return;
    const shown = e.currentTarget.getBoundingClientRect().width;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => panCrop(c, dx, dy, shown, width, height));
  }
  function onPointerEnd() {
    drag.current = null;
  }

  function confirm() {
    const canvas = document.createElement('canvas');
    try {
      const result = encodeWithinLimit((size, quality) => {
        if (!drawCrop(canvas, image, crop, size)) throw new Error('canvas indisponível');
        return canvas.toDataURL('image/jpeg', quality);
      });
      if (!result.fits || !result.dataUrl.startsWith('data:image/jpeg')) {
        setFailed(true);
        return;
      }
      onConfirm(result.dataUrl);
    } catch {
      setFailed(true);
    }
  }

  const arrow = 'flex size-11 items-center justify-center rounded-md border border-border-strong bg-surface text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto w-full max-w-64">
        <canvas
          ref={canvasRef}
          width={PREVIEW_PX}
          height={PREVIEW_PX}
          role="img"
          aria-label="Prévia do recorte da foto"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className="aspect-square w-full cursor-grab touch-none rounded-lg border border-border bg-neutral-soft active:cursor-grabbing"
        />
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white shadow-md" aria-hidden />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={zoomId} className="text-sm font-medium text-text">
          Zoom
        </label>
        <input
          id={zoomId}
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={crop.zoom}
          onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
          aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
          className="min-h-11 w-full accent-(--accent)"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={`${zoomId}-move`} className="text-sm font-medium text-text">
          Posição
        </span>
        <div role="group" aria-labelledby={`${zoomId}-move`} className="flex flex-wrap gap-2">
          <button type="button" className={arrow} aria-label="Mover a foto para a esquerda" disabled={!pan.x} onClick={() => setCrop((c) => nudgeCrop(c, -1, 0))}>
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <button type="button" className={arrow} aria-label="Mover a foto para a direita" disabled={!pan.x} onClick={() => setCrop((c) => nudgeCrop(c, 1, 0))}>
            <ArrowRight className="size-5" aria-hidden />
          </button>
          <button type="button" className={arrow} aria-label="Mover a foto para cima" disabled={!pan.y} onClick={() => setCrop((c) => nudgeCrop(c, 0, -1))}>
            <ArrowUp className="size-5" aria-hidden />
          </button>
          <button type="button" className={arrow} aria-label="Mover a foto para baixo" disabled={!pan.y} onClick={() => setCrop((c) => nudgeCrop(c, 0, 1))}>
            <ArrowDown className="size-5" aria-hidden />
          </button>
        </div>
        <p className="text-xs text-muted">Você também pode arrastar a foto. Aumente o zoom para liberar o movimento nos dois sentidos.</p>
      </div>

      {failed && (
        <p role="alert" className="text-sm font-medium text-danger">
          Não foi possível preparar esta foto. Tente outra imagem.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={confirm}>Usar esta foto</Button>
      </div>
    </div>
  );
}
