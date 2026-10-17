import { db } from '../packages/core/src/db';
import { requirements } from '../packages/core/src/requirements';
for (const r of requirements)
  await db.requirement.upsert({ where: { id: r.id }, create: r, update: r });
console.log(
  `Seeded ${requirements.length} official WCAG 2.0 A/AA criterion records; no scan findings or reviewer decisions seeded.`,
);
await db.$disconnect();
