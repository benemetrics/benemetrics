# 9. Feature Flags — Per Release

Sentry's feature flags let you control feature rollouts, run experiments, and correlate feature state with errors and performance — all tied to your releases.

---

## Overview

| Capability | Description |
|------------|-------------|
| **Release-scoped flags** | Flags automatically associated with a release version |
| **Gradual rollout** | Percentage-based targeting per release |
| **User targeting** | Rules based on user attributes, segments, custom properties |
| **Error correlation** | See which flag states correlate with errors/performance issues |
| **Experimentation** | A/B testing with statistical significance |
| **Kill switches** | Instantly disable problematic features |

---

## Concepts

```
┌─────────────────────────────────────────────────────────────────┐
│                        RELEASE v2.3.0                           │
├─────────────────────────────────────────────────────────────────┤
│  Feature Flags (scoped to this release)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ new-checkout    │  │ dark-mode       │  │ beta-api-v2     │ │
│  │ rollout: 25%    │  │ rollout: 100%   │  │ rollout: 10%    │ │
│  │ targeting: beta │  │ targeting: all  │  │ targeting: opt  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Key Terms

| Term | Definition |
|------|------------|
| **Flag** | A toggle with key, default value, and targeting rules |
| **Release** | A version identifier (semver, git SHA, build number) |
| **Rollout** | Percentage of users who see the flag enabled |
| **Targeting Rule** | Conditions to match users (attributes, segments, custom) |
| **Variant** | For multivariate flags: `control`, `treatment-a`, `treatment-b` |
| **Evaluation** | Determining flag value for a specific user/context |

---

## Setup

### 1. Enable Feature Flags in Sentry

**Sentry UI** → Settings → Feature Flags → **Enable Feature Flags**

### 2. Configure SDK

```typescript
// sentry.config.ts
import * as Sentry from "@sentry/<your-platform>";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.APP_VERSION, // Required for release-scoped flags
  
  // Feature flags configuration
  featureFlags: {
    // Fetch flags from Sentry on init
    fetchOnInit: true,
    // Poll for updates (ms) - 0 to disable
    pollingInterval: 60_000,
    // Custom endpoint (self-hosted)
    // endpoint: "https://sentry.example.com/api/0/feature-flags/",
  },
  
  // Required for user targeting
  initialScope: {
    user: {
      id: "user-123",
      email: "user@example.com",
      username: "johndoe",
      // Custom attributes for targeting
      segment: "premium",
      beta_opt_in: true,
    },
  },
});
```

### 3. Server-Side Flag Evaluation (Recommended)

```typescript
// services/feature-flags.ts
import * as Sentry from "@sentry/<your-platform>";

interface FeatureFlags {
  "new-checkout": boolean;
  "dark-mode": boolean;
  "beta-api-v2": "control" | "treatment-a" | "treatment-b";
}

let flagsCache: FeatureFlags | null = null;
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30 seconds

export async function getFeatureFlags(user: Sentry.User): Promise<FeatureFlags> {
  // Return cached if fresh
  if (flagsCache && Date.now() - lastFetch < CACHE_TTL) {
    return flagsCache;
  }

  // Evaluate flags via Sentry SDK
  const client = Sentry.getClient();
  if (!client) throw new Error("Sentry not initialized");

  const evaluation = await client.evaluateFeatureFlags({
    user,
    // Include custom context for targeting
    custom: {
      region: user.ip_address ? await getRegion(user.ip_address) : "unknown",
      app_version: process.env.APP_VERSION,
    },
  });

  flagsCache = {
    "new-checkout": evaluation["new-checkout"] ?? false,
    "dark-mode": evaluation["dark-mode"] ?? false,
    "beta-api-v2": evaluation["beta-api-v2"] ?? "control",
  };
  lastFetch = Date.now();

  return flagsCache;
}

// Helper for boolean flags
export async function isEnabled(flagKey: keyof FeatureFlags, user: Sentry.User): Promise<boolean> {
  const flags = await getFeatureFlags(user);
  const value = flags[flagKey];
  return typeof value === "boolean" ? value : value !== "control";
}
```

---

## Creating Flags in Sentry UI

### 1. Create a Flag

**Feature Flags** → **New Feature Flag**

| Field | Example |
|-------|---------|
| **Key** | `new-checkout` (snake_case, unique) |
| **Name** | `New Checkout Flow` |
| **Description** | `Redesigned checkout with fewer steps` |
| **Type** | `Boolean` or `Multivariate` |
| **Default Value** | `false` (off by default) |

### 2. Configure Rollout (Per Release)

```
Release: v2.3.0
├── Rollout: 25%
├── Targeting Rules:
│   ├── IF user.segment = "beta" → 100%
│   ├── IF user.beta_opt_in = true → 100%
│   └── ELSE → 25%
└── Environments: production, staging
```

### 3. Multivariate Flag (A/B Test)

```
Flag Key: beta-api-v2
Type: Multivariate
Variants:
  - control (50%) — Current API
  - treatment-a (25%) — New API v2
  - treatment-b (25%) — New API v2 + caching
Default: control
```

---

## Using Flags in Code

### Boolean Flags

```typescript
// components/Checkout.tsx
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

export function CheckoutPage() {
  const newCheckout = useFeatureFlag("new-checkout");
  
  if (newCheckout) {
    return <NewCheckoutFlow />;
  }
  return <LegacyCheckoutFlow />;
}
```

```typescript
// Server-side (API route)
export async function POST(req: Request) {
  const user = await getUser(req);
  const flags = await getFeatureFlags(user);
  
  if (flags["new-checkout"]) {
    return handleNewCheckout(req);
  }
  return handleLegacyCheckout(req);
}
```

### Multivariate Flags (Experiments)

```typescript
// services/api-client.ts
export async function callAPI(endpoint: string, user: Sentry.User) {
  const flags = await getFeatureFlags(user);
  const variant = flags["beta-api-v2"];
  
  const baseUrl = variant === "control" 
    ? "https://api.v1.example.com"
    : "https://api.v2.example.com";
  
  const headers: Record<string, string> = {};
  if (variant === "treatment-b") {
    headers["X-Cache-Strategy"] = "aggressive";
  }
  
  // Track variant for analytics
  Sentry.setTag("experiment.beta-api-v2", variant);
  
  return fetch(`${baseUrl}${endpoint}`, { headers });
}
```

### React Hook Example

```typescript
// hooks/useFeatureFlag.ts
import { useEffect, useState } from "react";
import * as Sentry from "@sentry/<your-platform>";
import { getFeatureFlags } from "@/services/feature-flags";

export function useFeatureFlag(flagKey: string): boolean | string {
  const [value, setValue] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    async function load() {
      try {
        const user = Sentry.getCurrentScope().getUser();
        if (!user) return;
        
        const flags = await getFeatureFlags(user);
        if (mounted) {
          setValue(flags[flagKey] ?? false);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    
    load();
    return () => { mounted = false; };
  }, [flagKey]);

  return value;
}
```

---

## Advanced Targeting

### User Attributes

```typescript
// Set user context for targeting
Sentry.setUser({
  id: "user-123",
  email: "user@company.com",
  username: "johndoe",
  // Standard attributes
  ip_address: "192.168.1.1",
  // Custom attributes (use for targeting)
  segment: "enterprise",
  plan: "pro",
  beta_opt_in: true,
  signup_date: "2024-01-15",
  last_login: new Date().toISOString(),
});
```

### Targeting Rule Examples

| Rule | Matches |
|------|---------|
| `user.segment = "beta"` | Beta users |
| `user.plan IN ["pro", "enterprise"]` | Paid plans |
| `user.signup_date > "2024-01-01"` | New users |
| `user.beta_opt_in = true` | Opted-in users |
| `custom.region = "us-east"` | Geographic |
| `user.id % 100 < 25` | 25% random sample |

### Segments (Reusable Audiences)

**Feature Flags** → **Segments** → **New Segment**

```yaml
# Segment: "power-users"
name: "Power Users"
description: "Users with >100 events in last 30 days"
rules:
  - attribute: "custom.events_30d"
    operator: ">"
    value: 100
  - attribute: "user.plan"
    operator: "IN"
    value: ["pro", "enterprise"]
```

Use in flag targeting:
```
IF user IN SEGMENT "power-users" → 100%
```

---

## Release Integration

### Automatic Release Association

Flags are automatically scoped to the release in `Sentry.init()`:

```typescript
// Each release gets its own flag configuration
Sentry.init({
  release: "v2.3.0", // Flags evaluated against v2.3.0 config
  // ...
});
```

### Release Health + Flags Dashboard

**Releases** → Select release → **Feature Flags** tab shows:

| Flag | Rollout | Evaluations | Enabled % | Error Rate (on) | Error Rate (off) |
|------|---------|-------------|-----------|-----------------|------------------|
| new-checkout | 25% | 12,450 | 24.8% | 0.2% | 0.5% |
| dark-mode | 100% | 45,200 | 100% | 0.1% | N/A |
| beta-api-v2 | 10% | 4,520 | 10.1% | 0.8% | 0.3% |

### Correlating Flags with Errors

```typescript
// Automatically added to error context when using SDK evaluation
Sentry.init({
  // ...
  beforeSend(event) {
    // Add current flag state to every error
    const flags = Sentry.getCurrentScope().getFeatureFlags();
    if (flags) {
      event.tags = {
        ...event.tags,
        "feature-flags": JSON.stringify(flags),
      };
    }
    return event;
  },
});
```

In Sentry UI: **Issues** → **Tags** → Filter by `feature-flags.new-checkout = true`

---

## Kill Switches

### Emergency Disable

**Feature Flags** → Select flag → **Kill Switch** → **Disable Immediately**

- Bypasses all targeting rules
- Takes effect within polling interval (default 60s)
- Audit logged with user/timestamp

### Automated Kill Switch (Metric-Based)

```yaml
# sentry/feature-flags.yml (self-hosted config)
feature_flags:
  kill_switches:
    - flag: "new-checkout"
      trigger:
        metric: "error_rate"
        threshold: 0.05  # 5%
        window: "5m"
        min_evaluations: 100
      action: "disable"
      notify: ["#alerts-engineering", "@oncall"]
```

---

## Experimentation Framework

### Running an A/B Test

```typescript
// experiments/checkout-experiment.ts
interface ExperimentResult {
  variant: "control" | "treatment";
  conversion: boolean;
  revenue: number;
}

export async function trackExperiment(
  user: Sentry.User,
  experimentKey: string,
  result: ExperimentResult
) {
  const flags = await getFeatureFlags(user);
  const variant = flags[experimentKey];
  
  // Send to Sentry as custom metric
  Sentry.metrics.increment("experiment.conversion", 1, {
    tags: {
      experiment: experimentKey,
      variant,
      converted: result.conversion.toString(),
    },
  });
  
  if (result.revenue > 0) {
    Sentry.metrics.distribution("experiment.revenue", result.revenue, {
      tags: { experiment: experimentKey, variant },
      unit: "currency:USD",
    });
  }
}
```

### Statistical Significance (Sentry UI)

**Feature Flags** → Select multivariate flag → **Experiment Results**

| Variant | Users | Conversions | Rate | Significance |
|---------|-------|-------------|------|--------------|
| control | 5,000 | 450 | 9.0% | — |
| treatment-a | 2,500 | 280 | 11.2% | p=0.02 ✓ |
| treatment-b | 2,500 | 245 | 9.8% | p=0.31 |

---

## Self-Hosted Configuration

```yaml
# sentry/config.yml
feature_flags:
  enabled: true
  
  # Flag evaluation service
  evaluation:
    # Cache TTL for flag definitions
    cache_ttl: 300  # 5 minutes
    # Max concurrent evaluations
    max_concurrent: 1000
  
  # Storage
  storage:
    backend: "postgres"  # or "redis"
    # Redis for high-throughput
    redis:
      hosts: ["redis:6379"]
      key_prefix: "sentry:ff:"
  
  # Analytics
  analytics:
    enabled: true
    # Sample rate for evaluation events
    sample_rate: 0.1
  
  # API
  api:
    # Rate limiting
    rate_limit: 1000  # per minute per org
```

---

## Best Practices

### Do's ✅

- **Use release-scoped flags** — flags automatically version with your deploy
- **Start with 0% rollout** — gradually increase (1% → 5% → 25% → 100%)
- **Target internal users first** — `user.email ENDS_WITH "@company.com"`
- **Add kill switches** — for every flag, define failure criteria
- **Track flag state in errors** — enables correlation analysis
- **Use segments** — reusable audiences reduce rule duplication
- **Monitor flag health** — check evaluation volume, error rates per variant

### Don'ts ❌

- Don't create flags for every config change — use for user-facing features
- Don't hardcode flag keys in multiple places — use constants
- Don't evaluate flags on every request — cache with TTL
- Don't forget to clean up — remove flags after full rollout
- Don't run experiments without hypotheses — define success metrics first

---

## Migration: LaunchDarkly / Unleash → Sentry

### LaunchDarkly

```typescript
// Before: LaunchDarkly
const ldClient = LDClient.init("client-key");
const showFeature = ldClient.variation("new-feature", user, false);

// After: Sentry
const flags = await getFeatureFlags(user);
const showFeature = flags["new-feature"];
```

### Unleash

```typescript
// Before: Unleash
const unleash = new Unleash({ url, appName, clientKey });
const enabled = unleash.isEnabled("new-feature", context);

// After: Sentry
const flags = await getFeatureFlags(user);
const enabled = flags["new-feature"];
```

### Flag Definition Migration

| LaunchDarkly | Sentry |
|--------------|--------|
| `key` | `key` |
| `variations` | `variants` (multivariate) |
| `targets` | `targeting rules` |
| `rollout` | `rollout percentage` |
| `prerequisites` | `segment dependencies` |

---

## Quick Reference

```typescript
// Initialize with feature flags
Sentry.init({
  release: "v2.3.0",
  featureFlags: {
    fetchOnInit: true,
    pollingInterval: 60_000,
  },
});

// Get flags for user
const flags = await client.evaluateFeatureFlags({ user });

// Boolean check
if (flags["new-checkout"]) { /* ... */ }

// Multivariate
const variant = flags["beta-api-v2"]; // "control" | "treatment-a" | "treatment-b"

// Set user for targeting
Sentry.setUser({ id, email, segment: "beta", beta_opt_in: true });

// Track in metrics
Sentry.metrics.increment("feature.usage", 1, { tags: { flag: "new-checkout" } });
```

---

## Related Documentation

- [Sentry Feature Flags Docs](https://docs.sentry.io/product/feature-flags/)
- [Release Tracking](./02-release-tracking.md) — Releases & deploys
- [Alerting](./06-alerting.md) — Alert on flag-related metrics
- [Performance Monitoring](./03-performance-monitoring.md) — Correlate flags with performance
- [Protocol Spec](./07-protocol-spec.md) — Feature flag evaluation API