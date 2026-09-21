import { z } from 'zod';
import { isValidScopeGrant } from '../../middlewares/scopes.js';

const scopes = z
  .array(z.string())
  .min(1)
  .refine((arr) => arr.every(isValidScopeGrant), {
    message: 'contains an unknown scope',
  });

export const CreateKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes,
  expiresAt: z.iso
    .datetime()
    .nullish()
    .transform((v) => (v ? new Date(v) : null)),
});

export const UpdateKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: scopes.optional(),
});

export type CreateKeyInput = z.infer<typeof CreateKeySchema>;
export type UpdateKeyInput = z.infer<typeof UpdateKeySchema>;
