import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';

export function adminAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.ADMIN_API_KEY;
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!expected || !token) return c.json({ error: 'Unauthorized' }, 401);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
