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
- [x] Dynamic threshold (e.g., "3x baseline") instead of static threshold — `alert_rules.threshold_factor` (real, nullable); when set, the sweeper compares the windowed value against `factor × baseline`, where the baseline is the per-window average of the same metric over the history preceding the evaluation window (`ALERT_BASELINE_SECONDS`, default 24h; latency rules use the history quantile). The evaluation skips (`no_baseline`) while the history is empty, the API requires a static threshold or a factor, and the builder has a dynamic/static toggle. Incident and notification carry the effective threshold.

## Incident Management

- [x] Incident acknowledgment / assignment workflow — `POST /api/admin/alerting/incidents/:id/acknowledge` (the admin id is recorded) and `POST /api/admin/alerting/incidents/:id/assign`; the alerts page lists the incidents with both actions
- [x] Alert rule versioning / audit log — every change is recorded in `alert_rule_history` (the actor, the action, the state) and read through `GET /api/admin/alerting/rules/:id/history`
- [x] Correlation: group related incidents under one parent — an incident carries the `correlationKey` (the scope and the metric) and the `parentId` of the group's first incident
- [x] Silencing / maintenance windows — a silence covers a scope (global, a project or an app) for a window; the rules in it do not fire while it is active
- [x] Notification deduplication across rules (same root cause) — a root cause reported in the last `ALERT_DEDUP_WINDOW_MS` is not reported again, whichever rule noticed it

## UI / Organization

- [ ] Rule grouping / folders for UI organization
- [x] Rule migration tooling (import/export JSON/YAML) — `GET /api/admin/alerting/export` and `POST /api/admin/alerting/import` (the channels travel by name)

## Reliability / Performance

- [x] ClickHouse query retry / circuit breaker for evaluation — the reads are retried with a backoff and repeated transient failures open a circuit: the queries fail fast and the sweep is skipped until it closes
- [x] Sweeper parallelism (currently serial over apps) — the apps and the project-scoped rules are evaluated with a bounded concurrency (`ALERT_SWEEPER_CONCURRENCY`)
- [x] Backpressure handling when notification volume spikes — the deliveries go through a bounded queue (`ALERT_DELIVERY_QUEUE_SIZE`) with a bounded number of workers (`ALERT_DELIVERY_CONCURRENCY`); what cannot be queued is refused
- [x] Dead letter queue for failed deliveries (retry with backoff) — a failed delivery is recorded in `alert_dead_letters` and retried with an exponential backoff; the queue is read, retried and emptied through the admin API

## Observability

- [x] Alerting metrics (rules evaluated, incidents fired, delivery success/failure rates) — `GET /api/admin/alerting/stats` (the rules evaluated, the incidents fired and resolved, the deliveries succeeded and failed, the cooldowns skipped)
- [x] Structured logging for evaluation decisions (breach/no-breach, cooldown skip) — one JSON line per decision (`component: "alerting"`)