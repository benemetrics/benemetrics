import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface IssueOccurrence {
  messageId: string;
  eventId: string;
  receivedAt: string;
  title: string;
  level: string;
  release: string | null;
  environment: string | null;
  user: string | null;
}

export function useIssueEvents(issueId: string | undefined, limit = 6) {
  const [events, setEvents] = useState<IssueOccurrence[] | null>(null);

  useEffect(() => {
    if (!issueId) return;
    let alive = true;
    api["api/admin/issues"][issueId].events
      .get({ query: { limit } })
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive || res.error) return;
        setEvents((res.data as { data: IssueOccurrence[] }).data);
      });
    return () => {
      alive = false;
    };
  }, [issueId, limit]);

  return { events };
}
