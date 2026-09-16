import z from 'zod';

const MAX_FILES = Number(process.env.ESEAL_MAX_FILES ?? 20);
const MAX_FILE_BYTES = Number(process.env.ESEAL_MAX_FILE_BYTES ?? 10_485_760);

const PdfFile = z.file().mime(['application/pdf']).max(MAX_FILE_BYTES);

const base = {
  'files[]': z.array(PdfFile).min(1).max(MAX_FILES),
  userId: z.string().min(1),
  reason: z.string().default('null'),
};

export const CreateEsealSchema = z.discriminatedUnion('tampilan', [
  z.object({ ...base, tampilan: z.literal('INVISIBLE') }),
  z.object({
    ...base,
    tampilan: z.literal('VISIBLE'),
    page: z.coerce.number().int().min(1),
    originX: z.coerce.number(),
    originY: z.coerce.number(),
    width: z.coerce.number(),
    height: z.coerce.number(),
    location: z.string().min(1),
  }),
]);

export type CreateEsealInput = z.infer<typeof CreateEsealSchema>;

export type SealConfig =
  | { tampilan: 'INVISIBLE'; reason: string }
  | {
      tampilan: 'VISIBLE';
      reason: string;
      page: number;
      originX: number;
      originY: number;
      width: number;
      height: number;
      location: string;
    };

/** Everything the worker needs to build BSrE `signatureProperties`; no files, no userId. */
export function toSealConfig(input: CreateEsealInput): SealConfig {
  if (input.tampilan === 'INVISIBLE') {
    return { tampilan: 'INVISIBLE', reason: input.reason };
  }
  const { page, originX, originY, width, height, location, reason } = input;
  return {
    tampilan: 'VISIBLE',
    reason,
    page,
    originX,
    originY,
    width,
    height,
    location,
  };
}

/** Payload put on the queue — identifiers only. */
export type EsealJobPayload = { batchId: string };
