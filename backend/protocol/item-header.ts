interface ItemHeader {
  type: "event" | "transaction" | "span" | "session" | "profile" | "replay_event" | "check_in" | "feedback" | "user_feedback";
  content_type: string;
  length: number;
  filename?: string;
}

export type { ItemHeader };
