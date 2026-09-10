import type { Tte, TteJob } from './schema.js';
import { Queue } from 'bullmq';
import { redisConnection } from '../../lib/queue.js';

const ttes: Tte[] = [
  {
    id: 'tte-001',
    status: 'active',
    label: 'Primary TTE',
  },
];

export function listTtes(): Tte[] {
  return ttes;
}

export function findTte(id: string): Tte | undefined {
  return ttes.find((tte) => tte.id === id);
}

export const tteQueue = new Queue<TteJob>('tte', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1_000,
    },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});
