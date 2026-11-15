import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { toTournament } from '@/mocks/views';
import { jsonLdScript, plainText, tournamentDescription, tournamentJsonLd } from './seo';

const seed = buildSeed();
const raw = seed.tournaments.find((t) => t.status !== 'DRAFT');
if (!raw) throw new Error('seed sem campeonato publicado');

describe('SEO das páginas públicas', () => {
  it('descrição: HTML vira texto curto', () => {
    expect(plainText('<p>Olá&nbsp;<strong>mundo</strong></p>')).toBe('Olá mundo');
    expect(plainText('a'.repeat(300), 10)).toHaveLength(10);
  });

  it('dados estruturados do campeonato como evento online', () => {
    // Sem o banco do protótipo carregado, `toTournament` usa o seed em memória.
    const t = toTournament(raw);
    const ld = tournamentJsonLd(t);
    expect(ld).toMatchObject({ '@type': 'SportsEvent', name: t.name, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' });
    expect(String(ld.url)).toMatch(new RegExp(`/c/${t.slug}$`));
    expect(tournamentDescription(t)).toContain(t.gameName);
    expect(tournamentJsonLd({ ...t, status: 'CANCELLED' }).eventStatus).toBe('https://schema.org/EventCancelled');
  });

  it('o JSON dentro de <script> não deixa fechar a tag pelo texto', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});
