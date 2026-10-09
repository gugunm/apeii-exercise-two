import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { bsreTotp } from '../db/schema/e-seal.schema.js';
import type { SealConfig } from '../modules/e-seal/schema.js';

// ---------- HTTP ----------

function env() {
  return {
    baseUrl: process.env.BSRE_BASE_URL ?? '',
    username: process.env.BSRE_USERNAME ?? '',
    password: process.env.BSRE_PASSWORD ?? '',
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { baseUrl, username, password } = env();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:
        'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`BSrE ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export type TotpResult = { totp: string; expires: string };

type SealTotpResponse = {
  message: string;
  totp: string;
  expires: string;
  result: boolean;
};

export async function refreshSealTotp(
  idSubscriber: string,
  activationTotp: string,
): Promise<TotpResult> {
  const r = await post<SealTotpResponse>('/api/v2/seal/get/totp', {
    idSubscriber,
    totp: activationTotp,
    data: '1',
  });
  if (!r.result) throw new Error(`BSrE seal TOTP failed: ${r.message}`);
  return { totp: r.totp, expires: r.expires };
}

export type SealPdfArgs = {
  /** `bsre_totp.id_subscriber` of the activation row the seal TOTP was issued for */
  idSubscriber: string;
  totp: string;
  sealConfig: SealConfig;
  /** base64 PDFs, request order */
  files: string[];
  /** base64 seal image; required when tampilan = VISIBLE */
  imageBase64?: string;
};

export type SealPdfResult = { time: number; file: string[] };

export async function sealPdf({
  idSubscriber,
  totp,
  sealConfig,
  files,
  imageBase64,
}: SealPdfArgs): Promise<SealPdfResult> {
  if (sealConfig.tampilan === 'VISIBLE' && !imageBase64) {
    throw new Error('VISIBLE seal requires imageBase64');
  }
  const signatureProperties =
    sealConfig.tampilan === 'INVISIBLE'
      ? [
          {
            tampilan: 'INVISIBLE',
            location: 'null',
            reason: sealConfig.reason,
            contactInfo: 'null',
          },
        ]
      : [
          {
            imageBase64,
            tampilan: 'VISIBLE',
            page: sealConfig.page,
            originX: sealConfig.originX,
            originY: sealConfig.originY,
            width: sealConfig.width,
            height: sealConfig.height,
            location: sealConfig.location,
            reason: sealConfig.reason,
          },
        ];
  return post<SealPdfResult>('/api/v2/seal/pdf', {
    idSubscriber,
    totp,
    signatureProperties,
    file: files,
  });
}

// ---------- TOTP chain ----------

export type ActivationRow = { totp: string; idSubscriber: string | null };

export type TotpDeps = {
  /** Activation row is provisioned outside this system (`bsre_totp`); null when absent. */
  getActivation(): Promise<ActivationRow | null>;
  refreshSealTotp: typeof refreshSealTotp;
  /** Called after a seal TOTP was issued; the worker uses it to write a batch log. */
  onRefresh?: () => Promise<void>;
};

export type SealTotp = { totp: string; idSubscriber: string };

/** Seal TOTP is single-use: request a fresh one for every seal call, never persist it. */
export async function getSealTotp(deps: TotpDeps): Promise<SealTotp> {
  const activation = await deps.getActivation();
  if (!activation) throw new Error('BSRE_ACTIVATION_TOTP_NOT_SEEDED');
  const { idSubscriber } = activation;
  if (!idSubscriber) {
    throw new Error('BSRE_ACTIVATION_ID_SUBSCRIBER_NOT_SEEDED');
  }
  const fresh = await deps.refreshSealTotp(idSubscriber, activation.totp);
  await deps.onRefresh?.();
  return { totp: fresh.totp, idSubscriber };
}

export async function dbActivation(): Promise<ActivationRow | null> {
  const [row] = await db
    .select()
    .from(bsreTotp)
    .where(eq(bsreTotp.kind, 'ACTIVATION'));
  return row ? { totp: row.totp, idSubscriber: row.idSubscriber } : null;
}
