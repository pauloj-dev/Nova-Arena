import type { Metadata } from 'next';
import { HelpCenter } from '@/features/help/HelpCenter';

export const metadata: Metadata = {
  title: 'Central de ajuda',
  description: 'Como se inscrever, fazer check-in, o que é W.O., como contestar um resultado e como virar organizador na Nova Arena.',
};

export default function HelpRoute() {
  return <HelpCenter />;
}
