import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { db } from '../packages/core/src/db';
import { digest, issueAccountToken } from '../packages/core/src/auth';
import { localPath } from '../packages/core/src/storage';
try {
  const recovery = process.argv.indexOf('--recover');
  await mkdir(localPath(), { recursive: true, mode: 0o700 });
  if (recovery >= 0) {
    const user = await db.user.findUniqueOrThrow({ where: { email: process.argv[recovery + 1] } });
    if (user.disabled)
      throw new Error('Enable this member through an authorized administrator before recovery.');
    const p = await db.project.findFirstOrThrow({ where: { organizationId: user.organizationId } });
    const r = await issueAccountToken(
      {
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        userId: user.id,
        purpose: 'operator-recovery',
      },
      'trusted-local-recovery-operator',
      p.id,
    );
    await writeFile(localPath('recovery-token'), r.token, { mode: 0o600 });
    console.log(
      'Recovery token saved to protected .local/recovery-token; expires in 24 hours. Prior sessions revoked. Transfer through your trusted channel.',
    );
  } else {
    const token = randomBytes(32).toString('base64url');
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(50801)`;
      const init = await tx.initialization.findUnique({ where: { id: 'workspace' } });
      if (init?.completedAt || (await tx.user.count()))
        throw new Error('Already initialized. Use --recover EMAIL for trusted operator recovery.');
      const legacy = await tx.assessment.count();
      if (legacy && !process.argv.includes('--adopt-legacy'))
        throw new Error(
          'Legacy evidence exists. Inspect ownership, then explicitly pass --adopt-legacy. No records were reassigned.',
        );
      await tx.initialization.upsert({
        where: { id: 'workspace' },
        create: {
          id: 'workspace',
          tokenHash: digest(token),
          expiresAt: new Date(Date.now() + 3600000),
          organizationId: 'default',
          adoptLegacy: !!legacy,
        },
        update: {
          tokenHash: digest(token),
          expiresAt: new Date(Date.now() + 3600000),
          organizationId: 'default',
          adoptLegacy: !!legacy,
        },
      });
    });
    await writeFile(localPath('bootstrap-token'), token, { mode: 0o600 });
    console.log(
      'Bootstrap token saved to protected .local/bootstrap-token; valid once for 1 hour. Enter it in setup. No administrator has been created.',
    );
  }
} finally {
  await db.$disconnect();
}
