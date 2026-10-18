# Alerting — Open Items

**Status:** Tracking — items from `docs/alerting.md` §13.

---

## Notifiers

- [ ] Email notifier implementation (SMTP via nodemailer or similar)
- [ ] PagerDuty notifier
- [ ] Opsgenie notifier
- [ ] Microsoft Teams notifier
- [ ] VictorOps notifier
- [ ] Webhook signature / secret validation (HMAC)

## Rule Expressiveness

- [ ] Alert rule templating (variables in notification message)
- [ ] Per-environment rules (currently app-scoped only; environments are shared)
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