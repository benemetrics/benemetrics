import type {
  AlertChannelType,
  AlertNotification,
} from "../protocol/alerting";

export interface Notifier {
  readonly type: AlertChannelType;
  send(
    notification: AlertNotification,
    config: Record<string, unknown>,
  ): Promise<void>;
}
