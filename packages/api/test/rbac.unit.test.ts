/** Papéis e permissões sem banco: regras da matriz (PRD §6) e decisão da borda (`proxy.ts`), issue #70. */
import { describe, expect, it } from 'vitest';
import { envFrom } from '../src';
import { edgeRedirect, readAccessClaims } from '../src/auth/edge';
import { signAccessToken } from '../src/auth/jwt';
import { registrationBlock, roleChangeDecision, tournamentAccessDecision } from '../src/auth/rbac';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';

describe('acesso ao campeonato', () => {
  const base = { userId: 'u1', ownerId: 'dono', staffRole: null, roles: ['PARTICIPANT'] as const };

  it('Admin e Super Admin passam em qualquer campeonato', () => {
    expect(tournamentAccessDecision({ ...base, roles: ['ADMIN', 'PARTICIPANT'], level: 'manage' })).toBe('admin');
    expect(tournamentAccessDecision({ ...base, roles: ['SUPER_ADMIN'], level: 'moderate' })).toBe('admin');
  });

  it('dono passa; organizador de outro campeonato não (Organizador A × campeonato do B)', () => {
    expect(tournamentAccessDecision({ ...base, userId: 'dono', roles: ['ORGANIZER'], level: 'manage' })).toBe('owner');
    expect(tournamentAccessDecision({ ...base, userId: 'organizador-a', roles: ['ORGANIZER', 'PARTICIPANT'], level: 'manage' })).toBeNull();
  });

  it('co-organizador gerencia e modera; moderador só modera', () => {
    expect(tournamentAccessDecision({ ...base, staffRole: 'CO_ORGANIZER', level: 'manage' })).toBe('CO_ORGANIZER');
    expect(tournamentAccessDecision({ ...base, staffRole: 'MODERATOR', level: 'moderate' })).toBe('MODERATOR');
    expect(tournamentAccessDecision({ ...base, staffRole: 'MODERATOR', level: 'manage' })).toBeNull();
  });
});

describe('mudança de papel (nota ¹ da matriz)', () => {
  const sa = { id: 'sa', roles: ['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT'] as const };
  const admin = { id: 'ad', roles: ['ADMIN', 'PARTICIPANT'] as const, adminSince: new Date('2026-06-01') };
  const veteran = { id: 've', roles: ['ADMIN', 'PARTICIPANT'] as const, adminSince: new Date('2026-01-01') };
  const rookie = { id: 'ro', roles: ['ADMIN', 'PARTICIPANT'] as const, adminSince: new Date('2026-10-01') };
  const player = { id: 'pl', roles: ['PARTICIPANT'] as const };
  const code = (d: ReturnType<typeof roleChangeDecision>) => (d.ok ? 'ok' : d.code);

  it('Admin não remove Super Admin', () => {
    expect(code(roleChangeDecision({ actor: admin, target: sa, role: 'ADMIN', action: 'revoke' }))).toBe('REQUIRES_SUPER_ADMIN');
    expect(code(roleChangeDecision({ actor: admin, target: sa, role: 'SUPER_ADMIN', action: 'revoke' }))).toBe('REQUIRES_SUPER_ADMIN');
  });

  it('Admin não remove Admin com mais tempo de casa; remove o mais novo', () => {
    expect(code(roleChangeDecision({ actor: admin, target: veteran, role: 'ADMIN', action: 'revoke' }))).toBe('REQUIRES_SUPER_ADMIN');
    expect(code(roleChangeDecision({ actor: admin, target: rookie, role: 'ADMIN', action: 'revoke' }))).toBe('ok');
  });

  it('Super Admin pode tudo; só ele dá o papel de Super Admin', () => {
    expect(code(roleChangeDecision({ actor: sa, target: veteran, role: 'ADMIN', action: 'revoke' }))).toBe('ok');
    expect(code(roleChangeDecision({ actor: admin, target: player, role: 'SUPER_ADMIN', action: 'grant' }))).toBe('REQUIRES_SUPER_ADMIN');
    expect(code(roleChangeDecision({ actor: sa, target: player, role: 'SUPER_ADMIN', action: 'grant' }))).toBe('ok');
  });

  it('Admin promove e revoga Organizador; organizador e participante não mudam papel de ninguém', () => {
    expect(code(roleChangeDecision({ actor: admin, target: player, role: 'ORGANIZER', action: 'grant' }))).toBe('ok');
    expect(code(roleChangeDecision({ actor: { id: 'or', roles: ['ORGANIZER', 'PARTICIPANT'] }, target: player, role: 'ORGANIZER', action: 'grant' }))).toBe('FORBIDDEN');
    expect(code(roleChangeDecision({ actor: player, target: player, role: 'ADMIN', action: 'grant' }))).toBe('FORBIDDEN');
  });

  it('o papel de participante não sai pela gestão de papéis', () => {
    expect(code(roleChangeDecision({ actor: sa, target: player, role: 'PARTICIPANT', action: 'revoke' }))).toBe('ROLE_NOT_MANAGEABLE');
  });
});

describe('inscrição (nota ³ da matriz)', () => {
  it('organizador não se inscreve no próprio campeonato', () => {
    expect(registrationBlock('dono', { ownerId: 'dono' })?.code).toBe('OWN_TOURNAMENT');
    expect(registrationBlock('outro', { ownerId: 'dono' })).toBeNull();
  });
});

describe('borda (proxy.ts)', () => {
  const env = envFrom({ AUTH_JWT_SECRET: SECRET });
  const now = new Date('2026-11-14T12:00:00Z');
  const token = (roles: ('SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[], tfa = false) => signAccessToken(env, { sub: 'u', sid: 's', sv: 0, tfa, roles }, now);

  it('lê os papéis do token; token vencido, de outro segredo ou adulterado = sem sessão', async () => {
    const t = await token(['ORGANIZER', 'PARTICIPANT']);
    expect((await readAccessClaims(SECRET, t, now))?.roles).toEqual(['ORGANIZER', 'PARTICIPANT']);
    expect(await readAccessClaims(SECRET, t, new Date(now.getTime() + 16 * 60_000))).toBeNull();
    expect(await readAccessClaims('outro-segredo-qualquer-com-32-caracteres', t, now)).toBeNull();
    expect(await readAccessClaims(SECRET, `${t.slice(0, -2)}xx`, now)).toBeNull();
  });

  it('redireciona por área: visitante → login; papel errado → início; papel certo passa', async () => {
    const claims = async (roles: Parameters<typeof token>[0], tfa = false) => readAccessClaims(SECRET, await token(roles, tfa), now);
    expect(edgeRedirect('/admin', null)).toBe('login');
    expect(edgeRedirect('/organizador/campeonatos', null)).toBe('login');
    expect(edgeRedirect('/admin/usuarios', await claims(['ORGANIZER', 'PARTICIPANT']))).toBe('forbidden');
    expect(edgeRedirect('/admin', await claims(['ADMIN', 'PARTICIPANT'], true))).toBeNull();
    // Admin sem o 2FA feito nesta sessão (issue #95) vai para a página Segurança.
    expect(edgeRedirect('/admin/usuarios', await claims(['ADMIN', 'PARTICIPANT']))).toBe('two-factor');
    expect(edgeRedirect('/organizador', await claims(['ADMIN']))).toBeNull();
    expect(edgeRedirect('/organizador', await claims(['PARTICIPANT']))).toBe('forbidden');
    expect(edgeRedirect('/organizador', await claims(['ORGANIZER', 'PARTICIPANT']))).toBeNull();
    expect(edgeRedirect('/organizador', await claims(['SUPER_ADMIN']))).toBeNull();
    // Outras rotas nem passam pela regra (e `/administracao` não é `/admin`).
    expect(edgeRedirect('/campeonatos', null)).toBeNull();
    expect(edgeRedirect('/administracao', null)).toBeNull();
  });
});
