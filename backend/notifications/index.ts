import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { dismissDeadLetter, listDeadLetters } from "../nats";

// The admin surface of the notification DLQ: the entries live in JetStream
// (not Postgres), so a poll answers the current stream window and a dismiss
// deletes the message in place. DELETE is idempotent — an already-dismissed
// seq answers success.
export const notificationRoutes = new Elysia({
  prefix: "/api/admin/notifications",
})
  .get(
    "/dlq",
    ({ query: { limit } }) => {
      const entries = limit
        ? listDeadLetters(Math.min(limit, 200))
        : listDeadLetters();
      return entries.then((data) => ({ data }));
    },
    { query: arktype({ limit: "string.integer.parse?" }) },
  )
  .delete(
    "/dlq/:seq",
    async ({ params: { seq } }) => {
      const dismissed = await dismissDeadLetter(Number(seq));
      return { dismissed };
    },
    { params: arktype({ seq: "string.numeric" }) },
  );
