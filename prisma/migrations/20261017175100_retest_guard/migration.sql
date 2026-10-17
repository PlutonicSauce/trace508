-- Only one active independent retest may be linked to the same remediation item.
CREATE UNIQUE INDEX "RemediationRetest_one_active" ON "RemediationRetest" ("remediationId") WHERE "outcome" = 'awaiting-retest';
