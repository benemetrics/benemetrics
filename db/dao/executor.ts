import { db } from "db";

/**
 * A query executor: the default connection, or the transaction handle a
 * caller opened to make several writes atomic.
 */
export type Executor = Pick<
  typeof db,
  "insert" | "update" | "select" | "delete"
>;
