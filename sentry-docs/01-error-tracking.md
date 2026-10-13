# 1. Error Tracking — Platform Agnostic

Complete guide to capturing, enriching, and managing errors in any application with Sentry.

## Installation

```bash
# Node.js / Bun / Deno
npm install @sentry/node        # Node.js
# bun add @sentry/bun           # Bun
# deno add @sentry/deno         # Deno

# Python
pip install sentry-sdk

# Go
go get github.com/getsentry/sentry-go

# Java (Maven)
<dependency>
  <groupId>io.sentry</groupId>
  <artifactId>sentry</artifactId>
  <version>7.0.0</version>
</dependency>

# .NET
dotnet add package Sentry

# Ruby
gem install sentry-ruby

# PHP
composer require sentry/sentry

# Browser
npm install @sentry/browser
```

## Basic Setup

### TypeScript / Node.js / Bun / Deno

```typescript
import * as Sentry from "@sentry/node"; // or @sentry/bun, @sentry/deno

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: process.env.APP_VERSION || "1.0.0",
});

// Your application code
app.get("/users/:id", (req, res) => {
  throw new Error("Database connection failed"); // Auto-captured
});
```

### Python

```python
import sentry_sdk
import os

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    environment=os.getenv("ENVIRONMENT", "development"),
    release=os.getenv("APP_VERSION", "1.0.0"),
)

# Your application code
@app.route("/users/<id>")
def get_user(id):
    raise Exception("Database connection failed")  # Auto-captured
```

### Go

```go
package main

import (
    "os"
    "github.com/getsentry/sentry-go"
)

func main() {
    sentry.Init(sentry.ClientOptions{
        Dsn: os.Getenv("SENTRY_DSN"),
        Environment: getEnv("ENVIRONMENT", "development"),
        Release: getEnv("APP_VERSION", "1.0.0"),
    })
    defer sentry.Flush(2 * time.Second)

    // Your application code
    http.HandleFunc("/users/", func(w http.ResponseWriter, r *http.Request) {
        panic("Database connection failed") // Auto-captured
    })
}
```

### Java

```java
import io.sentry.Sentry;
import io.sentry.SentryOptions;

public class Application {
    public static void main(String[] args) {
        Sentry.init(options -> {
            options.setDsn(System.getenv("SENTRY_DSN"));
            options.setEnvironment(System.getenv("ENVIRONMENT"));
            options.setRelease(System.getenv("APP_VERSION"));
        });

        // Your application code
        // throw new RuntimeException("Database connection failed"); // Auto-captured
    }
}
```

### .NET

```csharp
using Sentry;

public class Program {
    public static void Main() {
        using (SentrySdk.Init(o => {
            o.Dsn = Environment.GetEnvironmentVariable("SENTRY_DSN");
            o.Environment = Environment.GetEnvironmentVariable("ENVIRONMENT");
            o.Release = Environment.GetEnvironmentVariable("APP_VERSION");
        })) {
            // Your application code
            // throw new Exception("Database connection failed"); // Auto-captured
        }
    }
}
```

## Automatic Error Capture

All SDKs automatically capture:

| Error Type | Description |
|------------|-------------|
| **Uncaught exceptions** | Unhandled `throw` / `raise` / `panic` in request handlers |
| **Unhandled promise rejections** | `unhandledrejection` (JS), `Task` exceptions (.NET), etc. |
| **Uncaught exceptions** | `process.on("uncaughtException")` (Node), `sys.excepthook` (Python), etc. |
| **Framework errors** | Express, FastAPI, Gin, Spring, ASP.NET middleware errors |

## Manual Error Capture

### TypeScript / Node.js / Bun / Deno

```typescript
import * as Sentry from "@sentry/node";

try {
  await riskyDatabaseOperation();
} catch (error) {
  Sentry.captureException(error, {
    extra: {
      userId: user.id,
      operation: "payment_processing",
      orderId: order.id,
    },
    tags: {
      service: "payments",
      critical: "true",
    },
    level: "error", // "fatal" | "error" | "warning" | "info" | "debug"
  });
  
  // Capture a message without exception
  Sentry.captureMessage("Payment gateway timeout", "warning");
}
```

### Python

```python
import sentry_sdk

try:
    risky_database_operation()
except Exception as e:
    sentry_sdk.capture_exception(e, 
        extra={
            "user_id": user.id,
            "operation": "payment_processing",
            "order_id": order.id,
        },
        tags={
            "service": "payments",
            "critical": "true",
        },
        level="error"  # "fatal" | "error" | "warning" | "info" | "debug"
    )
    
    # Capture a message without exception
    sentry_sdk.capture_message("Payment gateway timeout", "warning")
```

### Go

```go
import "github.com/getsentry/sentry-go"

func processPayment() {
    defer func() {
        if err := recover(); err != nil {
            sentry.CaptureException(err, nil, sentry.ScopeOptions{
                Extra: map[string]interface{}{
                    "user_id": user.ID,
                    "operation": "payment_processing",
                    "order_id": order.ID,
                },
                Tags: map[string]string{
                    "service": "payments",
                    "critical": "true",
                },
                Level: sentry.LevelError,
            })
        }
    }()
    
    riskyDatabaseOperation()
}
```

### Java

```java
import io.sentry.Sentry;
import io.sentry.SentryLevel;

try {
    riskyDatabaseOperation();
} catch (Exception e) {
    Sentry.captureException(e, scope -> {
        scope.setExtra("user_id", user.getId());
        scope.setExtra("operation", "payment_processing");
        scope.setExtra("order_id", order.getId());
        scope.setTag("service", "payments");
        scope.setTag("critical", "true");
        scope.setLevel(SentryLevel.ERROR);
    });
    
    // Capture a message without exception
    Sentry.captureMessage("Payment gateway timeout", SentryLevel.WARNING);
}
```

### .NET

```csharp
using Sentry;

try {
    await RiskyDatabaseOperation();
} catch (Exception e) {
    SentrySdk.CaptureException(e, scope => {
        scope.SetExtra("user_id", user.Id);
        scope.SetExtra("operation", "payment_processing");
        scope.SetExtra("order_id", order.Id);
        scope.SetTag("service", "payments");
        scope.SetTag("critical", "true");
        scope.Level = SentryLevel.Error;
    });
    
    // Capture a message without exception
    SentrySdk.CaptureMessage("Payment gateway timeout", SentryLevel.Warning);
}
```

## Enriching Errors with Context

### User Context

```typescript
// TypeScript
Sentry.setUser({
  id: "user_123",
  email: "user@example.com",
  username: "johndoe",
  ip_address: "{{auto}}", // Auto-detect from request
  segment: "premium",
});

// Clear on logout
Sentry.setUser(null);
```

```python
# Python
sentry_sdk.set_user({
    "id": "user_123",
    "email": "user@example.com",
    "username": "johndoe",
    "ip_address": "{{auto}}",
    "segment": "premium",
})

# Clear on logout
sentry_sdk.set_user(None)
```

```go
// Go
sentry.ConfigureScope(func(scope *sentry.Scope) {
    scope.SetUser(sentry.User{
        ID: "user_123",
        Email: "user@example.com",
        Username: "johndoe",
        IPAddress: "{{auto}}",
        Data: map[string]string{"segment": "premium"},
    })
})

// Clear on logout
sentry.ConfigureScope(func(scope *sentry.Scope) {
    scope.SetUser(sentry.User{})
})
```

### Tags (Searchable/Filterable)

```typescript
// TypeScript
Sentry.setTags({
  service: "api",
  version: "2.3.1",
  feature: "checkout",
  region: "us-east-1",
});

Sentry.setTag("request_id", crypto.randomUUID());
```

```python
# Python
sentry_sdk.set_tags({
    "service": "api",
    "version": "2.3.1",
    "feature": "checkout",
    "region": "us-east-1",
})

sentry_sdk.set_tag("request_id", str(uuid.uuid4()))
```

### Extra Data (Non-searchable, visible in UI)

```typescript
// TypeScript
Sentry.setExtras({
  requestBody: sanitize(reqBody),
  queryParams: Object.fromEntries(new URL(req.url).searchParams),
  headers: Object.fromEntries(req.headers.entries()),
});
```

```python
# Python
sentry_sdk.set_context("request", {
    "body": sanitize(request.json),
    "query_params": dict(request.args),
    "headers": dict(request.headers),
})
```

### Custom Context Objects

```typescript
// TypeScript
Sentry.setContext("order", {
  id: "ord_456",
  total: 99.99,
  currency: "USD",
  items: 3,
});

Sentry.setContext("payment", {
  provider: "stripe",
  method: "card",
  last4: "4242",
});
```

```python
# Python
sentry_sdk.set_context("order", {
    "id": "ord_456",
    "total": 99.99,
    "currency": "USD",
    "items": 3,
})

sentry_sdk.set_context("payment", {
    "provider": "stripe",
    "method": "card",
    "last4": "4242",
})
```

## Request/Response Context (Automatic)

Most server SDKs automatically capture HTTP context when integrated with frameworks:

| Platform | Framework Integration | Auto-captures |
|----------|----------------------|---------------|
| Node.js | Express, Koa, Fastify, Hono, Elysia | Method, URL, headers, query, body, status |
| Python | Flask, Django, FastAPI, Starlette | Method, URL, headers, query, body, status |
| Go | Gin, Echo, Chi, stdlib | Method, URL, headers, query, status |
| Java | Spring, Servlet, Vert.x | Method, URL, headers, query, status |
| .NET | ASP.NET Core | Method, URL, headers, query, body, status |
| Ruby | Rails, Rack, Sinatra | Method, URL, headers, query, body, status |
| PHP | Laravel, Symfony, Slim | Method, URL, headers, query, body, status |

### Enable Request Body Capture

```typescript
// TypeScript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  requestBody: "always", // "never" | "small" | "medium" | "always"
});
```

```python
# Python
sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    request_bodies="always",  # "never" | "small" | "medium" | "always"
)
```

## Filtering & Sampling

### Before Send Hook

```typescript
// TypeScript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  beforeSend(event, hint) {
    // Drop health check errors
    if (event.request?.url?.includes("/health")) return null;
    
    // Drop specific error types
    if (event.exception?.values?.[0]?.type === "ValidationError") return null;
    
    // Scrub sensitive data
    if (event.request?.data) {
      event.request.data = sanitize(event.request.data);
    }
    
    return event;
  },
});
```

```python
# Python
def before_send(event, hint):
    # Drop health check errors
    if event.get("request", {}).get("url", "").includes("/health"):
        return None
    
    # Drop specific error types
    if event.get("exception", {}).get("values", [{}])[0].get("type") == "ValidationError":
        return None
    
    # Scrub sensitive data
    if event.get("request", {}).get("data"):
        event["request"]["data"] = sanitize(event["request"]["data"])
    
    return event

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    before_send=before_send,
)
```

### Ignore Specific Errors

```typescript
// TypeScript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  ignoreErrors: [
    "NetworkError",
    "ResizeObserver loop",
    /^Script error\.?$/,
  ],
  denyUrls: [
    /browser-extension/,
  ],
});
```

```python
# Python
sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    ignore_errors=[
        "NetworkError",
        "ResizeObserver loop",
        "Script error",
    ],
    deny_urls=[
        "browser-extension",
    ],
)
```

## Error Grouping (Fingerprinting)

Sentry groups errors by **fingerprint**. Customize when needed:

```typescript
// TypeScript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  beforeSend(event) {
    if (event.exception?.values?.[0]?.type === "DatabaseError") {
      // Group by error code, not message
      const code = event.exception.values[0].value?.match(/\((\w+)\)/)?.[1];
      if (code) event.fingerprint = ["database-error", code];
    }
    return event;
  },
});
```

```python
# Python
def before_send(event, hint):
    if event.get("exception", {}).get("values", [{}])[0].get("type") == "DatabaseError":
        import re
        match = re.search(r'\((\w+)\)', event["exception"]["values"][0].get("value", ""))
        if match:
            event["fingerprint"] = ["database-error", match.group(1)]
    return event
```

## Platform-Specific Features

### Node.js / Bun / Deno: Top-Level Await Errors

```typescript
// Errors in top-level await are captured automatically
const db = await connectToDatabase(); // If this throws, Sentry captures it
```

### Node.js / Bun: Worker Threads

```typescript
// Each worker needs its own init
// worker.ts
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN });
```

### Python: Celery / Background Tasks

```python
# Celery integration
from sentry_sdk.integrations.celery import CeleryIntegration

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    integrations=[CeleryIntegration()],
)
```

### Go: Goroutines

```go
// Wrap goroutines with sentry.Recover
go func() {
    defer sentry.Recover()
    // Your goroutine code
}()
```

## Testing Error Capture

```typescript
// TypeScript test
import * as Sentry from "@sentry/node";
import { initSentry } from "./sentry.config";

initSentry({ dsn: process.env.SENTRY_DSN! });

// Test unhandled exception
throw new Error("Test error");

// Test manual capture
Sentry.captureMessage("Test message", "info");

// Test with context
try {
  JSON.parse("invalid json");
} catch (e) {
  Sentry.captureException(e, { tags: { test: "true" } });
}
```

```python
# Python test
import sentry_sdk
from sentry_config import init_sentry

init_sentry(dsn=os.getenv("SENTRY_DSN"))

# Test unhandled exception
raise Exception("Test error")

# Test manual capture
sentry_sdk.capture_message("Test message", "info")

# Test with context
try:
    json.loads("invalid json")
except Exception as e:
    sentry_sdk.capture_exception(e, tags={"test": "true"})
```

## Common Patterns

### Middleware Wrapper (Express/Fastify/Hono/Elysia)

```typescript
// TypeScript
function withSentry(handler) {
  return async (req, res, next) => {
    const transaction = Sentry.startInactiveSpan({ name: req.url });
    
    try {
      Sentry.setTag("route", req.path);
      return await handler(req, res, next);
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    } finally {
      transaction.end();
    }
  };
}

app.get("/users/:id", withSentry(async (req, res) => {
  // Your handler
}));
```

```python
# Python (FastAPI/Starlette middleware)
from starlette.middleware.base import BaseHTTPMiddleware

class SentryMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        transaction = sentry_sdk.start_transaction(name=request.url.path)
        try:
            sentry_sdk.set_tag("route", request.url.path)
            response = await call_next(request)
            return response
        except Exception as e:
            sentry_sdk.capture_exception(e)
            raise
        finally:
            transaction.finish()
```

### Global Error Handlers

```typescript
// TypeScript (Node.js)
process.on("unhandledRejection", (reason, promise) => {
  Sentry.captureException(reason, {
    extra: { promise: promise.toString() },
  });
});

process.on("uncaughtException", (error) => {
  Sentry.captureException(error, { level: "fatal" });
  setTimeout(() => process.exit(1), 1000);
});
```

```python
# Python
import sys

def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    sentry_sdk.capture_exception(exc_value, level="fatal")

sys.excepthook = handle_exception
```

## Verification Checklist

- [ ] DSN configured via env var
- [ ] `Sentry.init()` called at application startup
- [ ] User context set in auth middleware
- [ ] Request body capture enabled
- [ ] `beforeSend` filters health checks
- [ ] Custom tags for service/version/feature
- [ ] Test error appears in Sentry UI
- [ ] Source maps / debug symbols uploaded (for minified/compiled code)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Errors not appearing | Check DSN, network, `debug: true` in init |
| Duplicate grouping | Adjust `fingerprint` in `beforeSend` |
| Too many events | Lower `tracesSampleRate`, add `ignoreErrors` |
| Missing stack traces | Ensure source maps / debug symbols uploaded |
| PII in events | Use `beforeSend` to scrub, enable `sendDefaultPii: false` |

## Next: [Release Tracking →](./02-release-tracking.md)