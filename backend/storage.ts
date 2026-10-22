import { S3Client } from "bun";

// The object store is S3-required: there is no local-disk fallback. An
// unset `S3_REGION` must not shadow `AWS_REGION`, so it is left unset.
export const s3 = new S3Client({
  bucket: process.env.S3_BUCKET,
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
});

// Without a bucket every write fails and every replay stays inline.
export function assertStorageConfigured(): void {
  if (!process.env.S3_BUCKET) {
    throw new Error(
      "S3_BUCKET is required: the object store has no local fallback",
    );
  }
}
