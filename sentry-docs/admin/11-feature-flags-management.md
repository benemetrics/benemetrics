# 11. Admin — Feature Flags Management

Admin functionality for managing feature flags, user targeting, A/B testing, and rollout strategies.

---

## Overview

Feature flags allow you to control feature rollouts, run A/B tests, and manage feature access for different user segments without deploying new code.

---

## API Endpoints

### `POST /api/admin/feature-flags`

Create a new feature flag. Requires **Admin OAuth2/OIDC authentication**.

**Request:**
```json
{
  "key": "new-checkout-flow",
  "name": "New Checkout Flow",
  "description": "Enables the redesigned checkout experience",
  "type": "boolean",
  "defaultValue": false,
  "variants": [
    { "key": "control", "name": "Control", "value": false, "weight": 50 },
    { "key": "treatment", "name": "New Flow", "value": true, "weight": 50 }
  ],
  "targetingRules": [],
  "segments": []
}
```

**Response:**
```json
{
  "id": "ff_123",
  "key": "new-checkout-flow",
  "name": "New Checkout Flow",
  "description": "Enables the redesigned checkout experience",
  "type": "boolean",
  "defaultValue": false,
  "variants": [...],
  "targetingRules": [],
  "segments": [],
  "status": "draft",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z",
  "createdBy": "admin@company.com"
}
```

---

### `GET /api/admin/feature-flags`

List all feature flags with filtering and pagination. Requires **Admin OAuth2/OIDC authentication**.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `draft`, `active`, `paused`, `archived` |
| `type` | string | Filter by type: `boolean`, `string`, `number`, `json` |
| `search` | string | Search by key or name |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |

**Response:**
```json
{
  "data": [
    { "id": "ff_123", "key": "new-checkout-flow", "name": "New Checkout Flow", ... },
    { "id": "ff_456", "key": "dark-mode", "name": "Dark Mode", ... }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

---

### `GET /api/admin/feature-flags/:id`

Get a specific feature flag with full details. Requires **Admin OAuth2/OIDC authentication**.

**Response:**
```json
{
  "id": "ff_123",
  "key": "new-checkout-flow",
  "name": "New Checkout Flow",
  "description": "Enables the redesigned checkout experience",
  "type": "boolean",
  "defaultValue": false,
  "variants": [
    { "key": "control", "name": "Control", "value": false, "weight": 50 },
    { "key": "treatment", "name": "New Flow", "value": true, "weight": 50 }
  ],
  "targetingRules": [
    {
      "id": "tr_1",
      "attribute": "user.email",
      "operator": "ends_with",
      "value": "@company.com",
      "variantKey": "treatment"
    }
  ],
  "segments": [
    { "id": "seg_1", "name": "Beta Users", "description": "Early adopters" }
  ],
  "status": "active",
  "rolloutPercentage": 50,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T14:22:00Z",
  "createdBy": "admin@company.com",
  "updatedBy": "admin@company.com"
}
```

---

### `PATCH /api/admin/feature-flags/:id`

Update a feature flag (partial update). Requires **Admin OAuth2/OIDC authentication**.

**Request:**
```json
{
  "name": "Updated Checkout Flow",
  "rolloutPercentage": 75,
  "variants": [
    { "key": "control", "name": "Control", "value": false, "weight": 25 },
    { "key": "treatment", "name": "New Flow", "value": true, "weight": 75 }
  ]
}
```

---

### `POST /api/admin/feature-flags/:id/status`

Change feature flag status. Requires **Admin OAuth2/OIDC authentication**.

**Request:**
```json
{ "status": "active" }
```

**Valid statuses:** `draft`, `active`, `paused`, `archived`

---

### `DELETE /api/admin/feature-flags/:id`

Delete a feature flag (only allowed for `draft` status). Requires **Admin OAuth2/OIDC authentication**.

---

## Targeting Rules

Targeting rules determine which users receive which variant.

### Rule Structure
```json
{
  "id": "tr_1",
  "attribute": "user.email",
  "operator": "equals|not_equals|contains|not_contains|starts_with|ends_with|in|not_in|greater_than|less_than",
  "value": "value_to_match",
  "variantKey": "treatment"
}
```

### Supported Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| `user.id` | string | User ID |
| `user.email` | string | User email |
| `user.name` | string | User name |
| `user.createdAt` | date | Account creation date |
| `user.custom.*` | any | Custom user attributes |
| `context.ip` | string | Client IP address |
| `context.country` | string | Country code (ISO) |
| `context.device` | string | Device type |
| `context.browser` | string | Browser name |

### Operators by Type
| Attribute Type | Operators |
|----------------|-----------|
| String | `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in`, `not_in` |
| Number | `equals`, `not_equals`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `in`, `not_in` |
| Date | `before`, `after`, `on`, `between` |
| Boolean | `equals`, `not_equals` |
| Array | `in`, `not_in`, `contains`, `not_contains` |

---

## Segments

Segments are reusable user groups that can be targeted across multiple feature flags.

### `POST /api/admin/segments`

Create a new segment. Requires **Admin OAuth2/OIDC authentication**.

**Request:**
```json
{
  "name": "Premium Users",
  "description": "Users with active premium subscription",
  "rules": [
    { "attribute": "user.custom.subscription_tier", "operator": "equals", "value": "premium" },
    { "attribute": "user.custom.subscription_status", "operator": "equals", "value": "active" }
  ]
}
```

### `GET /api/admin/segments`

List all segments. Requires **Admin OAuth2/OIDC authentication**.

### `GET /api/admin/segments/:id`

Get segment with user count and matching users preview. Requires **Admin OAuth2/OIDC authentication**.

**Response:**
```json
{
  "id": "seg_1",
  "name": "Premium Users",
  "description": "Users with active premium subscription",
  "rules": [...],
  "userCount": 1250,
  "sampleUsers": [
    { "id": "user_1", "email": "john@example.com", "name": "John Doe" },
    { "id": "user_2", "email": "jane@example.com", "name": "Jane Smith" }
  ],
  "createdAt": "2024-01-10T09:00:00Z",
  "updatedAt": "2024-01-15T11:30:00Z"
}
```

---

## A/B Testing

### Experiment Configuration

Feature flags support A/B testing through variant weights and statistical analysis.

```json
{
  "key": "checkout-button-color",
  "name": "Checkout Button Color Test",
  "type": "string",
  "defaultValue": "blue",
  "variants": [
    { "key": "control", "name": "Blue Button", "value": "blue", "weight": 33 },
    { "key": "variant_a", "name": "Green Button", "value": "green", "weight": 33 },
    { "key": "variant_b", "name": "Orange Button", "value": "orange", "weight": 34 }
  ],
  "experiment": {
    "enabled": true,
    "hypothesis": "Green button will increase conversion by 5%",
    "primaryMetric": "checkout_completion_rate",
    "minimumSampleSize": 1000,
    "confidenceLevel": 0.95,
    "minimumDetectableEffect": 0.05
  }
}
```

### `GET /api/sentry/flags/:id/experiment/results`

Get experiment results with statistical significance.

**Response:**
```json
{
  "featureFlagId": "ff_123",
  "experiment": {
    "enabled": true,
    "hypothesis": "Green button will increase conversion by 5%",
    "primaryMetric": "checkout_completion_rate",
    "status": "running",
    "startedAt": "2024-01-15T10:30:00Z"
  },
  "variants": [
    {
      "key": "control",
      "name": "Blue Button",
      "participants": 3421,
      "conversions": 1026,
      "conversionRate": 0.300,
      "confidenceInterval": [0.284, 0.316]
    },
    {
      "key": "variant_a",
      "name": "Green Button",
      "participants": 3387,
      "conversions": 1112,
      "conversionRate": 0.328,
      "confidenceInterval": [0.312, 0.344],
      "pValue": 0.003,
      "isSignificant": true,
      "relativeImprovement": 0.093
    },
    {
      "key": "variant_b",
      "name": "Orange Button",
      "participants": 3412,
      "conversions": 998,
      "conversionRate": 0.292,
      "confidenceInterval": [0.276, 0.308],
      "pValue": 0.42,
      "isSignificant": false,
      "relativeImprovement": -0.027
    }
  ],
  "recommendation": {
    "winner": "variant_a",
    "confidence": "high",
    "action": "implement"
  }
}
```

---

## User Dashboard

### `GET /api/sentry/flags/:id/users`

Get users assigned to each variant for a feature flag.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `variantKey` | string | Filter by variant |
| `page` | number | Page number |
| `limit` | number | Items per page |
| `search` | string | Search by user ID, email, or name |

**Response:**
```json
{
  "featureFlagId": "ff_123",
  "variants": {
    "control": {
      "userCount": 15420,
      "users": [
        { "id": "user_1", "email": "john@example.com", "name": "John Doe", "attributes": {...}, "assignedAt": "2024-01-15T10:30:00Z" }
      ]
    },
    "treatment": {
      "userCount": 15380,
      "users": [
        { "id": "user_2", "email": "jane@example.com", "name": "Jane Smith", "attributes": {...}, "assignedAt": "2024-01-15T10:31:00Z" }
      ]
    }
  },
  "pagination": { "page": 1, "limit": 50, "total": 30800 }
}
```

### `GET /api/sentry/flags/:id/user/:userId`

Get feature flag evaluation for a specific user.

**Response:**
```json
{
  "featureFlagId": "ff_123",
  "userId": "user_123",
  "variantKey": "treatment",
  "variantValue": true,
  "matchedRule": "tr_1",
  "matchedSegment": "seg_1",
  "reason": "Matched targeting rule: user.email ends_with @company.com",
  "evaluatedAt": "2024-01-15T15:45:00Z"
}
```

---

## Evaluation API (Client-Side - DSN Authentication)

### `POST /api/sentry/flags/evaluate`

Evaluate feature flags for a user context (used by SDKs). Requires **Sentry DSN authentication** (sentry_key query param or Bearer token with DSN public key).

**Request:**
```json
{
  "user": {
    "id": "user_123",
    "email": "john@company.com",
    "name": "John Doe",
    "custom": {
      "subscription_tier": "premium",
      "role": "admin"
    }
  },
  "context": {
    "ip": "192.168.1.1",
    "country": "US",
    "device": "desktop",
    "browser": "chrome"
  },
  "flags": ["new-checkout-flow", "dark-mode", "beta-features"]
}
```

**Response:**
```json
{
  "evaluations": [
    {
      "flagKey": "new-checkout-flow",
      "variantKey": "treatment",
      "value": true,
      "reason": "Matched segment: Beta Users"
    },
    {
      "flagKey": "dark-mode",
      "variantKey": "control",
      "value": false,
      "reason": "Default value (no matching rules)"
    }
  ],
  "evaluatedAt": "2024-01-15T15:45:00Z"
}
```

---

## OpenFlag Evaluation API (OpenFeature-compatible)

### `POST /v1/flags/:key`

Evaluate a single flag for a user, using the [OpenFeature Web Flag Evaluation API](https://openfeature.dev) ("OpenFlag") wire format — one flag per request, targeted by `targetingKey`.

**Request:**
```json
{
  "targetingKey": "user_123",
  "context": {
    "email": "john@company.com",
    "subscription_tier": "premium"
  }
}
```

**Response (success):**
```json
{
  "variant": "treatment",
  "value": true,
  "reason": "Matched segment: Beta Users"
}
```

**Response (unknown flag):**
```json
{
  "variant": "default",
  "value": null,
  "reason": "Feature flag not found",
  "errorCode": "FLAG_NOT_FOUND"
}
```

---

## Audit Log

### `GET /api/admin/feature-flags/:id/audit`

Get audit trail for a feature flag. Requires **Admin OAuth2/OIDC authentication**.

**Response:**
```json
{
  "entries": [
    {
      "id": "audit_1",
      "action": "status_changed",
      "field": "status",
      "oldValue": "draft",
      "newValue": "active",
      "user": "admin@company.com",
      "timestamp": "2024-01-15T14:22:00Z",
      "ip": "192.168.1.100"
    },
    {
      "id": "audit_2",
      "action": "updated",
      "field": "rolloutPercentage",
      "oldValue": 50,
      "newValue": 75,
      "user": "admin@company.com",
      "timestamp": "2024-01-16T09:15:00Z"
    }
  ]
}
```

---

## SDK Integration

### TypeScript / Node.js / Browser

```typescript
import { FeatureFlagsClient } from "@sentry/feature-flags";

const client = new FeatureFlagsClient({
  dsn: process.env.SENTRY_DSN,
  organization: "my-org",
  project: "my-project"
});

// Evaluate flags for a user
const flags = await client.evaluate({
  userId: "user_123",
  email: "john@company.com",
  custom: { subscription_tier: "premium" }
});

// Check a specific flag
if (flags["new-checkout-flow"]) {
  // Show new checkout
}

// Track experiment event
client.track("checkout_completion", {
  flagKey: "checkout-button-color",
  variantKey: flags["checkout-button-color"]?.variantKey
});
```

### React Hook

```tsx
import { useFeatureFlag } from "@sentry/feature-flags/react";

function CheckoutButton() {
  const { value: showNewFlow } = useFeatureFlag("new-checkout-flow");
  const { value: buttonColor } = useFeatureFlag("checkout-button-color");
  
  return (
    <button className={`btn btn-${buttonColor}`}>
      {showNewFlow ? "New Checkout" : "Checkout"}
    </button>
  );
}
```

---

## Rollout Strategies

### Percentage Rollout
Gradually increase rollout percentage:
```
Week 1: 10% → Week 2: 25% → Week 3: 50% → Week 4: 100%
```

### Canary Release
Target specific users first:
```json
{
  "targetingRules": [
    { "attribute": "user.id", "operator": "in", "value": ["internal-user-1", "internal-user-2"], "variantKey": "treatment" }
  ]
}
```

### Progressive Rollout with Metrics Guard
Automatically pause if error rate increases:
```json
{
  "experiment": {
    "enabled": true,
    "guardrailMetrics": [
      { "metric": "error_rate", "threshold": 0.01, "action": "pause" },
      { "metric": "latency_p99", "threshold": 2000, "action": "pause" }
    ]
  }
}
```

---

## Best Practices

1. **Use descriptive keys** - `new-checkout-flow` not `flag1`
2. **Add descriptions** - Explain what the flag controls
3. **Set default values** - Safe fallback when flag is unavailable
4. **Use segments** - Reusable targeting across flags
5. **Monitor experiments** - Check statistical significance before deciding
6. **Clean up** - Archive flags after full rollout
7. **Audit changes** - Track who changed what and when

---

## Security

- Feature flag evaluations are authenticated via DSN
- Admin API requires separate authentication (OAuth2/OIDC)
- User PII in targeting rules is hashed in logs
- Audit logs retained for compliance

---

## Related Documentation

- [09-feature-flags.md](../09-feature-flags.md) — Feature flag implementation guide
- [10-dsn-creation-api.md](./10-dsn-creation-api.md) — DSN management for SDK authentication
- [08-authentication.md](../08-authentication.md) — Authentication methods