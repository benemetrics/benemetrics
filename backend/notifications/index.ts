import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { manager, natsStream } from "../nats";

export const notificationRoutes = new Elysia({
  prefix: "/api/admin/notifications",
})
  .get(
    "/dlq",
    async ({ query: { limit, cursor } }) => {
      try {
        const info = await (await natsStream.streams.get('DLQ')).info();
        const z = await manager.direct.getBatch('DLQ', { seq: cursor ?? (info.state.last_seq - (limit ?? 20)), batch: limit ?? 20 })
        const v = await Array.fromAsync(z);
        v[0]?.json()
      } catch (e) {
        console.log(e);
        return [];
      }
    },
    { query: arktype({
      cursor: "string.integer.parse?", 
      limit: "string.integer.parse?"
    }) },
  )
  .delete(
    "/dlq/:seq",
    async ({ params: { seq } }) => (await manager.streams.get('DLQ')).deleteMessage(seq, true),
    { params: arktype({ seq: "string.numeric.parse" }) },
  );
