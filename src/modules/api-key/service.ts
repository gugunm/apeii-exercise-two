import { eq } from 'drizzle-orm';
import { db } from '../../utils/db.js';
import { apiKeys } from '../../db/schema/index.js';
import { generateKey, hashKey } from '../../utils/api-key.js';
import type { CreateKeyInput, UpdateKeyInput } from './schema.js';

export type ApiKeyContext = { id: string; name: string; scopes: string[] };

type Row = typeof apiKeys.$inferSelect;

export type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isApiKeyValid(
  row: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function status(row: Row, now = new Date()): PublicApiKey['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    return 'expired';
  return 'active';
}

function toPublic(row: Row): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    status: status(row),
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createKey(
  input: CreateKeyInput,
): Promise<PublicApiKey & { secret: string }> {
  const { secret, prefix, hash } = generateKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: input.name,
      keyHash: hash,
      prefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    })
    .returning();
  return { ...toPublic(row), secret };
}

export async function verifyKey(token: string): Promise<ApiKeyContext | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(token)))
    .limit(1);
  if (!row || !isApiKeyValid(row)) return null;
  // Best-effort last-used tracking; never blocks or fails the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});
  return { id: row.id, name: row.name, scopes: row.scopes };
}

export async function listKeys(): Promise<PublicApiKey[]> {
  const rows = await db.select().from(apiKeys);
  return rows.map(toPublic);
}

export async function getKey(id: string): Promise<PublicApiKey | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);
  return row ? toPublic(row) : null;
}

export async function revokeKey(id: string): Promise<PublicApiKey | null> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning();
  return row ? toPublic(row) : null;
}

export async function updateKey(
  id: string,
  patch: UpdateKeyInput,
): Promise<PublicApiKey | null> {
  const [row] = await db
    .update(apiKeys)
    .set(patch)
    .where(eq(apiKeys.id, id))
    .returning();
  return row ? toPublic(row) : null;
}
