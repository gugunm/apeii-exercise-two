import { Hono } from 'hono';

import { getTte, getTtes } from './handler.js';

export const tteRoute = new Hono();

tteRoute.get('/', getTtes);
tteRoute.get('/:id', getTte);
