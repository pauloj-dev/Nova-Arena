-- Contato e ID no jogo das inscrições importadas por CSV (issue #79). Só colunas opcionais: compatível com a versão anterior.

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "importedContact" TEXT,
ADD COLUMN     "importedGameId" TEXT;
