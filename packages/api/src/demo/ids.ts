/**
 * IDs da seed de demonstração (issue #102). O protótipo usa IDs legíveis (`u_bianca`, `tn_liga_cr`); o banco usa
 * UUID. `demoId` converte um no outro de forma **determinística** (UUID v5-like de `nova-demo:<id>`): a seed grava
 * sempre os mesmos UUIDs e os testes E2E com a API real acham os registros do protótipo pelo mesmo nome.
 *
 * Só `node:crypto`: pode ser importado pelos testes do Playwright sem puxar o resto da API.
 */
import { createHash } from 'node:crypto';

export function demoId(mockId: string): string {
  const h = createHash('sha1').update(`nova-demo:${mockId}`).digest();
  // Versão 5 e variante RFC 4122, como um UUID v5 de verdade.
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
