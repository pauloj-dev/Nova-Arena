-- Chave (issue #82): retrato do motor e destrave pelo Admin na fase. Só colunas novas: compatível com a versão anterior.

-- AlterTable
ALTER TABLE "stages" ADD COLUMN     "engineSnapshot" JSONB,
ADD COLUMN     "unlocked" BOOLEAN NOT NULL DEFAULT false;
