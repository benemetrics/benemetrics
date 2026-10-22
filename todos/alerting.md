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

- [x] Alert rule templating (variables in notification message) — a rule's `message` template renders `{{rule.name}}`, `{{metric}}`, `{{value}}`, `{{threshold}}`, `{{operator}}`, `{{windowSeconds}}` and `{{appId}}`
- [x] Per-environment rules — the alerting model has **no environment scope**: it is global → project → app. The project scope landed with the project-scoped channels and rules.
- [x] Metric alert on `event_count` with `lt` operator for "traffic drop" detection — the metric and the operator are available in the builder and covered by a test
- [ ] Dynamic threshold (e.g., "3x baseline") instead of static threshold

## Incident Management

- [x] Incident acknowledgment / assignment workflow — `POST /api/admin/alerting/incidents/:id/acknowledge` (the admin id is recorded) and `POST /api/admin/alerting/incidents/:id/assign`; the alerts page lists the incidents with both actions
- [ ] Alert rule versioning / audit log
- [ ] Correlation: group related incidents under one parent
- [ ] Silencing / maintenance windows
- [ ] Notification deduplication across rules (same root cause)

## UI / Organization

- [ ] Rule grouping / folders for UI organization
- [ ] Rule migration tooling (import/export JSON/YAML)

## Reliability / Performance

- [x] ClickHouse query retry / circuit breaker for evaluation — the reads are retried with a backoff and repeated transient failures open a circuit: the queries fail fast and the sweep is skipped until it closes
- [x] Sweeper parallelism (currently serial over apps) — the apps and the project-scoped rules are evaluated with a bounded concurrency (`ALERT_SWEEPER_CONCURRENCY`)
- [x] Backpressure handling when notification volume spikes — the deliveries go through a bounded queue (`ALERT_DELIVERY_QUEUE_SIZE`) with a bounded number of workers (`ALERT_DELIVERY_CONCURRENCY`); what cannot be queued is refused
- [x] Dead letter queue for failed deliveries (retry with backoff) — a failed delivery is recorded in `alert_dead_letters` and retried with an exponential backoff; the queue is read, retried and emptied through the admin API

## Observability

- [x] Alerting metrics (rules evaluated, incidents fired, delivery success/failure rates) — `GET /api/admin/alerting/stats` (the rules evaluated, the incidents fired and resolved, the deliveries succeeded and failed, the cooldowns skipped)
- [x] Structured logging for evaluation decisions (breach/no-breach, cooldown skip) — one JSON line per decision (`component: "alerting"`)