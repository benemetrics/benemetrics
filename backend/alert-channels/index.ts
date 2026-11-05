import type { AlertChannelType } from "../protocol/alerting";
import type { Notifier } from "./notifier";
import { emailNotifier } from "./email";
import { msTeamsNotifier } from "./msteams";
import { opsgenieNotifier } from "./opsgenie";
import { pagerDutyNotifier } from "./pagerduty";
import { rocketChatNotifier } from "./rocketchat";
import { slackNotifier } from "./slack";
import { victorOpsNotifier } from "./victorops";
import { webhookNotifier } from "./webhook";

export type { Notifier };
export type { AlertChannelType, AlertNotification } from "../protocol/alerting";

export {
  emailNotifier,
  msTeamsNotifier,
  opsgenieNotifier,
  pagerDutyNotifier,
  rocketChatNotifier,
  slackNotifier,
  victorOpsNotifier,
  webhookNotifier,
};

export const notifiers: Record<AlertChannelType, Notifier> = {
  webhook: webhookNotifier,
  slack: slackNotifier,
  rocketchat: rocketChatNotifier,
  email: emailNotifier,
  pagerduty: pagerDutyNotifier,
  opsgenie: opsgenieNotifier,
  msteams: msTeamsNotifier,
  victorops: victorOpsNotifier,
};

export function notifierFor(type: AlertChannelType): Notifier | undefined {
  return notifiers[type];
}
