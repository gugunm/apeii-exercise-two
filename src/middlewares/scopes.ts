import type { MiddlewareHandler } from 'hono';
import type { ApiKeyContext } from '../modules/api-key/service.js';

export const KNOWN_SCOPES = [
  'eseal:read',
  'eseal:write',
  'docsummary:read',
  'docsummary:write',
] as const;

const KNOWN_RESOURCES = ['eseal', 'docsummary'];

export function scopeSatisfies(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const resource = required.split(':')[0];
  return granted.includes(`${resource}:*`);
}

export function isValidScopeGrant(scope: string): boolean {
  if (scope === '*') return true;
  if ((KNOWN_SCOPES as readonly string[]).includes(scope)) return true;
  const m = /^([a-z]+):\*$/.exec(scope);
  return m !== null && KNOWN_RESOURCES.includes(m[1]);
}

export function requireScope(
  required: string,
): MiddlewareHandler<{ Variables: { apiKey: ApiKeyContext } }> {
  return async (c, next) => {
    const { scopes } = c.get('apiKey');
    if (!scopeSatisfies(scopes, required)) {
      return c.json({ error: 'Forbidden', missingScope: required }, 403);
    }
    await next();
  };
}
