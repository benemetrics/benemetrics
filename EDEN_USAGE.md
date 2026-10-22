# Eden Treaty Usage Guide

This project uses `@elysiajs/eden` for type-safe API calls from the React frontend to the Elysia backend.

## Setup

```typescript
// public/src/lib/api.ts
import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../backend/index';

export const api = edenTreaty<App>('');
```

The `App` type is imported from the backend, providing full type safety for all endpoints.

## Basic Usage

### Health Check (Docker liveness probe)
```typescript
const response = await api.health.get();
// response.data -> { status: "ok" }
// response.error -> { message: string, code?: string }
```

### Events
```typescript
// List all events
const events = await api.events.get();

// Clear all events
await api.events.clear.post();

// Get specific event
const event = await api.events['event-id'].get();
```

### DSN Management (requires authentication)
```typescript
// Create DSN
const dsn = await api.api.dsn.create.post({
  projectId: 'my-project',
  host: 'benemetrics.app'
});

// Get DSN by project ID
const dsn = await api.api.dsn['my-project'].get();

// Generate new DSN
const dsn = await api.api.dsn.generate.post({
  projectId: 'my-project',
  host: 'benemetrics.app'
});
```

### Feature Flags (Admin - requires admin auth)
```typescript
// Create flag
const flag = await api.api.admin['feature-flags'].post({
  key: 'new-feature',
  name: 'New Feature',
  type: 'boolean',
  defaultValue: false
});

// List flags
const flags = await api.api.admin['feature-flags'].get();

// Get single flag
const flag = await api.api.admin['feature-flags']['flag-id'].get();

// Update flag
await api.api.admin['feature-flags']['flag-id'].patch({
  name: 'Updated Name'
});

// Update flag status
await api.api.admin['feature-flags']['flag-id'].status.post({
  status: 'active'
});

// Delete flag
await api.api.admin['feature-flags']['flag-id'].delete();
```

### Feature Flags Evaluation (Client - requires DSN auth)
```typescript
const result = await api.api.sentry.flags.evaluate.post({
  user: { 
    id: 'user-123', 
    email: 'user@example.com',
    name: 'John Doe',
    attributes: { plan: 'pro', region: 'us-east' }
  },
  flags: ['new-dashboard', 'experimental-feature'],
  context: { platform: 'web', version: '1.0.0' }
});
```

### Segments (Admin)
```typescript
// Create segment
const segment = await api.api.admin.segments.post({
  name: 'Beta Users',
  description: 'Users in beta program',
  rules: [{ attribute: 'user.attributes.plan', operator: 'equals', value: 'beta' }]
});

// List segments
const segments = await api.api.admin.segments.get();

// Get segment
const segment = await api.api.admin.segments['segment-id'].get();
```

## Error Handling

Every response has this structure:
```typescript
{
  data: T | null,      // Success data
  error: {             // Error info (if failed)
    message: string;
    code?: string;
    status: number;
  } | null;
}
```

```typescript
const response = await api.health.get();

if (response.error) {
  console.error('Error:', response.error.message);
  return;
}

console.log('Success:', response.data);
```

## Type Safety

- All endpoints are fully typed from the backend `App` type
- Request bodies are validated against the backend schema
- Response types match the backend return types
- IDE autocomplete works for all endpoints and parameters

## Authentication

Eden Treaty doesn't automatically add auth headers. You need to:
1. Use the `sentry_key` query parameter for DSN auth
2. Use `Authorization: Bearer <token>` for admin auth

The backend validates these in the route handlers.

## Direct Treaty Access

For any endpoint not wrapped in helpers:
```typescript
// Direct access with full type safety
const response = await api.api.dsn.create.post({
  projectId: 'test',
  host: 'example.com'
});

// Path parameters use bracket notation
const flag = await api.api.admin['feature-flags']['flag-id'].get();
```