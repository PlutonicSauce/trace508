import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../packages/core/src/db';
import { passwordHash, validatePassword } from '../packages/core/src/passwords';

async function main() {
  const email = (process.env.AUDITOR_EMAIL || 'auditor@trace508.local').trim().toLowerCase();

  // Generate high-entropy replacement password (43 characters url-safe, well within 15-200 limit)
  const newPassword = randomBytes(32).toString('base64url');
  validatePassword(newPassword);

  const localDir = path.join(process.cwd(), '.local');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { mode: 0o700, recursive: true });
  }

  const secretPath = path.join(localDir, 'auditor_password');
  // Write with owner-only permissions (0600)
  fs.writeFileSync(secretPath, newPassword, { mode: 0o600, flag: 'w' });
  fs.chmodSync(secretPath, 0o600);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`User with email "${email}" not found.`);
  }

  const hashed = await passwordHash(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: hashed },
    });
    const deleted = await tx.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(`[AUTH-ROTATION] Successfully rotated password for ${email}.`);
    console.log(`[AUTH-ROTATION] Invalidated ${deleted.count} active session(s).`);
  });

  console.log(`[AUTH-ROTATION] New password securely stored at: ${secretPath}`);
  console.log('[AUTH-ROTATION] File permissions set to 0600 (owner read/write only).');
  console.log('[AUTH-ROTATION] Credentials were NOT printed to console.');
}

main()
  .catch((err) => {
    console.error('[AUTH-ROTATION] Failed to rotate auditor password:', err.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
