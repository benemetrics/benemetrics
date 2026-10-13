# 6. Alerting — Platform-Agnostic

Proactive notification when errors spike, performance degrades, or cron jobs fail.

> **Note**: This guide uses generic Sentry SDK patterns. Replace SDK imports with your platform's equivalent (e.g., `@sentry/node`, `@sentry/bun`, `@sentry/python`, `@sentry/java`, etc.).

## Alert Types Overview

| Alert Type | Trigger | Use Case |
|------------|---------|----------|
| **Issue Alert** | New issue, regression, frequency spike | "New bug deployed" |
| **Metric Alert** | Custom metric threshold | "Error rate > 5%", "p95 > 2s" |
| **Cron Monitor** | Job missed/late/failed | "Nightly backup didn't run" |
| **Uptime Monitor** | Endpoint down/SSL expiry | "API unreachable" |

## 1. Issue Alerts

### Create via Sentry UI

1. **Alerts → New Alert Rule → Issue Alert**
2. Configure:
   - **Projects**: Select your project
   - **Environments**: production, staging
   - **Conditions**:
     - "Issue is new" (first occurrence)
     - "Issue is regressed" (was resolved, now back)
     - "Event count > 10 in 5 minutes"
     - "Issue level = error/fatal"
   - **Filters**: Tags (service:api, tier:premium), Issue type

### Create via API (Terraform/Script)

```bash
# Create alert rule via API
curl -X POST "https://sentry.io/api/0/projects/{org}/{project}/alert-rules/" \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Error Rate - API",
    "conditions": [
      {"type": "event_frequency", "value": "10", "window": "5m"},
      {"type": "issue_level", "value": "error"}
    ],
    "actions": [
      {"type": "slack", "target": "#alerts-api", "tags": {"service": "api"}}
    ],
    "filters": {
      "environment": ["production"],
      "tags": {"service": ["api"]}
    }
  }'
```

### Recommended Issue Alert Rules

| Rule Name | Conditions | Action | Purpose |
|-----------|------------|--------|---------|
| **New Critical Errors** | New issue, level=fatal | PagerDuty | Wake up for crashes |
| **Regressions** | Issue regressed | Slack #team | Catch re-introduced bugs |
| **Error Spike** | >50 events/5min | Slack #team | Detect cascading failures |
| **New in Release** | New issue, release=current | GitHub Issue | Track deploy quality |

## 2. Metric Alerts

### Built-in Metrics

```typescript
// Track custom metrics in your application
import * as Sentry from "@sentry/<your-platform>"; // e.g., @sentry/node, @sentry/bun, @sentry/python

// Counter
Sentry.metrics.increment("orders.created", 1, {
  tags: { tier: "premium", region: "us-east" },
});

// Distribution (latency, size, etc.)
Sentry.metrics.distribution("order.value", 99.99, {
  tags: { currency: "USD" },
  unit: "currency:USD",
});

// Timing (duration in ms)
Sentry.metrics.timing("checkout.duration", 1250, {
  tags: { payment_method: "stripe" },
});

// Gauge (current value)
Sentry.metrics.gauge("queue.depth", 42, {
  tags: { queue: "emails" },
});
```

### Metric Alert Rules (UI)

1. **Alerts → New Alert Rule → Metric Alert**
2. **Metric**: Select custom metric (e.g., `orders.created`)
3. **Aggregation**: sum, avg, min, max, count, percentile(95)
4. **Threshold**: `> 100` (per minute)
5. **Window**: 5 minutes
6. **Group by**: tag (e.g., `region`)

### Example Metric Alerts

| Metric | Aggregation | Threshold | Window | Purpose |
|--------|-------------|-----------|--------|---------|
| `http.server.duration` | p95 | > 2000ms | 5m | API latency spike |
| `http.server.duration` | p99 | > 5000ms | 1m | Severe latency |
| `error.rate` | sum | > 0.05 (5%) | 5m | Error rate spike |
| `orders.created` | sum | < 10 | 10m | Business metric drop |
| `queue.depth` | max | > 1000 | 5m | Queue backlog |
| `db.query.duration` | p95 | > 1000ms | 5m | Slow queries |

## 3. Cron Monitors

### Setup in Sentry UI

1. **Cron Monitors → New Monitor**
2. **Schedule**: Cron expression (e.g., `0 2 * * *` for 2 AM daily)
3. **Timeout**: Max expected duration (e.g., 30 minutes)
4. **Grace period**: Minutes before alerting (e.g., 10 minutes)

### Instrument in Your Application

```typescript
// scripts/nightly-backup.ts
import * as Sentry from "@sentry/<your-platform>";
import { initSentry } from "../sentry.config";

initSentry({ dsn: process.env.SENTRY_DSN! });

// Wrap with cron monitor
const monitor = Sentry.cron.monitor("nightly-backup", {
  schedule: "0 2 * * *", // 2 AM UTC
  checkinMargin: 10 * 60, // 10 min grace
  maxRuntime: 30 * 60,    // 30 min max
});

async function runBackup() {
  const checkin = monitor.checkIn({ status: "in_progress" });
  
  try {
    await performBackup();
    checkin.complete({ status: "ok" });
  } catch (error) {
    checkin.complete({ status: "error" });
    throw error;
  }
}

runBackup().catch(() => process.exit(1));```
```

### Manual Check-ins (for non-scheduled jobs)

```typescript
// For jobs triggered externally (webhook, queue)
const checkin = Sentry.cron.checkIn("order-export", {
  status: "in_progress",
  monitorSlug: "order-export-manual",
});

try {
  await exportOrders();
  checkin.complete({ status: "ok" });
} catch (e) {
  checkin.complete({ status: "error" });
  throw e;
}
```

> **Note**: The cron monitoring API is available in most Sentry SDKs. Check your platform's SDK documentation for exact API.

## 4. Uptime Monitoring

### Create in Sentry UI

1. **Uptime → New Monitor**
2. **URL**: `https://api.example.com/health`
3. **Interval**: 1 minute
4. **Regions**: Multiple (US, EU, Asia)
5. **Assertions**:
   - Status code = 200
   - Response time < 2000ms
   - Body contains "healthy"
   - SSL expires > 30 days

### Health Endpoint (Generic Example)

```typescript
// routes/health.ts - adapt to your framework (Express, Fastify, Hono, etc.)
export default {
  async fetch(req) {
    const checks = await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
      checkExternalAPI(),
    ]);
    
    const healthy = checks.every(c => c.status === "fulfilled");
    const details = checks.map((c, i) => ({
      check: ["database", "redis", "external"][i],
      status: c.status,
      ...(c.status === "rejected" ? { error: c.reason.message } : {}),
    }));
    
    return new Response(JSON.stringify({ healthy, checks: details }), {
      status: healthy ? 200 : 503,
      headers: { "content-type": "application/json" },
    });
  }
};

async function checkDatabase() {
  await db.execute("SELECT 1");
}

async function checkRedis() {
  await redis.ping();
}

async function checkExternalAPI() {
  const res = await fetch("https://api.payment.com/health", { timeout: 2000 });
  if (!res.ok) throw new Error("Payment API unhealthy");
}
```

## Alert Routing & Actions

### Action Types

| Action | Configuration |
|--------|---------------|
| **Slack** | Channel, mention (@here/@channel/@user), message template |
| **PagerDuty** | Service key, severity, deduplication key |
| **Opsgenie** | API key, priority, responders |
| **Email** | Recipients, subject template |
| **Webhook** | URL, headers, payload template |
| **Microsoft Teams** | Webhook URL, message format |
| **VictorOps** | Routing key, message type |
| **Custom** | Webhook to your own system |

### Slack Message Template

```json
{
  "type": "slack",
  "target": "#alerts-api",
  "options": {
    "tags": {"service": "api"},
    "includeTags": true,
    "includeRules": true
  }
}
```

### Webhook Payload Example

```json
{
  "alert": {
    "id": "alert_123",
    "name": "High Error Rate",
    "status": "triggered",
    "triggeredAt": "2024-01-15T10:30:00Z"
  },
  "issue": {
    "id": "issue_456",
    "title": "TypeError: Cannot read 'id' of null",
    "url": "https://sentry.io/organizations/.../issues/456/",
    "count": 150,
    "culprit": "GET /api/users/:id/orders"
  },
  "project": { "name": "api", "slug": "api" },
  "environment": "production"
}
```

## Ownership & Routing Rules

### Code Owners (CODEOWNERS)

```text
# .github/CODEOWNERS
/src/payments/    @payments-team
/src/auth/        @auth-team
/src/orders/      @orders-team
/src/*            @backend-team
```

### Sentry Ownership Rules (UI)

1. **Settings → Alerts → Ownership Rules**
2. **Rule**: "Payments Team"
   - Match: `tags.service = payments` OR `file.path contains /payments/`
   - Assign: `@payments-team`
3. **Rule**: "Backend Team" (fallback)
   - Match: `*`
   - Assign: `@backend-team`

### Alert Routing with Ownership

```yaml
# Alert rule references ownership
actions:
  - type: "slack"
    target: "#{{owner.slack_channel}}"
    mention: "@{{owner.handle}}"
```

## Alert Deduplication & Noise Reduction

### Deduplication Settings

```json
{
  "name": "Error Spike",
  "conditions": [...],
  "settings": {
    "deduplication": {
      "enabled": true,
      "window": "30m"  // Don't re-alert for 30 minutes
    },
    "autoResolve": {
      "enabled": true,
      "window": "1h"   // Auto-resolve if no events for 1 hour
    }
  }
}
```

### Smart Grouping

```typescript
// In beforeSend - group similar errors
Sentry.init({
  beforeSend(event) {
    // Group validation errors by field
    if (event.exception?.values?.[0]?.type === "ValidationError") {
      const field = event.exception.values[0].value?.match(/field '(\w+)'/)?.[1];
      if (field) event.fingerprint = ["validation-error", field];
    }
    return event;
  },
});
```

> **Note**: The `beforeSend` hook is available in most Sentry SDKs. Check your platform's SDK documentation for exact API.

## Testing Alerts

### Trigger Test Alert

```bash
# Via Sentry CLI
sentry-cli alerts test-rule <RULE_ID>

# Or trigger manually in UI: Alerts → Rule → "Test"
```

> **Note**: `sentry-cli` works across all platforms.

### Verify Alert Flow

```typescript
// Test script
import * as Sentry from "@sentry/<your-platform>";
import { initSentry } from "./sentry.config";

initSentry({ dsn: process.env.SENTRY_DSN! });

// 1. Test issue alert
throw new Error("TEST ALERT: Issue alert trigger");

// 2. Test metric alert
for (let i = 0; i < 100; i++) {
  Sentry.metrics.increment("test.metric", 1);
}

// 3. Test cron monitor
const checkin = Sentry.cron.checkIn("test-cron", { status: "in_progress" });
setTimeout(() => checkin.complete({ status: "ok" }), 1000);
```

## Alert Best Practices

### Do's ✅

- **Start with high-severity only** (fatal errors, downtime)
- **Use metric alerts for trends** (latency, error rate, business metrics)
- **Route to team channels** (not #general)
- **Include runbooks** in alert description
- **Test alerts monthly** (fire drill)
- **Review & tune weekly** (reduce noise)

### Don'ts ❌

- Alert on every error (use frequency thresholds)
- Alert on warnings (info/debug level)
- Send all alerts to PagerDuty (use Slack for non-critical)
- Set thresholds once and forget
- Ignore auto-resolve (causes alert fatigue)

## Alert Rule Template (Terraform)

```hcl
# sentry_alert_rules.tf
resource "sentry_alert_rule" "high_error_rate" {
  organization = var.sentry_org
  project      = sentry_project.api.id
  name         = "High Error Rate - API"
  
  conditions = [
    {
      type        = "event_frequency"
      value       = "50"
      window      = "5m"
      aggregation = "count"
    }
  ]
  
  filters = {
    environment = ["production"]
    tags = {
      service = ["api"]
    }
  }
  
  actions = [
    {
      type = "slack"
      target_type = "channel"
      target_identifier = "#alerts-api"
      options = {
        tags = { service = "api" }
      }
    }
  ]
  
  settings = {
    deduplication_window = 1800  # 30 minutes
    auto_resolve_window  = 3600  # 1 hour
  }
}
```

## Monitoring Alert Health

### Meta-Alerts (Alert on Alerts)

| Meta-Alert | Purpose |
|------------|---------|
| "No alerts fired in 24h" | Alerting system broken |
| "Alert X fired >10x in 1h" | Flapping alert, needs tuning |
| "Alert X not resolved in 4h" | Stuck incident |

### Dashboard: Alert Effectiveness

```sql
-- Discover query: Alert noise ratio
SELECT 
  alert_rule_name,
  count() as total_fired,
  countif(resolved = true) as resolved,
  countif(resolved = false) as open,
  resolved / total_fired as resolution_rate
FROM alert_events
WHERE timestamp > now() - 7d
GROUP BY alert_rule_name
ORDER BY total_fired DESC
```

## Quick Reference

```typescript
// Metrics
Sentry.metrics.increment(name, value, tags);
Sentry.metrics.distribution(name, value, tags);
Sentry.metrics.timing(name, ms, tags);
Sentry.metrics.gauge(name, value, tags);
Sentry.metrics.set(name, value, tags); // Unique values

// Cron
const monitor = Sentry.cron.monitor(slug, { schedule, checkinMargin, maxRuntime });
const checkin = monitor.checkIn({ status: "in_progress" });
checkin.complete({ status: "ok" | "error" });

// Manual check-in
Sentry.cron.checkIn(slug, { status: "in_progress", monitorSlug });
```

> **Note**: Metrics and Cron APIs are available in most Sentry SDKs. Check your platform's SDK documentation for exact API.

## Complete Alert Setup Checklist

- [ ] **Issue Alert**: New fatal errors → PagerDuty
- [ ] **Issue Alert**: Regressions → Team Slack
- [ ] **Issue Alert**: Error spike (>50/5min) → Team Slack
- [ ] **Metric Alert**: p95 latency > 2s → Team Slack
- [ ] **Metric Alert**: Error rate > 5% → PagerDuty
- [ ] **Cron Monitor**: Nightly jobs → Team Slack
- [ ] **Uptime Monitor**: /health endpoint → PagerDuty
- [ ] **Ownership Rules**: Code owners mapped to teams
- [ ] **Deduplication**: 30min window on all alerts
- [ ] **Auto-resolve**: 1h window on all alerts
- [ ] **Runbooks**: Linked in alert descriptions
- [ ] **Monthly Test**: All alert paths verified

---

## Summary: Complete Sentry Integration

You now have documentation for all 6 core features:

| Doc | Feature | Key Files |
|-----|---------|-----------|
| [01](./01-error-tracking.md) | Error Tracking | `sentry.config.ts`, middleware |
| [02](./02-release-tracking.md) | Release Tracking | CI/CD, `sentry-cli`, source maps |
| [03](./03-performance-monitoring.md) | Performance | Transactions, spans, profiling |
| [04](./04-session-replay.md) | Session Replay | Trace propagation, frontend link |
| [05](./05-breadcrumbs.md) | Breadcrumbs | Auto + custom, middleware |
| [06](./06-alerting.md) | Alerting | Rules, metrics, cron, uptime |

## Next Steps

1. **Configure `sentry.config.ts`** with your DSN
2. **Set up CI/CD** for release tracking (doc 02)
3. **Configure alerts** in Sentry UI (doc 06)
4. **Add frontend replay** for full-stack visibility (doc 04)

Happy monitoring! 🚀