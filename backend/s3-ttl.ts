import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  type GetBucketLifecycleConfigurationCommandOutput,
} from "@aws-sdk/client-s3";

// A second S3 client, purpose-built for bucket lifecycle (TTL) management.
// The object-store client in storage.ts (bun's built-in S3Client) handles
// object reads/writes; the AWS SDK client here is used only for bucket
// lifecycle configuration — bun's client exposes no lifecycle API.
const s3Ttl = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  // Bun-compatible / RustFS / MinIO endpoints are not AWS; path-style is
  // required so the bucket is addressed in the URL path, not as a subdomain.
  forcePathStyle: true,
});

export interface S3Ttl {
  bucket: string | null;
  ttlDays: number | null;
  /** Populated when the S3 credentials cannot manage bucket lifecycle. */
  error: string | null;
}

const NO_PERMISSION_ERROR =
  "The S3 access keys do not have permission to change the S3 bucket TTL " +
  "(lifecycle configuration). Update S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY " +
  "with s3:PutBucketLifecycleConfiguration and s3:GetBucketLifecycleConfiguration.";

/** The one lifecycle rule id used for retention expiration. */
const RETENTION_RULE_ID = "benemetrics-retention";

function toDays(amount: number, unit: "day" | "week" | "month" | "year"): number {
  const factors: Record<"day" | "week" | "month" | "year", number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  return amount * factors[unit];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAccessDenied(err: any): boolean {
  return (
    err?.name === "AccessDenied" ||
    err?.Code === "AccessDenied" ||
    err?.$metadata?.httpStatusCode === 403
  );
}

export async function readBucketTtl(): Promise<S3Ttl> {
  if (!process.env.S3_BUCKET) {
    return { bucket: null, ttlDays: null, error: null };
  }
  try {
    const output = await s3Ttl.send(
      new GetBucketLifecycleConfigurationCommand({
        Bucket: process.env.S3_BUCKET,
      }),
    ) as GetBucketLifecycleConfigurationCommandOutput;
    const rules = output.Rules ?? [];
    const retention = rules.find((r) => r.ID === RETENTION_RULE_ID);
    const days =
      retention?.Expiration?.Days ??
      (rules.length > 0 ? rules[0]!.Expiration?.Days : null);
    return {
      bucket: process.env.S3_BUCKET,
      ttlDays: days ?? null,
      error: null,
    };
  } catch (err: any) {
    // No lifecycle configuration is configured: equivalent to no TTL.
    if (
      err?.name === "NoSuchLifecycleConfiguration" ||
      err?.Code === "NoSuchLifecycleConfiguration"
    ) {
      return { bucket: process.env.S3_BUCKET, ttlDays: null, error: null };
    }
    // Access denied: the credentials cannot manage bucket lifecycle.
    if (isAccessDenied(err)) {
      return {
        bucket: process.env.S3_BUCKET,
        ttlDays: null,
        error: NO_PERMISSION_ERROR,
      };
    }
    return {
      bucket: process.env.S3_BUCKET,
      ttlDays: null,
      error: err?.message ?? "Failed to read the S3 bucket TTL.",
    };
  }
}

export async function setBucketTtl(
  amount: number,
  unit: "day" | "week" | "month" | "year",
): Promise<S3Ttl> {
  if (!process.env.S3_BUCKET) {
    return { bucket: null, ttlDays: null, error: null };
  }
  const days = amount <= 0 ? 0 : toDays(amount, unit);
  try {
    if (days <= 0) {
      // Remove the retention rule by deleting the lifecycle configuration.
      await s3Ttl.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: process.env.S3_BUCKET,
          LifecycleConfiguration: { Rules: [] },
        }),
      );
      return { bucket: process.env.S3_BUCKET, ttlDays: null, error: null };
    }
    await s3Ttl.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: process.env.S3_BUCKET,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: RETENTION_RULE_ID,
              Status: "Enabled",
              Filter: { Prefix: "" },
              Expiration: { Days: days },
            },
          ],
        },
      }),
    );
    return { bucket: process.env.S3_BUCKET, ttlDays: days, error: null };
  } catch (err: any) {
    if (isAccessDenied(err)) {
      return {
        bucket: process.env.S3_BUCKET,
        ttlDays: null,
        error: NO_PERMISSION_ERROR,
      };
    }
    return {
      bucket: process.env.S3_BUCKET,
      ttlDays: null,
      error: err?.message ?? "Failed to set the S3 bucket TTL.",
    };
  }
}
