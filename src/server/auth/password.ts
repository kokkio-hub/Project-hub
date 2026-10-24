import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, no native add-ons).
 * Parameters follow the OWASP recommendation N=2^15, r=8, p=3 (~32 MiB per hash).
 * The parameters are stored with each hash so they can be raised later without
 * breaking existing passwords.
 */
// The test runner uses a much cheaper setting so the suite stays fast. VITEST is
// only ever set by the test runner, never in a real deployment.
const PARAMS = process.env.VITEST === 'true' ? { N: 2 ** 10, r: 8, p: 1 } : { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: maxmemFor(PARAMS.N, PARAMS.r) });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every(Number.isSafeInteger)) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same amount of time as a real check. Used when an email address is
 * unknown so response times don't reveal which addresses have accounts.
 */
export async function fakeVerify(password: string): Promise<false> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
  return false;
}

// Easy-to-read characters only (no 0/O, 1/l/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A random temporary password like "hR7k-Pq2m-Zx9c-Tn4w" (~92 bits). */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}
