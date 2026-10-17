ALTER TABLE "Assessment" ADD COLUMN "requestKey" TEXT, ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "Assessment_projectId_requestKey_key" ON "Assessment"("projectId","requestKey");
