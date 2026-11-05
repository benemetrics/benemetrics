import { encodeAuthorizationResponse, encodeUser } from "node_modules/@nats-io/jwt/lib/jwt";
import { processIngestedEvent } from "./alerting/evaluation";
import { verifyWithIdP } from "./auth";
import { parseIssueDigests } from "./issues/tracking";
import { nats, natsStream, TOPICS, CONSUMERS } from "./nats";
import type { BenemetricsEventMessage } from "./protocol/events";
import { recordReleaseFromEvent } from "./releases/tracking";
import { env } from "bun";
import { notifierFor } from "./alert-channels";
import { projectsAndAppsPermissions } from "./permissions/engine";
import type { NotificationDelivery } from "./protocol/notifications";

// Issues/alerts are one-shot and race-safe; release writes are idempotent,
// so retries never duplicate them.
async function applyEventMessage(event: BenemetricsEventMessage): Promise<void> {
  const digests = parseIssueDigests(event.issueEvents, event.envelopeItems);
  processIngestedEvent(
    event.appId,
    digests,
    event.receivedAt,
    event.id,
    event.projectId,
  );
  try {
    await recordReleaseFromEvent(event);
  } catch (err) {
    console.error(
      "[consumer] Failed to record release:",
      err instanceof Error ? err.message : err,
    );
  }
}

(async () => {
  for await (const message of await (await natsStream.consumers.get(TOPICS.EVENTS, CONSUMERS.EVENTS)).consume()) {
    try {
      const payload = message.string();
      // Handle batched events (JSONEachRow format)
      const lines = payload
        .split("\n")
        .filter((line) => line.trim().length > 0);
      for (const line of lines) {
        await applyEventMessage(JSON.parse(line) as BenemetricsEventMessage);
      }
      message.ack();
    } catch (err) {
      console.error(
        "[consumer] Failed to apply event side effects:",
        err instanceof Error ? err.message : err,
      );
      // Not acknowledged: the message is redelivered.
    }
  }
})();

// NOTIFICATIONS
(async () => {
  for await (const message of await (await natsStream.consumers.get(TOPICS.NOTIFY, CONSUMERS.NOTIFICATIONS)).consume()) {
    try {
      const { channel, notification } = message.json() as NotificationDelivery;
      const notifier = notifierFor(channel.type);
      if (!notifier) throw "NO NOTIFIER PLATFORM";
      await notifier.send(notification, channel.config);
      message.ack();
    } catch (err) {
      console.error("[NOTIFICATION] Failed to apply event side effects:", err instanceof Error ? err.message : err);
      message.nak(60_000 * 2 ** Math.max(0, message.info.deliveryCount - 1))
    }
  }
})();


// AUTH CALLOUT
(async () => {
  if (!env.NATS_AUTH_KEY_SEED) throw "SET NATS AUTH KEY SEED";
  for await (const msg of nats.subscribe("$SYS.REQ.USER.AUTH", { queue: "auth-callout" })) {
      try {
        const json = msg.json() as any;
        console.log(json);
        
        if (json.nats.type !== "authorization_request") return;
  
        const user = await verifyWithIdP(json.nats.auth_token);
        if (!user) return;

        const { perms } = await projectsAndAppsPermissions({ user });
        
        const userJwt = await encodeUser(
          "live-feed",
          json.nats.user_nkey,
          env.NATS_AUTH_KEY_SEED!,
          {
            sub: { allow: perms.projectIds.map((pId) => `${pId}.*`) },
            pub: { allow: [] },
            subs: -1,
            data: -1,
            payload: -1,
          },
          { aud: '$G', exp: Math.floor(Date.now() / 1000) + 300 },
        );
  
        msg.respond(
          await encodeAuthorizationResponse(
          json.nats.user_nkey,
          json.server_id,
          env.NATS_AUTH_KEY_SEED!,
          { jwt: userJwt },
          {},
        )
      )
      } catch (error) {
        console.error(
            "[auth-callout] Failed to answer an authorization request:",
            error instanceof Error ? error.message : error,
          )
      }
  }
})();