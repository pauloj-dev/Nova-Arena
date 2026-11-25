-- Imagens dos jogos do catálogo (apps/web/public/jogos). Só preenche quem ainda não tem imagem:
-- uma capa cadastrada pelo Admin não é sobrescrita.
UPDATE "games" SET "coverUrl" = '/jogos/free-fire.webp' WHERE "slug" = 'free-fire' AND "coverUrl" IS NULL;
UPDATE "games" SET "coverUrl" = '/jogos/clash-royale.webp' WHERE "slug" = 'clash-royale' AND "coverUrl" IS NULL;
UPDATE "games" SET "coverUrl" = '/jogos/8-ball-pool.webp' WHERE "slug" = '8-ball-pool' AND "coverUrl" IS NULL;
UPDATE "games" SET "coverUrl" = '/jogos/efootball.webp' WHERE "slug" = 'efootball' AND "coverUrl" IS NULL;
