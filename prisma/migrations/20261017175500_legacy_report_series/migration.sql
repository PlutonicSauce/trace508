-- Assign series metadata to historical drafts without changing their files, hashes or evidence snapshots.
WITH legacy AS (
 SELECT r.id, COALESCE(a."rootId",a.id) AS series,
 row_number() OVER (PARTITION BY COALESCE(a."rootId",a.id) ORDER BY r."createdAt",r.id) AS number,
 lag(r.id) OVER (PARTITION BY COALESCE(a."rootId",a.id) ORDER BY r."createdAt",r.id) AS previous
 FROM "Report" r JOIN "Assessment" a ON a.id=r."assessmentId"
 WHERE r."seriesId" IS NULL
)
UPDATE "Report" r SET "seriesId"=legacy.series,version=legacy.number,"previousId"=legacy.previous FROM legacy WHERE r.id=legacy.id;
