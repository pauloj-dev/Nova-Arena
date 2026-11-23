'use client';

import dynamic from 'next/dynamic';
import { useConsent } from './consent';

// Fora do JS inicial (#111): carregados depois da hidratação (o Analytics, só depois do "sim").
const Analytics = dynamic(() => import('@vercel/analytics/next').then((m) => m.Analytics), { ssr: false });
const SpeedInsights = dynamic(() => import('@vercel/speed-insights/next').then((m) => m.SpeedInsights), { ssr: false });

/**
 * Medição (issues #115 e #116), sempre **sem cookies**:
 * - Speed Insights (LCP/INP reais, sem identificar a pessoa): sempre ligado — é o monitoramento das metas do RNF-01.
 * - Vercel Analytics (páginas visitadas): só com o "sim" do banner.
 * Fora da Vercel os scripts não acham o endpoint e não fazem nada.
 */
export function Measurement() {
  const consent = useConsent();
  return (
    <>
      <SpeedInsights />
      {consent?.analytics && <Analytics />}
    </>
  );
}
