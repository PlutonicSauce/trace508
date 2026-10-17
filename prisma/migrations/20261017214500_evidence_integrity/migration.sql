-- AlterTable ReviewerDecision
ALTER TABLE "ReviewerDecision" ADD COLUMN IF NOT EXISTS "invalidatedAt" TIMESTAMP(3);
ALTER TABLE "ReviewerDecision" ADD COLUMN IF NOT EXISTS "invalidationReason" TEXT;

-- AlterTable Report
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "invalidationReason" TEXT;

-- Invalidate the historical mismatched decisions where color contrast evidence was attached to WCAG 1.1.1
UPDATE "ReviewerDecision"
SET "invalidatedAt" = NOW(),
    "invalidationReason" = 'Automated compliance integrity audit: Evidence belongs to WCAG 1.4.3 (color-contrast) but was attached to WCAG 1.1.1 (Non-text Content).'
WHERE id IN (
  SELECT d.id FROM "ReviewerDecision" d
  JOIN "ReviewTask" t ON d."taskId" = t.id
  WHERE t."requirementId" = '1.1.1'
  AND d."notes" LIKE '%contrast%'
);

-- Reopen any review tasks whose decisions were invalidated
UPDATE "ReviewTask"
SET "status" = 'open'
WHERE id IN (
  SELECT DISTINCT "taskId" FROM "ReviewerDecision"
  WHERE "invalidatedAt" IS NOT NULL
);

-- Supersede reports that contained conformance assertions from the invalidated decisions
UPDATE "Report"
SET "status" = 'superseded',
    "invalidationReason" = 'Superseded: Prior draft report contained WCAG 1.1.1 conformance statement based on mismatched WCAG 1.4.3 color contrast evidence.'
WHERE "assessmentId" IN (
  SELECT DISTINCT t."assessmentId" FROM "ReviewTask" t
  JOIN "ReviewerDecision" d ON d."taskId" = t.id
  WHERE d."invalidatedAt" IS NOT NULL
);
