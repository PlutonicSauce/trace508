-- CreateTable
CREATE TABLE "BenchmarkDecision" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkDecision_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BenchmarkDecision" ADD CONSTRAINT "BenchmarkDecision_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
