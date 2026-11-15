-- Descrição do modelo de campeonato (issue #75). Só adiciona coluna com padrão: compatível com a versão anterior.

-- AlterTable
ALTER TABLE "tournament_templates" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';
