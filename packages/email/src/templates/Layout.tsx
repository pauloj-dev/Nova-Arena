import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { messages } from '../messages.pt-BR';
import { EMAIL_THEME as c } from '../theme';

export interface LayoutProps {
  preview: string;
  heading: string;
  children: ReactNode;
  action: { label: string; href: string };
  note?: string;
}

const font = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Moldura comum: marca, título, texto, botão (com o link em texto por baixo) e rodapé. */
export function Layout({ preview, heading, children, action, note }: LayoutProps) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: c.bg, color: c.text, fontFamily: font, margin: 0, padding: '24px 12px' }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: 12, padding: 32 }}>
          <Text style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: 1, color: c.text }}>
            <span style={{ color: c.brand }}>●</span> {messages.common.brand}
          </Text>
          <Heading as="h1" style={{ fontSize: 22, lineHeight: '30px', margin: '24px 0 8px', color: c.text }}>
            {heading}
          </Heading>
          <Section style={{ fontSize: 15, lineHeight: '24px', color: c.text }}>{children}</Section>
          <Section style={{ margin: '24px 0' }}>
            <Button href={action.href} style={{ backgroundColor: c.primary, color: c.onPrimary, fontSize: 15, fontWeight: 700, borderRadius: 8, padding: '12px 20px', textDecoration: 'none' }}>
              {action.label}
            </Button>
          </Section>
          {note && <Text style={{ fontSize: 13, lineHeight: '20px', color: c.primarySoftText, backgroundColor: c.primarySoft, borderRadius: 8, padding: '8px 12px' }}>{note}</Text>}
          <Text style={{ fontSize: 13, lineHeight: '20px', color: c.muted }}>
            {messages.common.fallbackLink}
            <br />
            <Link href={action.href} style={{ color: c.primary, wordBreak: 'break-all' }}>
              {action.href}
            </Link>
          </Text>
          <Hr style={{ borderColor: c.border, margin: '24px 0 16px' }} />
          <Text style={{ fontSize: 12, lineHeight: '18px', color: c.muted, margin: 0 }}>
            {messages.common.ignore}
            <br />
            {messages.common.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
