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
    idSubscriber: process.env.BSRE_ID_SUBSCRIBER ?? '',
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

type ActivationResponse = {
  success: boolean;
  message: string | null;
  data: {
    message: string;
    totp: string;
    expires: string;
    result: boolean;
  } | null;
};

export async function refreshActivationTotp(
  current: string,
): Promise<TotpResult> {
  const r = await post<ActivationResponse>('/api/v2/seal/get/activation', {
    idSubscriber: env().idSubscriber,
    totp: current,
  });
  if (!r.success || !r.data?.result) {
    throw new Error(
      `BSrE activation TOTP failed: ${r.data?.message ?? r.message ?? 'unknown'}`,
    );
  }
  return { totp: r.data.totp, expires: r.data.expires };
}

type SealTotpResponse = {
  message: string;
  totp: string;
  expires: string;
  result: boolean;
};

export async function refreshSealTotp(
  activationTotp: string,
): Promise<TotpResult> {
  const r = await post<SealTotpResponse>('/api/v2/seal/get/totp', {
    idSubscriber: env().idSubscriber,
    totp: activationTotp,
    data: '1',
  });
  if (!r.result) throw new Error(`BSrE seal TOTP failed: ${r.message}`);
  return { totp: r.totp, expires: r.expires };
}

export type SealPdfArgs = {
  totp: string;
  sealConfig: SealConfig;
  /** base64 PDFs, request order */
  files: string[];
  /** base64 seal image; required when tampilan = VISIBLE */
  imageBase64?: string;
};

export type SealPdfResult = { time: number; file: string[] };

export function sealPdf({
  totp,
  sealConfig,
  files,
  imageBase64,
}: SealPdfArgs): Promise<SealPdfResult> {
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
    idSubscriber: env().idSubscriber,
    totp,
    signatureProperties,
    file: files,
  });
}

// ---------- TOTP chain ----------

export type TotpKind = 'ACTIVATION' | 'SEAL';
export type TotpRow = { totp: string; expiresAt: Date };

export type TotpDeps = {
  get(kind: TotpKind): Promise<TotpRow | null>;
  set(kind: TotpKind, row: TotpRow): Promise<void>;
  refreshActivationTotp: typeof refreshActivationTotp;
  refreshSealTotp: typeof refreshSealTotp;
  /** Called after a row was refreshed; the worker uses it to write a batch log. */
  onRefresh?: (kind: TotpKind) => Promise<void>;
  now?: () => Date;
};

/** BSrE returns `+0000`; Date.parse wants `+00:00`. */
export function parseBsreDate(s: string): Date {
  return new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

const VALIDITY_MARGIN_MS = 60_000;

function isValid(row: TotpRow | null, now: Date): boolean {
  return (
    !!row && row.expiresAt.getTime() > now.getTime() + VALIDITY_MARGIN_MS
  );
}

export async function getActivationTotp(deps: TotpDeps): Promise<string> {
  const now = deps.now?.() ?? new Date();
  const row = await deps.get('ACTIVATION');
  if (!row) throw new Error('BSRE_ACTIVATION_TOTP_NOT_SEEDED');
  if (isValid(row, now)) return row.totp;

  const fresh = await deps.refreshActivationTotp(row.totp);
  await deps.set('ACTIVATION', {
    totp: fresh.totp,
    expiresAt: parseBsreDate(fresh.expires),
  });
  await deps.onRefresh?.('ACTIVATION');
  return fresh.totp;
}

/** Seal TOTP is single-use: request a fresh one for every seal call, never persist it. */
export async function getSealTotp(deps: TotpDeps): Promise<string> {
  const activation = await getActivationTotp(deps);
  const fresh = await deps.refreshSealTotp(activation);
  await deps.onRefresh?.('SEAL');
  return fresh.totp;
}

export const dbTotpStore: Pick<TotpDeps, 'get' | 'set'> = {
  async get(kind) {
    const [row] = await db
      .select()
      .from(bsreTotp)
      .where(eq(bsreTotp.kind, kind));
    return row ? { totp: row.totp, expiresAt: row.expiresAt } : null;
  },
  async set(kind, { totp, expiresAt }) {
    await db
      .insert(bsreTotp)
      .values({ kind, totp, expiresAt })
      .onConflictDoUpdate({
        target: bsreTotp.kind,
        set: { totp, expiresAt, updatedAt: new Date() },
      });
  },
};
