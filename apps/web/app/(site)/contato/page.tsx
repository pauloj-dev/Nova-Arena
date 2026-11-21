import type { Metadata } from 'next';
import { ContactPage } from '@/features/help/ContactPage';

export const metadata: Metadata = {
  title: 'Contato',
  description: 'Fale com o suporte da Nova Arena.',
};

export default function ContactRoute() {
  return <ContactPage />;
}
