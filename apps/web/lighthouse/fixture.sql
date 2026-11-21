-- Campeonato público para o Lighthouse CI (issue #111): `/c/copa-lighthouse`, com inscrições abertas, descrição e
-- regulamento (o texto é o que costuma ser o LCP da página). Roda depois de `prisma migrate deploy` e da seed `dev`
-- no banco descartável do CI. Idempotente.
INSERT INTO tournaments (id, slug, "gameId", "gameModeId", "ownerId", name, description, rules, prize, status, "participantType", "maxParticipants",
                         "registrationOpensAt", "registrationClosesAt", "startsAt", featured, "updatedAt")
SELECT gen_random_uuid(), 'copa-lighthouse', g.id, m.id, u.id, 'Copa Lighthouse de Free Fire',
       '<p>Campeonato aberto de <strong>Free Fire</strong> para squads de todo o Brasil. Três quedas por rodada, pontuação por colocação e abates, e transmissão ao vivo das finais.</p><p>Inscrições gratuitas até o fim da semana. Leia o regulamento antes de se inscrever.</p>',
       '<h3>Regras gerais</h3><ul><li>Proibido emulador.</li><li>Check-in 15 minutos antes de cada queda.</li><li>Prints do placar final valem como prova.</li></ul>',
       '<p>Troféu digital e destaque na página inicial.</p>',
       'REGISTRATION_OPEN', 'SOLO', 48, now() - interval '1 day', now() + interval '6 days', now() + interval '7 days', true, now()
FROM games g
JOIN game_modes m ON m."gameId" = g.id
JOIN users u ON u.email = 'camila@novaarena.gg'
WHERE g.slug = 'free-fire'
ORDER BY m.name
LIMIT 1
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stages (id, "tournamentId", "order", name, format, "scoringModelId", tiebreakers, "updatedAt")
SELECT gen_random_uuid(), t.id, 1, 'Fase única', 'BATTLE_ROYALE', s.id, '["points"]'::jsonb, now()
FROM tournaments t
JOIN scoring_models s ON s."gameId" = t."gameId" AND s."ownerId" IS NULL
WHERE t.slug = 'copa-lighthouse'
ORDER BY s.name
LIMIT 1
ON CONFLICT ("tournamentId", "order") DO NOTHING;
