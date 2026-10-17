import { db } from '../packages/core/src/db';
import { passwordHash } from '../packages/core/src/passwords';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.env.NEW_PASSWORD || process.argv[3];

  if (!email || !password) {
    console.error(
      'Usage: NEW_PASSWORD="your-secure-password" node --import tsx scripts/set-password.ts <email>',
    );
    console.error('   or: node --import tsx scripts/set-password.ts <email> <password>');
    console.error('Note: Passwords must be at least 15 characters.');
    process.exit(1);
  }

  if ([...password.normalize('NFC')].length < 15) {
    console.error('Error: Password must contain at least 15 Unicode characters.');
    process.exit(1);
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Error: User with email "${email}" does not exist.`);
    process.exit(1);
  }

  const hashed = await passwordHash(password);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: hashed },
    });
    const deleted = await tx.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(
      `Successfully updated password for ${email}. Revoked ${deleted.count} active session(s).`,
    );
  });

  console.log('You can now log in at http://127.0.0.1:3000 using your updated password.');
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
