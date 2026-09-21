import { randomBytes, createHash } from 'node:crypto';

const PREFIX = 'tte_';

export function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateKey(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const body = randomBytes(32).toString('base64url');
  const secret = `${PREFIX}${body}`;
  const prefix = `${PREFIX}${body.slice(0, 6)}`;
  return { secret, prefix, hash: hashKey(secret) };
}
