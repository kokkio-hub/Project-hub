import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238), as used by authenticator apps such as
 * Google Authenticator, Microsoft Authenticator, 1Password and Authy:
 * HMAC-SHA1, 30-second steps, six digits.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32-encoded (what authenticator apps expect). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function codeAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, '0');
}

export function counterAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

/**
 * Checks a code, allowing one step of clock drift either way. Returns the
 * step it matched (store it so the same code can't be used twice), or null.
 */
export function verifyCode(secret: string, code: string, lastCounter: number | null, now = Date.now()): number | null {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = counterAt(now);
  for (const counter of [current - 1, current, current + 1]) {
    if (lastCounter !== null && counter <= lastCounter) continue;
    const expected = Buffer.from(codeAt(secret, counter));
    if (timingSafeEqual(expected, Buffer.from(digits))) return counter;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Recovery codes: for signing in when the phone with the authenticator app is gone.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 10; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
