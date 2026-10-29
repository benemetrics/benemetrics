# 5. Breadcrumbs — Platform Agnostic

Automatic timeline of events leading to errors — your application's "flight recorder."

## What Are Breadcrumbs?

Breadcrumbs are **lightweight events** captured automatically (or manually) that create a chronological trail before an error. They appear in Sentry's issue view under the "Breadcrumbs" tab.

```
┌─────────────────────────────────────────────────────────────────┐
│ BREADCRUMBS (most recent first)                                 │
├─────────────────────────────────────────────────────────────────┤
│ 14:32:15.123  🌐 HTTP GET /api/orders/456  → 200 OK (45ms)     │
│ 14:32:14.987  🗄️  DB SELECT * FROM orders WHERE id=456 (12ms)  │
│ 14:32:14.890  🔐 Auth: JWT verified for user_123                │
│ 14:32:14.850  📥 Request received: GET /api/orders/456          │
│ 14:32:10.200  🖱️  Click: button#load-orders                     │
│ 14:32:08.100  🧭 Navigation: /dashboard → /orders               │
└─────────────────────────────────────────────────────────────────┘
```

## Automatic Breadcrumbs (Built-in)

Most SDKs automatically capture breadcrumbs for common operations:

| Platform | HTTP Client           | HTTP Server         | Database                | Console         | Navigation (Frontend) | UI (Frontend)        |
| -------- | --------------------- | ------------------- | ----------------------- | --------------- | --------------------- | -------------------- |
| Node.js  | ✅ fetch, axios       | ✅ Express, Fastify | ✅ pg, mysql, prisma    | ✅ console.*    | —                     | —                    |
| Python   | ✅ requests, httpx    | ✅ Flask, FastAPI   | ✅ psycopg2, SQLAlchemy | ✅ logging      | —                     | —                    |
| Go       | ✅ net/http           | ✅ Gin, Echo        | ✅ database/sql, GORM   | ✅ log/slog     | —                     | —                    |
| Java     | ✅ HttpClient, OkHttp | ✅ Spring, Servlet  | ✅ JDBC, JPA            | ✅ SLF4J, Log4j | —                     | —                    |
| .NET     | ✅ HttpClient         | ✅ ASP.NET Core     | ✅ EF Core, Dapper      | ✅ ILogger      | —                     | —                    |
| Ruby     | ✅ Net::HTTP, Faraday | ✅ Rails, Rack      | ✅ ActiveRecord, Sequel | ✅ Rails.logger | —                     | —                    |
| PHP      | ✅ Guzzle, HttpClient | ✅ Laravel, Symfony | ✅ PDO, Doctrine        | ✅ Monolog      | —                     | —                    |
| Browser  | ✅ fetch, XHR         | —                   | —                       | ✅ console.*    | ✅ History API        | ✅ Clicks, inputs    |
| Mobile   | ✅ Native clients     | —                   | —                       | ✅ Native logs  | ✅ Navigation         | ✅ Touches, gestures |

### Enable/Disable Categories

```typescript
// TypeScript / Node.js / Bun / Deno
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  autoBreadcrumbs: {
    http: true, // Incoming/outgoing HTTP
    console: true, // Console logs
    db: true, // Database queries
  },
});
```

```python
# Python
sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    auto_breadcrumbs={
        "http": True,
        "console": True,
        "db": True,
    },
)
```

```go
// Go
sentry.Init(sentry.ClientOptions{
    Dsn: os.Getenv("SENTRY_DSN"),
    // Auto breadcrumbs enabled by default for supported integrations
    // Disable specific ones via integrations config
})
```

```java
// Java
Sentry.init(options -> {
    options.setDsn(System.getenv("SENTRY_DSN"));
    // Auto breadcrumbs configured via integrations
    // options.enableAutoBreadcrumbs(true); // default
});
```

## Custom Breadcrumbs

### Adding Breadcrumbs Manually

```typescript
// TypeScript / Node.js / Bun / Deno
import * as Sentry from "@sentry/node";

Sentry.addBreadcrumb({
  category: "auth",
  message: "User logged in",
  level: "info",
  data: {
    userId: "user_123",
    method: "oauth",
    provider: "github",
  },
});

Sentry.addBreadcrumb({
  category: "payment",
  message: "Stripe charge created",
  level: "info",
  data: {
    chargeId: "ch_456",
    amount: 9900,
    currency: "usd",
  },
  timestamp: Date.now() / 1000, // Unix seconds (optional)
});
```

```python
# Python
import sentry_sdk

sentry_sdk.add_breadcrumb(
    category="auth",
    message="User logged in",
    level="info",
    data={
        "user_id": "user_123",
        "method": "oauth",
        "provider": "github",
    },
)

sentry_sdk.add_breadcrumb(
    category="payment",
    message="Stripe charge created",
    level="info",
    data={
        "charge_id": "ch_456",
        "amount": 9900,
        "currency": "usd",
    },
    timestamp=time.time(),  # Unix seconds (optional)
)
```

```go
// Go
import "github.com/getsentry/sentry-go"

sentry.AddBreadcrumb(&sentry.Breadcrumb{
    Category: "auth",
    Message: "User logged in",
    Level: sentry.LevelInfo,
    Data: map[string]interface{}{
        "user_id": "user_123",
        "method": "oauth",
        "provider": "github",
    },
    Timestamp: time.Now(),
})

sentry.AddBreadcrumb(&sentry.Breadcrumb{
    Category: "payment",
    Message: "Stripe charge created",
    Level: sentry.LevelInfo,
    Data: map[string]interface{}{
        "charge_id": "ch_456",
        "amount": 9900,
        "currency": "usd",
    },
    Timestamp: time.Now(),
})
```

```java
// Java
import io.sentry.Sentry;
import io.sentry.Breadcrumb;
import io.sentry.SentryLevel;

Sentry.addBreadcrumb(new Breadcrumb()
    .setCategory("auth")
    .setMessage("User logged in")
    .setLevel(SentryLevel.INFO)
    .setData(Map.of(
        "user_id", "user_123",
        "method", "oauth",
        "provider", "github"
    ))
);

Sentry.addBreadcrumb(new Breadcrumb()
    .setCategory("payment")
    .setMessage("Stripe charge created")
    .setLevel(SentryLevel.INFO)
    .setData(Map.of(
        "charge_id", "ch_456",
        "amount", 9900,
        "currency", "usd"
    ))
);
```

```csharp
// .NET
using Sentry;

SentrySdk.AddBreadcrumb(new Breadcrumb
{
    Category = "auth",
    Message = "User logged in",
    Level = BreadcrumbLevel.Info,
    Data = new Dictionary<string, object>
    {
        { "user_id", "user_123" },
        { "method", "oauth" },
        { "provider", "github" }
    },
    Timestamp = DateTimeOffset.UtcNow
});

SentrySdk.AddBreadcrumb(new Breadcrumb
{
    Category = "payment",
    Message = "Stripe charge created",
    Level = BreadcrumbLevel.Info,
    Data = new Dictionary<string, object>
    {
        { "charge_id", "ch_456" },
        { "amount", 9900 },
        { "currency", "usd" }
    },
    Timestamp = DateTimeOffset.UtcNow
});
```

### Breadcrumb Levels

| Level     | Use Case               | Color in UI |
| --------- | ---------------------- | ----------- |
| `debug`   | Verbose debugging      | Gray        |
| `info`    | General info (default) | Blue        |
| `warning` | Potential issues       | Yellow      |
| `error`   | Errors (non-fatal)     | Red         |
| `fatal`   | Critical failures      | Red (bold)  |

### Breadcrumb Categories (Standard)

Use standard categories for better filtering across platforms:

```typescript
// Standard categories (use these for consistency)
const CATEGORIES = {
  // HTTP
  "http.request": "Outgoing HTTP request",
  "http.response": "HTTP response received",

  // Database
  "db.query": "Database query executed",
  "db.transaction": "Transaction started/committed",

  // Cache
  "cache.hit": "Cache hit",
  "cache.miss": "Cache miss",
  "cache.set": "Cache write",

  // Auth
  "auth.login": "User login",
  "auth.logout": "User logout",
  "auth.token_refresh": "Token refreshed",

  // Business logic
  "checkout.started": "Checkout initiated",
  "checkout.payment": "Payment processed",
  "checkout.completed": "Order confirmed",

  // Queue/Jobs
  "queue.enqueue": "Job queued",
  "queue.process": "Job processing",
  "queue.complete": "Job completed",

  // Custom
  "app.feature_flag": "Feature flag evaluated",
  "app.config_change": "Config updated",
};
```

## Platform-Specific Breadcrumbs

### Child Processes / Background Jobs

```typescript
// TypeScript
async function runMigration() {
  Sentry.addBreadcrumb({
    category: "process.spawn",
    message: "Starting database migration",
    level: "info",
    data: { command: "npm run migrate" },
  });

  const proc = spawn("npm", ["run", "migrate"]);

  proc.on("close", (code) => {
    Sentry.addBreadcrumb({
      category: "process.exit",
      message: `Migration ${code === 0 ? "succeeded" : "failed"}`,
      level: code === 0 ? "info" : "error",
      data: { exitCode: code },
    });
  });
}
```

```python
# Python
import subprocess

def run_migration():
    sentry_sdk.add_breadcrumb(
        category="process.spawn",
        message="Starting database migration",
        level="info",
        data={"command": "python manage.py migrate"},
    )
    
    result = subprocess.run(["python", "manage.py", "migrate"], capture_output=True)
    
    sentry_sdk.add_breadcrumb(
        category="process.exit",
        message=f"Migration {'succeeded' if result.returncode == 0 else 'failed'}",
        level="info" if result.returncode == 0 else "error",
        data={"exit_code": result.returncode},
    )
```

```go
// Go
func runMigration() {
    sentry.AddBreadcrumb(&sentry.Breadcrumb{
        Category: "process.spawn",
        Message: "Starting database migration",
        Level: sentry.LevelInfo,
        Data: map[string]interface{}{"command": "go run migrate.go"},
    })
    
    cmd := exec.Command("go", "run", "migrate.go")
    err := cmd.Run()
    
    sentry.AddBreadcrumb(&sentry.Breadcrumb{
        Category: "process.exit",
        Message: fmt.Sprintf("Migration %s", map[bool]string{true: "succeeded", false: "failed"}[err == nil]),
        Level: map[bool]sentry.Level{true: sentry.LevelInfo, false: sentry.LevelError}[err == nil],
        Data: map[string]interface{}{"exit_code": cmd.ProcessState.ExitCode()},
    })
}
```

### File System Operations

```typescript
// TypeScript
async function processUpload(file) {
  Sentry.addBreadcrumb({
    category: "fs.upload",
    message: "Processing file upload",
    level: "info",
    data: { filename: file.name, size: file.size, type: file.type },
  });

  // ... process file

  Sentry.addBreadcrumb({
    category: "fs.upload",
    message: "File upload completed",
    level: "info",
    data: { storedPath: "/uploads/abc123.pdf" },
  });
}
```

### WebSocket / Real-time Events

```typescript
// TypeScript (works with ws, socket.io, etc.)
ws.on("message", (data) => {
  Sentry.addBreadcrumb({
    category: "ws.message",
    message: "WebSocket message received",
    level: "debug",
    data: { type: JSON.parse(data).type, size: data.length },
  });
});

ws.on("close", (code, reason) => {
  Sentry.addBreadcrumb({
    category: "ws.close",
    message: "WebSocket connection closed",
    level: "info",
    data: { code, reason: reason.toString() },
  });
});
```

## Middleware Pattern: Request Breadcrumbs

```typescript
// TypeScript (Express/Fastify/Hono/Elysia)
function breadcrumbMiddleware(handler) {
  return async (req, res, next) => {
    const startTime = performance.now();
    const requestId = crypto.randomUUID();

    Sentry.addBreadcrumb({
      category: "http.request",
      message: `${req.method} ${req.path}`,
      level: "info",
      data: {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers["user-agent"],
      },
    });

    try {
      const response = await handler(req, res, next);

      const duration = Math.round(performance.now() - startTime);
      Sentry.addBreadcrumb({
        category: "http.response",
        message: `${req.method} ${req.path} → ${res.statusCode}`,
        level: res.statusCode >= 400 ? "warning" : "info",
        data: { requestId, statusCode: res.statusCode, duration },
      });

      return response;
    } catch (error) {
      const duration = Math.round(performance.now() - startTime);
      Sentry.addBreadcrumb({
        category: "http.error",
        message: `${req.method} ${req.path} → 500`,
        level: "error",
        data: { requestId, error: error.message, duration },
      });
      throw error;
    }
  };
}
```

```python
# Python (Starlette/FastAPI middleware)
from starlette.middleware.base import BaseHTTPMiddleware
import time
import uuid

class BreadcrumbMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        request_id = str(uuid.uuid4())
        
        sentry_sdk.add_breadcrumb(
            category="http.request",
            message=f"{request.method} {request.url.path}",
            level="info",
            data={"request_id": request_id, "method": request.method, "url": str(request.url)},
        )
        
        try:
            response = await call_next(request)
            
            duration = round((time.time() - start_time) * 1000)
            sentry_sdk.add_breadcrumb(
                category="http.response",
                message=f"{request.method} {request.url.path} → {response.status_code}",
                level="warning" if response.status_code >= 400 else "info",
                data={"request_id": request_id, "status_code": response.status_code, "duration": duration},
            )
            
            return response
        except Exception as e:
            duration = round((time.time() - start_time) * 1000)
            sentry_sdk.add_breadcrumb(
                category="http.error",
                message=f"{request.method} {request.url.path} → 500",
                level="error",
                data={"request_id": request_id, "error": str(e), "duration": duration},
            )
            raise
```

## Database Breadcrumbs (Detailed)

### With Query Parameters (Sanitized)

```typescript
// TypeScript
function createDbBreadcrumb(
  query: string,
  params: any[],
  duration: number,
  rows: number,
) {
  const sanitizedQuery = query.replace(/\$(\d+)/g, (_, n) => {
    const val = params[parseInt(n) - 1];
    if (typeof val === "string" && val.length > 100) return "'<long>'";
    if (typeof val === "string" && /password|secret|token/i.test(query))
      return "'***'";
    return `'${val}'`;
  });

  Sentry.addBreadcrumb({
    category: "db.query",
    message: sanitizedQuery,
    level: duration > 1000 ? "warning" : "info",
    data: { duration: Math.round(duration), rowsAffected: rows },
  });
}
```

```python
# Python
import re

def create_db_breadcrumb(query, params, duration, rows):
    def sanitize(match):
        idx = int(match.group(1)) - 1
        val = params[idx] if idx < len(params) else ""
        if isinstance(val, str) and len(val) > 100:
            return "'<long>'"
        if isinstance(val, str) and re.search(r'password|secret|token', query, re.I):
            return "'***'"
        return f"'{val}'"
    
    sanitized = re.sub(r'\$(\d+)', sanitize, query)
    
    sentry_sdk.add_breadcrumb(
        category="db.query",
        message=sanitized,
        level="warning" if duration > 1000 else "info",
        data={"duration": round(duration), "rows_affected": rows},
    )
```

### ORM Integration

```typescript
// TypeScript - Drizzle
db.$on("query", (e) => {
  Sentry.addBreadcrumb({
    category: "db.query",
    message: e.query,
    level: e.duration > 1000 ? "warning" : "info",
    data: { duration: e.duration, rows: e.rows?.length },
  });
});

// TypeScript - Prisma
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;

  Sentry.addBreadcrumb({
    category: "db.query",
    message: `${params.model}.${params.action}`,
    level: duration > 1000 ? "warning" : "info",
    data: { duration, args: JSON.stringify(params.args).slice(0, 200) },
  });

  return result;
});
```

```python
# Python - SQLAlchemy
from sqlalchemy import event
from sentry_sdk import add_breadcrumb

@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    context._query_start_time = time.time()

@event.listens_for(Engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    duration = (time.time() - context._query_start_time) * 1000
    add_breadcrumb(
        category="db.query",
        message=statement[:200],
        level="warning" if duration > 1000 else "info",
        data={"duration": round(duration)},
    )
```

## Filtering & Sampling Breadcrumbs

### Limit Breadcrumbs per Event

```typescript
// TypeScript
Sentry.init({ maxBreadcrumbs: 100 }); // Default: 100, max: 500
```

```python
# Python
sentry_sdk.init(max_breadcrumbs=100)
```

```go
// Go
sentry.Init(sentry.ClientOptions{MaxBreadcrumbs: 100})
```

### Filter in beforeSend

```typescript
// TypeScript
Sentry.init({
  beforeSend(event) {
    if (event.breadcrumbs) {
      if (process.env.NODE_ENV === "production") {
        event.breadcrumbs = event.breadcrumbs.filter(
          (b) => b.level !== "debug",
        );
      }
      event.breadcrumbs = event.breadcrumbs.filter(
        (b) => !["auth.token", "payment.card"].includes(b.category),
      );
      event.breadcrumbs = event.breadcrumbs.slice(-50);
    }
    return event;
  },
});
```

```python
# Python
def before_send(event, hint):
    if event.get("breadcrumbs"):
        breadcrumbs = event["breadcrumbs"]
        if os.getenv("ENVIRONMENT") == "production":
            breadcrumbs = [b for b in breadcrumbs if b.get("level") != "debug"]
        breadcrumbs = [b for b in breadcrumbs if b.get("category") not in ["auth.token", "payment.card"]]
        event["breadcrumbs"] = breadcrumbs[-50:]
    return event

sentry_sdk.init(before_send=before_send)
```

## Viewing Breadcrumbs in Sentry

1. Open any issue
2. Click **"Breadcrumbs"** tab
3. Filter by: category, level, time range
4. Click any breadcrumb to see full data

### Search Breadcrumbs (Discover)

```
breadcrumbs.category:db.query
breadcrumbs.level:error
breadcrumbs.message:"payment"
```

## Best Practices

| Do                                  | Don't                         |
| ----------------------------------- | ----------------------------- |
| Use standard categories             | Invent random category names  |
| Include `requestId` for correlation | Log full request bodies (PII) |
| Set appropriate `level`             | Use `info` for everything     |
| Add `data` with context             | Put sensitive data in `data`  |
| Keep messages short (<100 chars)    | Write paragraph-long messages |

## Debugging with Breadcrumbs

### Common Patterns

```typescript
// 1. Trace a specific user action
Sentry.addBreadcrumb({
  category: "user.action",
  message: "Clicked 'Upgrade Plan'",
  level: "info",
  data: { planId: "pro", userId: "123" },
});

// 2. Track feature flag evaluation
Sentry.addBreadcrumb({
  category: "feature_flag",
  message: "Flag 'new-checkout' evaluated",
  level: "debug",
  data: { flag: "new-checkout", value: true, userId: "123" },
});

// 3. Cache behavior
Sentry.addBreadcrumb({
  category: "cache.miss",
  message: "Cache miss for user:123",
  level: "debug",
  data: { key: "user:123", fallback: "database" },
});

// 4. Rate limiting
Sentry.addBreadcrumb({
  category: "rate_limit",
  message: "Rate limit exceeded",
  level: "warning",
  data: { endpoint: "/api/orders", limit: 100, window: "1m" },
});
```

## Troubleshooting

| Issue                    | Solution                                                  |
| ------------------------ | --------------------------------------------------------- |
| No breadcrumbs           | Check `autoBreadcrumbs` config, verify SDK version        |
| Too many breadcrumbs     | Reduce `maxBreadcrumbs`, filter in `beforeSend`           |
| Missing DB breadcrumbs   | Ensure ORM middleware registered, check query hook        |
| Breadcrumbs not in issue | They only attach to captured events (errors/transactions) |
| PII in breadcrumbs       | Add `beforeSend` filter, use `data-sentry-ignore` pattern |

## Quick Reference

```typescript
// TypeScript
Sentry.addBreadcrumb({ category, message, level, data, timestamp });
Sentry.getCurrentScope().getScopeData().breadcrumbs;
Sentry.getCurrentScope().clearBreadcrumbs();

Sentry.init({
  maxBreadcrumbs: 100,
  autoBreadcrumbs: { http: true, console: true, db: true },
  beforeBreadcrumb(breadcrumb, hint) {
    return breadcrumb;
  },
});
```

```python
# Python
sentry_sdk.add_breadcrumb(category, message, level, data, timestamp)
sentry_sdk.get_current_scope().breadcrumbs
sentry_sdk.get_current_scope().clear_breadcrumbs()

sentry_sdk.init(max_breadcrumbs=100, auto_breadcrumbs={...}, before_breadcrumb=...)
```

```go
// Go
sentry.AddBreadcrumb(&sentry.Breadcrumb{Category, Message, Level, Data, Timestamp})
sentry.CurrentHub().Scope().GetBreadcrumbs()
sentry.CurrentHub().Scope().ClearBreadcrumbs()

sentry.Init(sentry.ClientOptions{MaxBreadcrumbs: 100, BeforeBreadcrumb: func(b *sentry.Breadcrumb, hint *sentry.BreadcrumbHint) *sentry.Breadcrumb { return b }})
```

## Next: [Alerting →](./06-alerting.md)
