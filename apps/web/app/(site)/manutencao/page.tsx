import type { Metadata } from 'next';
import { MaintenancePage } from '@/features/help/MaintenancePage';

export const metadata: Metadata = {
  title: 'Manutenção',
  description: 'Manutenções programadas e situação do serviço da Nova Arena.',
};

export default function MaintenanceRoute() {
  return <MaintenancePage />;
}
