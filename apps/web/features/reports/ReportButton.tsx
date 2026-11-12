'use client';

export interface ReportButtonProps {
  targetType: 'USER' | 'TEAM' | 'MATCH' | 'RESULT';
  targetId: string;
  /** Nome do que está sendo denunciado, para o título do formulário. */
  targetLabel: string;
  /** `icon`: só o ícone (em cards); `button`: ícone + "Denunciar". */
  variant?: 'icon' | 'button';
  className?: string;
}

/** Botão "Denunciar" com formulário (motivo, descrição, anexo). Implementado em F2.9. */
export function ReportButton(_props: ReportButtonProps) {
  return null;
}
