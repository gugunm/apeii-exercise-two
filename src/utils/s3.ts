import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const bucket = process.env.S3_BUCKET ?? '';
const endpoint = process.env.S3_ENDPOINT;
// Garage, MinIO and other S3-compatible stores need path-style URLs.
// Defaults to true whenever a custom endpoint is set.
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE
  ? process.env.S3_FORCE_PATH_STYLE === 'true'
  : !!endpoint;
// e.g. "AES256"; leave empty for stores without SSE support (Garage).
const serverSideEncryption = (process.env.S3_SERVER_SIDE_ENCRYPTION ||
  undefined) as ServerSideEncryption | undefined;

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle,
  ...(endpoint ? { endpoint } : {}),
});

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(serverSideEncryption
        ? { ServerSideEncryption: serverSideEncryption }
        : {}),
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export function presignGet(key: string, ttlSeconds: number): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSeconds,
  });
}
