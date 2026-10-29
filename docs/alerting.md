# Alerting — Architecture

**Status:** Design paper — the alerting system (rules, channels, evaluation, delivery).

> **Note:** This document describes the **target Sentry-compatible model** (project/environment-scoped). The current implementation is **app-scoped** — see [Current Implementation vs Target](#current-implementation-vs-target) at the end.

---

## 1. Model in One Paragraph

The alerting system lets admins configure **channels** (delivery endpoints) and **rules** (trigger conditions) at the **project** and **environment** level. Rules fire on **metric thresholds** (evaluated by a periodic sweeper) or **issue-state transitions** (new issue / regression, fired exactly once from the ingestion path). When a rule breaches, a uniform notification is delivered to its channels, an **incident** is recorded, and a **cooldown** suppresses re-notification until the metric recovers (threshold rules) or the per-issue cooldown elapses (issue triggers). Metric samples live in ClickHouse; issues and alert config live in Postgres; NATS connects ingestion to both.

---

## 2. Trigger Taxonomy

| Trigger      | Source                            | Evaluation                                                   | Cooldown                                                                                         | Incident Lifecycle                                                             |
| ------------ | --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `threshold`  | Metric sweeper                    | Periodic (every `ALERT_EVALUATION_INTERVAL_MS`, default 60s) | Per-rule (`cooldownSeconds`); suppresses re-notification for the cooldown period after a trigger | `firing` while breaching → `resolved` when metric recovers (via `resolveOpen`) |
| `new_issue`  | Ingestion (`trackIssuesForEvent`) | Immediate, once per fingerprint                              | Per-issue, per-rule (`cooldownSeconds`); recorded `resolved` immediately                         | One-shot: `resolved` at creation (nothing to recover)                          |
| `regression` | Ingestion (`trackIssuesForEvent`) | Immediate, once per fingerprint                              | Per-issue, per-rule (`cooldownSeconds`); recorded `resolved` immediately                         | One-shot: `resolved` at creation                                               |

---

## 3. Metrics

All threshold metrics are computed from **ClickHouse metric samples** (sentinel counts and measurement quantiles), except `new_issue_count` which is counted in Postgres (`issues` table). A ClickHouse failure rejects the evaluation — the work queue logs it and the tick is skipped, so a CH outage pauses alerting instead of firing on zeros.

| Metric            | Source              | Description                            |
| ----------------- | ------------------- | -------------------------------------- |
| `event_count`     | ClickHouse sentinel | Total events ingested                  |
| `error_count`     | ClickHouse sentinel | Events with level = `error`            |
| `fatal_count`     | ClickHouse sentinel | Events with level = `fatal`            |
| `new_issue_count` | Postgres (`issues`) | Distinct new fingerprints in window    |
| `latency_p95`     | ClickHouse quantile | 95th percentile of measurement samples |
| `latency_p99`     | ClickHouse quantile | 99th percentile of measurement samples |

**Measurement name** for latency metrics (`latency_p95`, `latency_p99`) defaults to `duration` (from transaction `measurements.duration.value`). Configurable per rule via `measurement` field. Other metrics ignore this field.

---

## 4. Configuration Model (Target: Sentry-Compatible)

### Scopes

Rules and channels are scoped to **Project** and **Environment** — not App.

| Scope                                                   | Description                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Project** (`projectId`, `environmentId = NULL`)       | Applies to all environments in the project. Baseline rules.                  |
| **Environment** (`projectId`, `environmentId = <uuid>`) | Applies only to that environment. Overrides project-level rules **by name**. |

**Override semantics (per-name):** An environment-scoped row with the same `name` replaces the project-scoped row; other project-scoped rows still apply. This mirrors the current global/app override logic but at project/env granularity.

### Channels

A channel is a delivery endpoint. Scoped to project or environment.

**Types & config shapes** (validated at send time, not at create time):

| Type         | Config Keys                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `webhook`    | `url` (required), `headers?` (Record<string, string>), `secret?` (HMAC signing key) |
| `slack`      | `webhookUrl` **OR** `token` + `channel`                                             |
| `rocketchat` | `webhookUrl`                                                                        |
| `email`      | `host`, `port`, `secure`, `auth: { user, pass }`, `from`, `to`                      |
| `pagerduty`  | `routing_key` (required), `severity?`, `custom_details?`                            |
| `opsgenie`   | `api_key` (required), `priority?`, `responders?`, `tags?`                           |
| `msteams`    | `webhookUrl` (required)                                                             |
| `victorops`  | `api_key`, `routing_key`, `message_type?`, `entity_display_name?`                   |

### Rules

A rule defines a trigger condition and its notification targets.

**Fields**:

| Field             | Threshold Rules                                    | Issue Triggers (`new_issue`, `regression`) |
| ----------------- | -------------------------------------------------- | ------------------------------------------ |
| `trigger`         | `"threshold"`                                      | `"new_issue"` / `"regression"`             |
| `metric`          | Required (one of 6)                                | `null`                                     |
| `operator`        | Required (`gt` / `lt`)                             | `null`                                     |
| `threshold`       | Required unless `thresholdFactor` is set           | `null`                                     |
| `thresholdFactor` | Optional (> 0, dynamic threshold; `null` = static) | `null`                                     |
| `windowSeconds`   | Required (> 0)                                     | `null`                                     |
| `measurement`     | Optional (string, default `duration`)              | `null`                                     |
| `folder`          | Optional (string, UI grouping; `null` = ungrouped) | Optional                                   |
| `cooldownSeconds` | Optional (default 3600)                            | Optional (default 3600)                    |
| `channelIds`      | Optional (array of channel IDs)                    | Optional                                   |
| `isEnabled`       | Optional (default `true`)                          | Optional (default `true`)                  |
| `filters`         | Optional (tag filters, see below)                  | Optional                                   |

**Channel selection**: If `channelIds` is non-empty, only those channels are notified. Channels must belong to the same scope as the rule (project-scoped rules reference project-scoped channels; environment-scoped rules reference environment-scoped channels). If empty, **all effective channels** for the scope are notified (project + environment, post-override).

### Filters (Tag-Based Scoping)

Rules can optionally filter which events/issues they evaluate against:

```typescript
interface AlertRuleFilters {
  // Only evaluate metric samples / events matching these tags
  // Applies to threshold rules (metric samples) and issue triggers (event tags)
  tags?: Record<string, string[]>; // e.g., { "service": ["api", "payments"] }
  // Only evaluate issues in these environments (by environment name)
  // Applies to both threshold and issue triggers
  environments?: string[]; // e.g., ["production"]
}
```

- **Threshold rules**: Tag filters apply to ClickHouse metric samples (WHERE `tag_service IN (...)`). Environment filters restrict to samples from the specified environments.
- **Issue triggers**: Tag filters match against the event's tags that created the issue. Environment filters match the issue's environment (resolved via the issue's app → environment).
- A project-level rule with `environments: ["production"]` only fires for production issues/metrics across all environments in the project.
- An environment-scoped rule ignores the `environments` filter (it already applies to one environment).

---

## 5. Evaluation Pipeline

### Two Entry Points

1. **Sweeper** (`startAlertSweeper`) — Runs every `ALERT_EVALUATION_INTERVAL_MS` (default 60s). Iterates all **project/environment combinations** with enabled threshold rules. Evaluates each rule against its filtered metric stream.
2. **Ingestion Path** (`processIngestedEvent`) — Called after every ingested event (via NATS consumer). Runs:
   - Issue tracking (`trackIssuesForEvent`) → detects `new_issue` / `regression` transitions
   - Fires matching issue-trigger rules immediately (filtered by rule's `filters`)

   The ingestion path does **not** evaluate threshold rules: their metric is read from
   ClickHouse, which ingests the same subject on its own consumer, so a window read at
   ingestion time does not contain the event yet. The sweeper owns threshold rules.

### Per-Scope Serialization

`enqueueScopeWork(projectId, environmentId)` maintains a per-scope promise chain. Ingestion-triggered processing and sweeper runs **never interleave** for the same scope. This guarantees:

- Issue transitions are detected before the threshold evaluation that follows in the same ingestion tick
- Cooldown checks see the latest `lastTriggeredAt` update

### Threshold Evaluation (`evaluateRulesForScope`)

For each enabled threshold rule in the scope:

1. Compute metric value over `windowSeconds` via `computeRuleValue` (ClickHouse for sentinels/quantiles, Postgres for `new_issue_count`), **applying rule filters** (tag filters, environment filters). Tag filters translate to ClickHouse `WHERE` clauses on the metric samples table (e.g., `WHERE tag_service IN ('api', 'payments')`); environment filters restrict to samples from the specified environments.
2. Check breach: `operator === 'gt' ? value > threshold : value < threshold`.
   - **Dynamic threshold** (`thresholdFactor` set, e.g. `3` = "3x baseline"): the effective threshold is `thresholdFactor × baseline`, where the baseline is the same metric's per-window average over the history preceding the evaluation window (`ALERT_BASELINE_SECONDS`, default 24h; latency metrics use the quantile over the whole history window). The evaluation is **skipped** (logged as `no_baseline`, no incident change) while the history has no samples — a baseline computed from nothing would make every event an anomaly.
   - A rule needs either a static `threshold` or a `thresholdFactor`; both may be absent in the schema but the API rejects the combination. The incident and the notification carry the **effective** threshold.
3. If **not breached**: close any open incident for the rule (`resolveOpen`).
4. If **breached**:
   - Check cooldown: skip if `lastTriggeredAt` within `cooldownSeconds`.
   - Select channels (rule's `channelIds` or all effective channels for the scope).
   - Build uniform `AlertNotification` via `buildAlertNotification`.
   - Deliver to channels via `deliverAlertToChannels` (isolated: one failure never blocks others).
   - Create `firing` incident with metric, value, threshold.
   - Update rule's `lastTriggeredAt`.

### Issue Trigger Evaluation (`fireIssueTriggerRulesForScope`)

For each enabled issue-trigger rule in the scope matching the transition type:

1. Check if the issue matches the rule's `filters` (tags, environment). Skip if not.
2. Select channels (same logic as threshold).
3. Check per-issue cooldown via `alertIncidentDAO.findLastForIssue(ruleId, ruleScope, fingerprint)`.
4. If cooldown not elapsed, skip this issue.
5. Build notification via `buildIssueAlertNotification`.
6. Deliver to channels.
7. Create **resolved** incident carrying `issueFingerprint` (one-shot: nothing to recover).
8. If any issue fired, update rule's `lastTriggeredAt` (a record of the last firing; the cooldown itself is **per issue**, so another issue in the same window still fires).

---

## 6. Notification Delivery

### Uniform Payload

Every channel receives the same `AlertNotification` shape (`backend/protocol/alerting.ts`):

```typescript
interface AlertNotification {
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  ruleName: string;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  value: number | null;
  threshold: number | null;
  issue?: IssueSummary; // Present on issue triggers
  projectId: string; // Project context
  environmentId: string | null; // Environment context (null = project-level)
  occurredAt: string; // ISO timestamp
  link?: string; // Optional UI deep-link (e.g., "/issues/<issueId>")
}
```

Severity: `critical` for `fatal_count`, `warning` for other metrics and issue triggers (`new_issue`, `regression`), `info` for test sends.

### Channel Notifiers (`notifiers.ts`)

Each notifier implements `Notifier { type, send(notification, config) }`:

| Notifier             | Delivery                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhookNotifier`    | `POST {url}` with JSON body = `AlertNotification`; with `secret`, the body is signed — `X-Sentry-Hook-Signature: t=<unix>,v1=<hmac-sha256 of `<unix>.<body>`>` and `X-Sentry-Hook-Timestamp` |
| `slackNotifier`      | Prefers `webhookUrl` (simple `POST {text}`), falls back to `chat.postMessage` with `token` + `channel`                                                                                       |
| `rocketChatNotifier` | `POST {webhookUrl}` with Rocket.Chat attachment format (color, fields for metric/issue)                                                                                                      |
| `emailNotifier`      | SMTP — configurable via `host`, `port`, `secure`, `auth: { user, pass }`, `from`, `to`                                                                                                       |
| `pagerDutyNotifier`  | Events API v2 — `routing_key`, `severity`, `custom_details`                                                                                                                                  |
| `opsgenieNotifier`   | Alert API — `api_key`, `priority`, `responders`, `tags`                                                                                                                                      |
| `msTeamsNotifier`    | Incoming webhook — `webhookUrl`, adaptive card format                                                                                                                                        |
| `victorOpsNotifier`  | REST API — `api_key`, `routing_key`, `message_type`, `entity_display_name`                                                                                                                   |

**Channel types** (in `AlertChannelType`): `"webhook" | "slack" | "rocketchat" | "email" | "pagerduty" | "opsgenie" | "msteams" | "victorops"`

> **Note:** All eight types are implemented — `"webhook" | "slack" | "rocketchat" | "email"` (SMTP via nodemailer), `"pagerduty"`, `"opsgenie"`, `"msteams"` and `"victorops"` (their vendor APIs).

### Delivery Isolation

`deliverAlertToChannels` runs all channels in parallel via `Promise.all`. Each channel's result is captured independently:

```typescript
{ channelId, channelName, type, ok: boolean, error?: string }
```

A failing channel **never blocks or fails** the others. Errors are logged server-side; the evaluation continues.

### Test Send

`POST /api/admin/projects/:projectId/alerting/rules/:id/test` (or `/api/admin/projects/:projectId/environments/:environmentId/alerting/rules/:id/test`) sends a test notification through the rule's channels (or all effective channels if none selected). Test notifications have `severity: "info"` and a fixed message.

---

## 7. Incident Model

Incidents are the **audit trail** of rule firings, stored in Postgres (`alert_incidents`).

### Threshold Incidents

- `status: "firing"` while metric breaches threshold
- `status: "resolved"` when metric recovers (set by `resolveOpen` during evaluation)
- Carry `metric`, `value`, `threshold` at trigger time
- One open incident per rule at most (re-fire suppressed by cooldown)

### Issue-Trigger Incidents

- Created **already resolved** (`status: "resolved"`, `triggeredAt === resolvedAt`)
- Carry `issueFingerprint` for per-issue cooldown enforcement
- No metric/value/threshold fields
- One per (rule, fingerprint) per cooldown window

### Cleanup

- Deleting a rule cascades to its incidents.
- Deleting an environment removes its environment-scoped rules/channels/incidents; project-scoped rows remain.
- Deleting a project cascades to all its environments, rules, channels, incidents.

---

## 8. HTTP API (Target)

**Prefix:** `/api/admin/projects/:projectId/alerting` and `/api/admin/projects/:projectId/environments/:environmentId/alerting`  
**Auth:** Admin token only (scoped identities rejected — alerting is not in `SCOPED_READ_PATHS`)

All list endpoints are cursor-paginated: query `cursor` (the id of the last row seen, omitted on the first page) and `limit` (default 20); responses are just `{ data: [...] }`. A full page (`data.length === limit`) means there may be another page.

### Channels

| Method | Path                                        | Description                              |
| ------ | ------------------------------------------- | ---------------------------------------- |
| GET    | `/channels`                                 | List project-scoped channels (paged)     |
| POST   | `/channels`                                 | Create project-scoped channel            |
| GET    | `/channels/:id`                             | Get project-scoped channel by ID         |
| PATCH  | `/channels/:id`                             | Update project-scoped channel            |
| DELETE | `/channels/:id`                             | Delete project-scoped channel            |
| GET    | `/environments/:environmentId/channels`     | List environment-scoped channels (paged) |
| POST   | `/environments/:environmentId/channels`     | Create environment-scoped channel        |
| GET    | `/environments/:environmentId/channels/:id` | Get environment-scoped channel by ID     |
| PATCH  | `/environments/:environmentId/channels/:id` | Update environment-scoped channel        |
| DELETE | `/environments/:environmentId/channels/:id` | Delete environment-scoped channel        |

### Rules

| Method | Path                                          | Description                                            |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| GET    | `/rules`                                      | List project-scoped rules (paged)                      |
| POST   | `/rules`                                      | Create project-scoped rule                             |
| GET    | `/rules/:id`                                  | Get project-scoped rule by ID                          |
| PATCH  | `/rules/:id`                                  | Update project-scoped rule                             |
| DELETE | `/rules/:id`                                  | Delete project-scoped rule (cascades to incidents)     |
| POST   | `/rules/:id/test`                             | Send test notification                                 |
| GET    | `/environments/:environmentId/rules`          | List environment-scoped rules (paged)                  |
| POST   | `/environments/:environmentId/rules`          | Create environment-scoped rule                         |
| GET    | `/environments/:environmentId/rules/:id`      | Get environment-scoped rule by ID                      |
| PATCH  | `/environments/:environmentId/rules/:id`      | Update environment-scoped rule                         |
| DELETE | `/environments/:environmentId/rules/:id`      | Delete environment-scoped rule (cascades to incidents) |
| POST   | `/environments/:environmentId/rules/:id/test` | Send test notification                                 |

### Effective Config & Incidents

| Method | Path                                     | Description                                                  |
| ------ | ---------------------------------------- | ------------------------------------------------------------ |
| GET    | `/effective`                             | Resolved channels + rules for project (project + env merged) |
| GET    | `/environments/:environmentId/effective` | Resolved channels + rules for environment                    |
| GET    | `/incidents`                             | List incidents (paged, optional `environmentId` filter)      |

---

## 9. Data Layer (Target Schema)

### Tables

```sql
-- Project-scoped channels
alert_channels_project (
  id text primary key,
  name text not null,
  type text not null,
  config text not null default '{}',
  project_id text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique index on (project_id, name)
)

-- Environment-scoped channels
alert_channels_environment (
  id text primary key,
  name text not null,
  type text not null,
  config text not null default '{}',
  project_id text not null,
  environment_id text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique index on (project_id, environment_id, name)
)

-- Project-scoped rules
alert_rules_project (
  id text primary key,
  name text not null,
  trigger text not null default 'threshold' check (trigger in ('threshold', 'new_issue', 'regression')),
  metric text,
  operator text,
  threshold real,
  window_seconds integer,
  cooldown_seconds integer not null default 3600,
  channel_ids text not null default '[]',  -- JSON array of channel IDs (same scope)
  measurement text,  -- For latency_* metrics: measurement name (default "duration")
  project_id text not null,
  is_enabled integer not null default 1,
  last_triggered_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  filters text,  -- JSON: tag/environment filters
  unique index on (project_id, name)
)

-- Environment-scoped rules
alert_rules_environment (
  id text primary key,
  name text not null,
  trigger text not null default 'threshold' check (trigger in ('threshold', 'new_issue', 'regression')),
  metric text,
  operator text,
  threshold real,
  window_seconds integer,
  cooldown_seconds integer not null default 3600,
  channel_ids text not null default '[]',  -- JSON array of channel IDs (same scope)
  measurement text,  -- For latency_* metrics: measurement name (default "duration")
  project_id text not null,
  environment_id text not null,
  is_enabled integer not null default 1,
  last_triggered_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  filters text,  -- JSON: tag/environment filters
  unique index on (project_id, environment_id, name)
)

-- Incidents (scope-agnostic, reference rule by ID)
alert_incidents (
  id text primary key,
  rule_id text not null,
  rule_scope text not null check (rule_scope in ('project', 'environment')),
  project_id text not null,
  environment_id text,
  trigger text not null default 'threshold' check (trigger in ('threshold', 'new_issue', 'regression')),
  issue_fingerprint text,
  metric text,
  value real,
  threshold real,
  status text not null default 'firing' check (status in ('firing', 'resolved')),
  triggered_at timestamp with time zone not null,
  resolved_at timestamp with time zone,
  indexes on (rule_id), (project_id), (environment_id), (status),
  index on (rule_id, issue_fingerprint)  -- for per-issue cooldown lookups
)
```

### DAOs

Standard pattern per scope: `create`, `findById`, `findByIdOrThrow`, `list`, `listPaged`, `updateOrThrow`, `delete`, plus:

- `deleteByProject(projectId)` — Removes project-scoped rows.
- `deleteByEnvironment(projectId, environmentId)` — Removes environment-scoped rows.
- `resolveEffectiveConfig(projectId, environmentId?)` — Merges project + environment by name.
- `alertRuleDAO.touchTriggered(id, triggeredAt)` — Updates `lastTriggeredAt`.
- `alertIncidentDAO.resolveOpen(ruleId, ruleScope)` — Closes firing incidents, sets `resolvedAt = now()`.
- `alertIncidentDAO.findLastForIssue(ruleId, ruleScope, fingerprint)` — Per-issue cooldown lookup.

### Uniqueness

Enforced at database level via unique indexes on `(project_id, name)` and `(project_id, environment_id, name)`. Creation uses `onConflictDoNothing` + `returning()`.

---

## 10. Invariants (Must Not Break)

- **Metric reads are ClickHouse-only** — Postgres has no measurements. CH failure = failed evaluation (5xx), never a fallback to zero.
- **Per-scope serialization** — Ingestion and sweeper never interleave for the same project/environment.
- **Cooldown is authoritative** — `lastTriggeredAt` updated atomically with incident creation; per-issue cooldown uses `findLastForIssue`.
- **Delivery isolation** — One failing channel never blocks others; errors logged, not thrown.
- **Issue triggers are one-shot** — Incidents created `resolved`; no recovery path exists.
- **Project/env override by name** — Environment-scoped row replaces project-scoped row of same name; other project rows still apply.
- **Admin-token-only API** — Alerting endpoints are not in `SCOPED_READ_PATHS`; scoped identities receive 403.
- **Validation at send time** — Channel config shapes not validated at create; invalid config surfaces as delivery failure.
- **Filters applied at evaluation** — Rule `filters` (tags, environments) must be applied when computing metric values and matching issue transitions.
- **IDs generated in handler/DAO** — `crypto.randomUUID()`, never DB default.
- **Timestamps as ISO strings** — `new Date().toISOString()` everywhere; the columns are `timestamptz`.

---

## 11. Configuration Reference

| Env Var                        | Default | Effect                     |
| ------------------------------ | ------- | -------------------------- |
| `ALERT_EVALUATION_INTERVAL_MS` | `60000` | Sweeper tick interval (ms) |

---

## 12. Tests (Target)

- **Unit-style (in-process)**: Project/env CRUD, per-name override, duplicate rejection (409)
- **Threshold evaluation**: `error_count`, `fatal_count`, `new_issue_count`, `latency_p95` with tag/environment filters
- **Cooldown enforcement**, incident resolution on metric recovery
- **Multi-channel delivery** (webhook, slack, rocketchat, email, pagerduty, opsgenie, msteams, victorops)
- **Delivery failure isolation** (one failing channel never blocks others)
- **Test send endpoint** at both project and environment level
- **Filter matching**: rule with `tags: { service: ["api"] }` only fires for api events; rule with `environments: ["production"]` only fires for production events
- **Tag filter on metric queries**: ClickHouse queries include `WHERE tag_service IN ('api', 'payments')` when rule has tag filters

---

## 13. Current Implementation vs Target

| Aspect                 | Current (App-Scoped)                       | Target (Project/Env-Scoped)                                                                   |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Scope**              | Global (`appId=NULL`) + App (`appId=uuid`) | Project (`projectId`, `environmentId=NULL`) + Environment (`projectId`, `environmentId=uuid`) |
| **Override**           | App overrides global by name               | Environment overrides project by name                                                         |
| **Metric aggregation** | Per-app (ClickHouse `appId`)               | Per-project/env (ClickHouse `projectId` + `environmentId`)                                    |
| **Issue triggers**     | Per-app fingerprint                        | Per-project/env fingerprint (issues already have `projectId` + `environmentId` via app)       |
| **API prefix**         | `/api/admin/alerting`                      | `/api/admin/projects/:projectId/alerting` + `/environments/:environmentId/alerting`           |
| **Filters**            | None                                       | Tag filters, environment filters on rules                                                     |
| **Channels**           | Global + App                               | Project + Environment                                                                         |

### What landed

1. **Schema**: `alert_channels` and `alert_rules` carry a nullable `project_id` — null is the global scope, the app scope keeps `app_id`. The name uniqueness is per scope (the global, the project and the app).
2. **DAO**: the scope-aware `list`/`listPaged` take a scope (`{ appId, projectId }`); the rules have `listProjectScoped` for the sweeper.
3. **Resolver**: `resolveEffectiveAlertConfig({ projectId, appId })` merges the global, the project and the app entries (the narrower wins by name); `resolveScopedRules` returns one scope's rules.
4. **Evaluation**: the sweeper evaluates the app scope per app and the project scope per project (the metric samples are aggregated by `projectId` in ClickHouse); the ingestion fires the issue triggers of the global, the project and the app rules.
5. **API**: the channels and the rules take `projectId` (the body and the list filters) beside `appId`; the paths stay `/api/admin/alerting`.
6. **Types**: `AlertChannelType` includes `"pagerduty" | "opsgenie" | "msteams" | "victorops"` beside `"webhook" | "slack" | "rocketchat" | "email"`. **Done.**
7. **Notifiers**: `pagerDutyNotifier`, `opsgenieNotifier`, `msTeamsNotifier` and `victorOpsNotifier` live in `backend/alerting/notifiers.ts`. **Done.**

8. **Rule filters**: `alert_rules.filters` is a JSON object — `{ "tags": { "<key>": "<value>" } }`. The metric samples carry the event's tags (`sentry_metrics.tags`, a JSON string), and a threshold rule only counts the samples whose event carries the filtered tag with that value. The samples are published with their tags (`sentry.metrics`) and the ClickHouse store gained the column.

9. **Rule filters**: `alert_rules.filters` holds the tag dimensions (`{ "tags": { "<key>": "<value>" } }`). The metric samples carry the event's tags (`sentry_metrics.tags`) and the issue digests carry them too (`IssueDigest.tags`), so a threshold rule counts only the matching samples, a `new_issue`/`regression` rule fires only for the matching issues, and `new_issue_count` counts only the issues whose latest occurrence carries the tag. The rule builder and the rules list show the filters.

10. **Webhook signing**: a webhook channel with a `secret` signs the body (HMAC-SHA256 over `<timestamp>.<body>`, the Sentry scheme) and sends `X-Sentry-Hook-Signature` + `X-Sentry-Hook-Timestamp`; `backend/alerting/webhook-signature.ts` also exposes the verification side for receivers.

11. **Observability**: every evaluation decision is one JSON log line (`component: "alerting"`, the rule, the scope, the metric, the value, the threshold, the outcome: `no_breach` / `cooldown` / `fired`); the counters (the rules evaluated, the incidents fired and resolved, the deliveries succeeded and failed, the cooldowns skipped) are read through `GET /api/admin/alerting/stats`.

12. **Message templates**: a rule can carry a `message` template — plain text with `{{variable}}` placeholders (`rule.name`, `metric`, `value`, `threshold`, `operator`, `windowSeconds`, `appId`). Without a template the default message is used; an unknown placeholder is left as it is.

13. **Incident acknowledgment / assignment**: an incident carries `acknowledgedAt` + `acknowledgedBy` and an `assignee`. `POST /api/admin/alerting/incidents/:id/acknowledge` takes the incident over (the admin id is recorded), `POST /api/admin/alerting/incidents/:id/assign` sets the assignee.

14. **ClickHouse retry / circuit breaker**: the ClickHouse reads are retried with a backoff (`CH_CLIKE_RETRY_ATTEMPTS`, `CH_CLIKE_RETRY_DELAY_MS`). Repeated transient failures open a circuit (`CH_CLIKE_CIRCUIT_FAILURES`, `CH_CLIKE_CIRCUIT_COOLDOWN_MS`): the queries fail fast instead of hammering a down server, and the alert sweep is skipped as a whole until the circuit closes.
15. **Sweeper parallelism**: the sweep evaluates the apps (and the project-scoped rules) with a bounded concurrency (`ALERT_SWEEPER_CONCURRENCY`, 8 by default) instead of one after the other.
16. **Backpressure**: the deliveries go through a bounded queue (`ALERT_DELIVERY_QUEUE_SIZE`, 1000 pending) with a bounded number of workers (`ALERT_DELIVERY_CONCURRENCY`, 8). A delivery that cannot be queued is refused rather than fanned out.
17. **Dead letter queue**: a delivery that fails is recorded (`alert_dead_letters`) and retried with an exponential backoff (`ALERT_DEAD_LETTER_BASE_MS`, `ALERT_DEAD_LETTER_MAX_MS`); the worker runs every `ALERT_DEAD_LETTER_INTERVAL_MS`. `GET /api/admin/alerting/dead-letters` lists the queue, `POST /api/admin/alerting/dead-letters/:id/retry` tries again now, `DELETE /api/admin/alerting/dead-letters/:id` discards it.

18. **Silences**: a silence (`alert_silences`) covers a scope — global, a project or an app (the alerting model has no environment scope) — between `startsAt` and `endsAt` (a silence without an end is open-ended). While a silence covers the scope, the rules in it do not fire and the decision is logged with the outcome `silenced`. `GET /api/admin/alerting/silences` lists them, `POST /api/admin/alerting/silences` creates one and `DELETE /api/admin/alerting/silences/:id` removes it.

19. **Rule history**: every rule change is recorded (`alert_rule_history`) with the actor, the action (`created` / `updated` / `deleted`) and the rule's state. `GET /api/admin/alerting/rules/:id/history` reads it.
20. **Correlation and deduplication**: an incident carries a `correlationKey` (the scope and the metric — the root cause) and the `parentId` of the group's first incident. A rule does not report a root cause that was reported in the last `ALERT_DEDUP_WINDOW_MS` (5 minutes): the decision is logged with the outcome `deduplicated` and no incident is created. The rules of a scope are evaluated one after the other, so the deduplication compares them with each other.

21. **Channel test**: `POST /api/admin/alerting/channels/:id/test` sends one test notification to that channel and answers the delivery result (`ok`, `error`) — the channel page has the button.
22. **Rule import / export**: `GET /api/admin/alerting/export` writes the rules as a JSON document (the channels travel by name — the ids are local to an installation); `POST /api/admin/alerting/import` reads such a document back, creates the rules that do not exist yet and reports the ones it skipped.

**Not built:** the environment scope (dropped from the model).

---

## 14. Related Architecture Docs

- [`permission.md`](permission.md) — Admin auth model (alerting is admin-token-only)
- [`events.md`](events.md) — Ingestion pipeline (NATS → ClickHouse → alert evaluation)
- [`issues.md`](issues.md) — Issue tracking (drives `new_issue` / `regression` triggers)
- [`metrics.md`](metrics.md) — Metric samples in ClickHouse (sentinels + measurements)
- [`storage.md`](storage.md) — Object store (unrelated but same repo structure)
