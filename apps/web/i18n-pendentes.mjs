/**
 * Áreas cujo texto ainda não foi para os arquivos de mensagens (issue 108). A regra `i18next/no-literal-string`
 * fica desligada só nelas; ao migrar uma área, apague a linha dela. A lista vazia é o critério de aceite da #108:
 * "nenhum texto de interface fixo no código". Conferir uma área: `pnpm --filter web check:i18n features/<área>`.
 */
export const I18N_PENDENTES = [
  'app/**',
  'features/admin/**',
  'features/calendar/**',
  'features/games/**',
  'features/leagues/**',
  'features/organizer/**',
  'features/registrations/**',
  'features/seasons/**',
  'features/teams/**',
  'features/tournaments/**',
  'shared/**',
];
