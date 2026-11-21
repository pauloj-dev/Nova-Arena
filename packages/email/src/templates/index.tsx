import { Link, Text } from '@react-email/components';
import { messages as m } from '../messages.pt-BR';
import { Layout } from './Layout';

export function VerifyEmail({ nickname, link }: { nickname: string; link: string }) {
  const t = m.VERIFY_EMAIL;
  return (
    <Layout preview={t.preview} heading={t.heading(nickname)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body}</Text>
    </Layout>
  );
}

export function ResetPassword({ nickname, link }: { nickname: string; link: string }) {
  const t = m.RESET_PASSWORD;
  return (
    <Layout preview={t.preview} heading={t.heading(nickname)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body}</Text>
    </Layout>
  );
}

export function RoleInvite({ role, inviter, link, expiresAt }: { role: string; inviter: string; link: string; expiresAt: string }) {
  const t = m.ROLE_INVITE;
  const roleName = t.roles[role] ?? role;
  return (
    <Layout preview={t.preview} heading={t.heading(roleName)} action={{ label: t.action, href: link }} note={t.expires(expiresAt)}>
      <Text style={{ margin: 0 }}>{t.body(inviter, roleName)}</Text>
    </Layout>
  );
}

export function TeamInvite({ team, captain, link }: { team: string; captain: string; link: string }) {
  const t = m.TEAM_INVITE;
  return (
    <Layout preview={t.preview} heading={t.heading(team)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body(captain, team)}</Text>
    </Layout>
  );
}

export function ConfirmEmailChange({ nickname, link }: { nickname: string; link: string }) {
  const t = m.CONFIRM_EMAIL_CHANGE;
  return (
    <Layout preview={t.preview} heading={t.heading(nickname)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body}</Text>
    </Layout>
  );
}

export function EmailChanged({ nickname, newEmail, link }: { nickname: string; newEmail: string; link: string }) {
  const t = m.EMAIL_CHANGED;
  return (
    <Layout preview={t.preview} heading={t.heading(nickname)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body(newEmail)}</Text>
    </Layout>
  );
}

export function PasswordChanged({ nickname, link }: { nickname: string; link: string }) {
  const t = m.PASSWORD_CHANGED;
  return (
    <Layout preview={t.preview} heading={t.heading(nickname)} action={{ label: t.action, href: link }} note={t.expires}>
      <Text style={{ margin: 0 }}>{t.body}</Text>
    </Layout>
  );
}

export interface NotificationEmailProps {
  /** Tipo da notificação (`NotificationType` de `@nova/schemas`). */
  type: string;
  nickname: string;
  title: string;
  body: string;
  /** Endereço completo do que a notificação abre. */
  link: string;
  /** Endereço completo das preferências de notificação. */
  preferencesLink: string;
}

/** Um aviso da plataforma por e-mail: o mesmo título e texto do sino, com o botão do que fazer a seguir. */
export function NotificationEmail({ type, nickname, title, body, link, preferencesLink }: NotificationEmailProps) {
  const t = m.NOTIFICATION;
  const kind = t.types[type] ?? t.fallback;
  return (
    <Layout
      preview={body}
      heading={title}
      action={{ label: kind.action, href: link }}
      note={type === 'SANCTION' ? t.sanctionNote : undefined}
      footerNote={
        <>
          {t.preferences} <Link href={preferencesLink}>{t.preferencesLink}</Link>
        </>
      }
    >
      <Text style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{kind.kicker}</Text>
      <Text style={{ margin: '0 0 8px' }}>{t.greeting(nickname)}</Text>
      <Text style={{ margin: 0 }}>{body}</Text>
    </Layout>
  );
}
