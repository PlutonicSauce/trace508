-- AlterTable ReviewerDecision
ALTER TABLE "ReviewerDecision" ADD COLUMN IF NOT EXISTS "reviewerQualification" TEXT;
ALTER TABLE "ReviewerDecision" ADD COLUMN IF NOT EXISTS "methodology" TEXT;
