interface ItemHeader {
  type: "event" | "transaction" | "span" | "session" | "profile" | "replay_event" | "check_in" | "user_feedback";
  content_type: string;
  length: number;
  filename?: string;
}

export type { ItemHeader };