import { customType } from "drizzle-orm/pg-core";

// A `timestamptz` column the application reads and writes as an ISO-8601 UTC string.
export const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType() {
    return "timestamp with time zone";
  },
  fromDriver(value: unknown): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value as string).toISOString();
  },
  toDriver(value: string): string {
    return value;
  },
});
