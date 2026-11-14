import { useId } from 'react';
import { GRADIENTS, LETTER_A_LEG, LETTER_A_STROKE, LETTER_N, LOGO_VIEWBOX, ORBIT_BACK, ORBIT_FRONT } from './logoPaths';

export interface LogoMarkProps {
  className?: string;
  /** Nome acessível. Sem ele, o símbolo é decorativo (o link ao redor já diz "Nova Arena"). */
  title?: string;
}

/**
 * Símbolo da Nova Arena em SVG: nítido em qualquer tamanho e densidade de tela.
 * O verde vem dos tokens da marca (`--brand-*`); o N usa `--logo-ink`, que acompanha o tema
 * (e o cabeçalho colorido das áreas, que redefine o token).
 */
export function LogoMark({ className, title }: LogoMarkProps) {
  // Ids únicos por instância: duas logos na mesma página não podem dividir o mesmo gradiente.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `na-${name}-${uid}`;
  const { back, front, stroke } = GRADIENTS;
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <defs>
        <radialGradient id={id('back')} gradientUnits="userSpaceOnUse" cx={back.cx} cy={back.cy} r={back.r}>
          <stop offset="0" stopColor="var(--brand-glow)" />
          <stop offset="0.55" stopColor="var(--brand-mid)" />
          <stop offset="1" stopColor="var(--brand-deep)" />
        </radialGradient>
        <radialGradient id={id('front')} gradientUnits="userSpaceOnUse" cx={front.cx} cy={front.cy} r={front.r}>
          <stop offset="0" stopColor="var(--brand-glow)" />
          <stop offset="0.6" stopColor="var(--brand-mid)" />
          <stop offset="1" stopColor="var(--brand-deep)" />
        </radialGradient>
        <linearGradient id={id('stroke')} gradientUnits="userSpaceOnUse" x1={stroke.x1} y1={stroke.y1} x2={stroke.x2} y2={stroke.y2}>
          <stop offset="0" stopColor="var(--brand-glow)" />
          <stop offset="0.65" stopColor="var(--brand-mid)" />
          <stop offset="1" stopColor="var(--brand-deep)" />
        </linearGradient>
      </defs>
      <path d={ORBIT_BACK} fill={`url(#${id('back')})`} />
      <path d={LETTER_N} fill="var(--logo-ink)" />
      <path d={LETTER_A_STROKE} fill={`url(#${id('stroke')})`} />
      <path d={LETTER_A_LEG} fill="var(--logo-ink)" />
      <path d={ORBIT_FRONT} fill={`url(#${id('front')})`} />
    </svg>
  );
}
