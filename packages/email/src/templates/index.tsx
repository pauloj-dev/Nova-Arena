import { Text } from '@react-email/components';
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
