import * as argon2 from 'argon2';
import { scrypt as legacyScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './errors';
const scrypt = promisify(legacyScrypt);
const common = new Set([
  'passwordpassword',
  'password123456789',
  '123456789012345',
  '12345678901234567890',
  'trace508password',
  'letmeinletmeinletmein',
  'correct horse battery staple',
]);
export function validatePassword(password: string) {
  const normalized = password.normalize('NFC');
  if ([...normalized].length < 15 || [...normalized].length > 200)
    throw new AppError(
      400,
      'PASSWORD_POLICY',
      'Use 15–200 characters; spaces and Unicode are supported.',
    );
  if (common.has(normalized.toLowerCase()) || /^(.)\1+$/u.test(normalized))
    throw new AppError(400, 'PASSWORD_BLOCKED', 'Choose a less common password.');
  return normalized;
}
let hashing = 0;
async function bounded<T>(operation: () => Promise<T>): Promise<T> {
  if (hashing >= 4)
    throw new AppError(429, 'AUTH_BUSY', 'Authentication capacity reached. Try again shortly.');
  hashing++;
  try {
    return await operation();
  } finally {
    hashing--;
  }
}
export const passwordHash = async (password: string) =>
  bounded(() =>
    argon2.hash(validatePassword(password), {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    }),
  );
export async function checkPassword(password: string, stored: string) {
  return bounded(async () => {
    if (stored.startsWith('$argon2id$'))
      return argon2.verify(stored, password.normalize('NFC')).catch(() => false);
    const [salt, expected] = stored.split(':');
    if (!salt || !/^[a-f0-9]{128}$/.test(expected ?? '')) return false;
    const result = (await scrypt(password, salt, 64)) as Buffer;
    return timingSafeEqual(result, Buffer.from(expected, 'hex'));
  });
}
