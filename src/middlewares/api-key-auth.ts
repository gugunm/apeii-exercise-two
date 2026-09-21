import type { MiddlewareHandler } from 'hono';
import {
  verifyKey as defaultVerifyKey,
  type ApiKeyContext,
} from '../modules/api-key/service.js';

export function apiKeyAuth(
  deps: {
    verifyKey?: (token: string) => Promise<ApiKeyContext | null>;
  } = {},
): MiddlewareHandler<{ Variables: { apiKey: ApiKeyContext } }> {
  const verify = deps.verifyKey ?? defaultVerifyKey;
  return async (c, next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    const ctx = await verify(token);
    if (!ctx) return c.json({ error: 'Unauthorized' }, 401);
    c.set('apiKey', ctx);
    await next();
  };
}
