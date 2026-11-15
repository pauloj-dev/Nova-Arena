-- Uploads diretos para o Vercel Blob (issue #73). Só cria a tabela: compatível com a versão anterior.

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'public',
    "blobUrl" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "attachedType" TEXT,
    "attachedId" TEXT,
    "attachedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_blobUrl_key" ON "uploads"("blobUrl");

-- CreateIndex
CREATE INDEX "uploads_ownerId_idx" ON "uploads"("ownerId");

-- CreateIndex
CREATE INDEX "uploads_attachedType_attachedId_idx" ON "uploads"("attachedType", "attachedId");

-- CreateIndex
CREATE INDEX "uploads_attachedAt_createdAt_idx" ON "uploads"("attachedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
