import { useEffect, useRef } from "react";
import { feedCredential } from "../lib/api";
import { subscribeJsonSubject } from "../lib/live-events";

export interface AppLiveMessage {
  subject: string;
  payload: Record<string, unknown>;
}

/**
 * Subscribes to the app's NATS issues and events subjects
 * (`<projectId>.<appId>.issues`, `<projectId>.<appId>.events`) and delivers
 * each JSON message as it arrives. The OIDC bearer token is sent to NATS as
 * the CONNECT `auth_token` so the auth callout can verify it.
 */
export function useAppLiveFeed({
  projectId,
  appId,
  onMessage,
}: {
  projectId: string;
  appId: string;
  onMessage: (message: AppLiveMessage) => void;
}) {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!projectId || !appId) return;

    const subjects = [
      `${projectId}.${appId}.issues`,
      `${projectId}.${appId}.events`,
    ];

    const closes = subjects.map((subject) =>
      subscribeJsonSubject(
        subject,
        {
          onMessage: (payload) => {
            if (
              typeof payload === "object" &&
              payload !== null &&
              !Array.isArray(payload)
            ) {
              handler.current({
                subject,
                payload: payload as Record<string, unknown>,
              });
            }
          },
        },
        { authToken: feedCredential() ?? undefined },
      ),
    );

    return () => {
      for (const close of closes) close();
    };
  }, [projectId, appId]);
}
