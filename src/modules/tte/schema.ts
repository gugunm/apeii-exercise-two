import { z } from 'zod';

export const tteSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'inactive']),
  label: z.string().min(1),
});

export const tteListSchema = z.object({
  data: z.array(tteSchema),
});

export type TteJob = {
  tteId: string;
};

export type Tte = z.infer<typeof tteSchema>;
