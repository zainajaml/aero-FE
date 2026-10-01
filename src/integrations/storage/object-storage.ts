import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";

/** Logical areas of the single private bucket (each maps to a key prefix). */
export type StorageArea = "avatars" | "attachments" | "document-images" | "documents" | "support";

const client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

const objectKey = (area: StorageArea, key: string) => `${area}/${key}`;

export async function putObject(
  area: StorageArea,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey(area, key),
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=3600",
    }),
  );
}

/** Short-lived download URL; `downloadName` forces an attachment disposition with that filename. */
export async function signedDownloadUrl(
  area: StorageArea,
  key: string,
  downloadName?: string,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey(area, key),
      ...(downloadName
        ? {
            ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
          }
        : {}),
    }),
    { expiresIn: env.FILE_URL_TTL_SECONDS },
  );
}

export async function deleteObjects(area: StorageArea, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await client.send(
    new DeleteObjectsCommand({
      Bucket: env.S3_BUCKET,
      Delete: { Objects: keys.map((key) => ({ Key: objectKey(area, key) })), Quiet: true },
    }),
  );
}

/** Streams an object (for same-origin previews such as PDF.js). */
export async function getObjectStream(area: StorageArea, key: string) {
  const result = await client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey(area, key) }),
  );
  return {
    body: result.Body as NodeJS.ReadableStream,
    contentType: result.ContentType,
    contentLength: result.ContentLength,
  };
}

/** Creates the bucket when missing (local development and tests; production buckets are provisioned). */
export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}
