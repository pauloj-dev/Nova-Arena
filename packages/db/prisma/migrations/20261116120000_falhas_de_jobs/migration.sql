-- Falhas definitivas de jobs (issue #99). Só cria a tabela: compatível com a versão anterior.

-- CreateTable
CREATE TABLE "job_failures" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "job_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_failures_resolvedAt_createdAt_idx" ON "job_failures"("resolvedAt", "createdAt");
