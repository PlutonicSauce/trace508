CREATE TABLE "Initialization" (id TEXT PRIMARY KEY DEFAULT 'workspace', "tokenHash" TEXT, "expiresAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "organizationId" TEXT, "adoptLegacy" BOOLEAN NOT NULL DEFAULT false);
-- Existing authenticated installations stay initialized, even if accounts are later removed.
INSERT INTO "Initialization" (id,"completedAt") SELECT 'workspace',NOW() WHERE EXISTS (SELECT 1 FROM "User");
CREATE TABLE "AccountToken" (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, "organizationId" TEXT NOT NULL, role TEXT NOT NULL, "userId" TEXT, purpose TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AccountToken_expiry" ON "AccountToken"("expiresAt");
CREATE TABLE "WorkerLease" (id TEXT PRIMARY KEY, owner TEXT NOT NULL, "assessmentId" TEXT, "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL);
ALTER TABLE "Project" ADD COLUMN "storageQuotaMb" INTEGER NOT NULL DEFAULT 512;
ALTER TABLE "Assessment" ADD COLUMN "retryOf" TEXT, ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "Assessment_queue" ON "Assessment"(status,"createdAt");
CREATE INDEX "Assessment_project" ON "Assessment"("projectId","createdAt");
CREATE INDEX "Evidence_page" ON "Evidence"("pageId");
CREATE INDEX "ReviewTask_assessment" ON "ReviewTask"("assessmentId");
CREATE INDEX "Report_series" ON "Report"("seriesId",version);
