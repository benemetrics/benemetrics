# 10. Admin — DSN Management

Admin functionality for managing DSNs (Data Source Names) used by Sentry SDKs.

---

## Overview

Sentry SDKs (Node.js, Python, Go, Java, .NET, Ruby, PHP, Browser, Mobile, etc.) need a valid DSN to send events to the Sentry server. This admin documentation covers how DSNs are created and retrieved.

---

## DSN Format

A Sentry DSN has the following format:

```
https://<PUBLIC_KEY>@<HOST>/<PROJECT_ID>
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| **protocol** | `https` or `http` | `https://` |
| **public_key** | Unique identifier for the project's public key | `a1b2c3d4e5f6` |
| **host** | Sentry server hostname | `sentry.example.com` |
| **project_id** | Numeric project ID | `42` |

### Examples

| Environment | DSN |
|-------------|-----|
| Production | `https://a1b2c3d4e5f6@o123.ingest.sentry.io/456789` |
| Development (local) | `http://a1b2c3d4e5f6@localhost:31337/123` |
| Staging | `https://a1b2c3d4e5f6@staging.example.com/789` |

---

## API Endpoints

### `POST /api/dsn/create`

Creates a new DSN for a given project ID.

**Request:**

```json
{
  "projectId": "123",
  "host": "sentry.example.com",
  "publicKey": "a1b2c3d4e5f6"
}
```

**Response:**

```json
{
  "dsn": "https://a1b2c3d4e5f6@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "a1b2c3d4e5f6",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

### `GET /api/dsn/:projectId`

Retrieves the DSN for an existing project.

**Request:**

```
GET /api/dsn/123
```

**Response:**

```json
{
  "dsn": "https://a1b2c3d4e5f6@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "a1b2c3d4e5f6",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

### `POST /api/dsn/generate`

Generates a new DSN with a randomly generated public key for a given project ID.

**Request:**

```json
{
  "projectId": "123"
}
```

**Response:**

```json
{
  "dsn": "https://b2c3d4e5f6a7b2c3@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "b2c3d4e5f6a7b2c3",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

---

## Usage with Sentry SDKs

### TypeScript / Node.js / Bun / Deno

```typescript
import * as Sentry from "@sentry/node";

const dsn = "https://a1b2c3d4e5f6@sentry.example.com/123";

Sentry.init({
  dsn,
  environment: process.env.NODE_ENV || "development",
  release: process.env.APP_VERSION || "1.0.0",
});
```

### Python

```python
import sentry_sdk

dsn = "https://a1b2c3d4e5f6@sentry.example.com/123"

sentry_sdk.init(
    dsn=dsn,
    environment="development",
    release="1.0.0",
)
```

### Go

```go
import (
    "github.com/getsentry/sentry-go"
)

dsn := "https://a1b2c3d4e5f6@sentry.example.com/123"

err := sentry.Init(sentry.ClientOptions{
    Dsn:      dsn,
    Environment: "development",
    Release:  "1.0.0",
})
```

### Environment Variables

Set the DSN directly from your admin API response:

```bash
DSN_RESPONSE=$(curl -s -X POST http://localhost:31337/api/dsn/create \
  -H "Content-Type: application/json" \
  -d '{"projectId": "123", "host": "sentry.example.com", "publicKey": "a1b2c3d4e5f6"}')

export SENTRY_DSN=$(echo "$DSN_RESPONSE" | jq -r '.dsn')
```

---

## Validation

DSNs must follow the Sentry DSN format. Use the `parseDsn` function to validate:

```typescript
function parseDsn(dsn: string): { publicKey: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.slice(1);
    return { publicKey, projectId };
  } catch {
    return null;
  }
}

// Usage
const parsed = parseDsn("https://a1b2c3d4e5f6@sentry.example.com/123");
console.log(parsed); // { publicKey: "a1b2c3d4e5f6", projectId: "123" }
```

---

## Next Steps

1. Create a DSN via the admin API (`POST /api/dsn/create`)
2. Initialize your Sentry SDK with the generated DSN
3. Test event ingestion by capturing an error

---

## Resources

- [Sentry SDKs](https://docs.sentry.io/platforms/) — All supported platforms
- [DSN format reference](https://develop.sentry.dev/sdk/telemetry/traces/#dsn) — Protocol spec
- [07-protocol-spec.md](./07-protocol-spec.md) — Ingestion API with source references
