# Alerting — Open Items

**Status:** Tracking — items from `docs/alerting.md` §13.

---

## Notifiers

- [x] Email notifier implementation (SMTP via nodemailer or similar)
- [x] PagerDuty notifier
- [x] Opsgenie notifier
- [x] Microsoft Teams notifier
- [x] VictorOps notifier
- [x] Webhook signature / secret validation (HMAC) — a webhook channel with a `secret` signs the body (HMAC-SHA256, the Sentry scheme); `backend/alerting/webhook-signature.ts` signs and verifies.

## Rule Expressiveness

- [ ] Alert rule templating (variables in notification message)
- [x] Per-environment rules — the alerting model has **no environment scope**: it is global → project → app. The project scope landed with the project-scoped channels and rules.
- [ ] Metric alert on `event_count` with `lt` operator for "traffic drop" detection
- [ ] Dynamic threshold (e.g., "3x baseline") instead of static threshold

## Incident Management

- [ ] Incident acknowledgment / assignment workflow
- [ ] Alert rule versioning / audit log
- [ ] Correlation: group related incidents under one parent
- [ ] Silencing / maintenance windows
- [ ] Notification deduplication across rules (same root cause)

## UI / Organization

- [ ] Rule grouping / folders for UI organization
- [ ] Rule migration tooling (import/export JSON/YAML)

## Reliability / Performance

- [ ] ClickHouse query retry / circuit breaker for evaluation
- [ ] Sweeper parallelism (currently serial over apps)
- [ ] Backpressure handling when notification volume spikes
- [ ] Dead letter queue for failed deliveries (retry with backoff)

## Observability

- [ ] Alerting metrics (rules evaluated, incidents fired, delivery success/failure rates)
- [ ] Structured logging for evaluation decisions (breach/no-breach, cooldown skip)