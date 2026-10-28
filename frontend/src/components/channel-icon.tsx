import { Hash, Mail, Siren, Webhook, MessageCircle } from "lucide-react";
import type { ChannelType } from "../lib/data";

const icons = { slack: Hash, email: Mail, pagerduty: Siren, webhook: Webhook, discord: MessageCircle };

export function ChannelIcon({ type }: { type: ChannelType }) {
  const I = icons[type];
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
      <I className="h-4 w-4" />
    </span>
  );
}
