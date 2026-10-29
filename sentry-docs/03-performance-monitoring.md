# 3. Performance Monitoring (APM) — Platform Agnostic

Distributed tracing, transaction monitoring, and continuous profiling for any application.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRANSACTION: GET /api/orders                 │
│  Duration: 1.2s  •  Spans: 8  •  Status: 200 OK                │
├─────────────────────────────────────────────────────────────────┤
│ ████████████████████████████████████████ 1200ms                │
│ ├─ ████████████████ 450ms  SELECT * FROM orders WHERE user=?  │
│ ├─ ████████████ 300ms  HTTP GET /payments/verify              │
│ ├─ ████ 50ms  Redis GET cache:user:123                        │
│ ├─ ████████ 120ms  Custom: calculate_discounts               │
│ └─ ██ 20ms  Logger.info                                        │
└─────────────────────────────────────────────────────────────────┘
```

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

# Java
# Add to pom.xml or build.gradle:
# implementation 'io.sentry:sentry-spring-boot:7.0.0'

# .NET
dotnet add package Sentry

# Ruby
gem install sentry-ruby

# PHP
composer require sentry/sentry
```

## Basic Setup

### TypeScript / Node.js / Bun / Deno

```typescript
import * as Sentry from "@sentry/node"; // or @sentry/bun, @sentry/deno

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Transaction sampling (0.0 - 1.0)
  tracesSampleRate: 1.0,

  // Profiling sampling
  profilesSampleRate: 0.1,
});
```

### Python

```python
import sentry_sdk

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    traces_sample_rate=1.0,
    profiles_sample_rate=0.1,
)
```

### Go

```go
import "github.com/getsentry/sentry-go"

sentry.Init(sentry.ClientOptions{
    Dsn: os.Getenv("SENTRY_DSN"),
    TracesSampleRate: 1.0,
    ProfilesSampleRate: 0.1,
})
```

### Java

```java
import io.sentry.Sentry;

Sentry.init(options -> {
    options.setDsn(System.getenv("SENTRY_DSN"));
    options.setTracesSampleRate(1.0);
    options.setProfilesSampleRate(0.1);
});
```

### .NET

```csharp
using Sentry;

SentrySdk.Init(o => {
    o.Dsn = Environment.GetEnvironmentVariable("SENTRY_DSN");
    o.TracesSampleRate = 1.0;
    o.ProfilesSampleRate = 0.1;
});
```

## Automatic Instrumentation

Most SDKs automatically instrument common libraries:

| Platform | HTTP Server                         | HTTP Client              | Database                               | Redis               | Messaging                |
| -------- | ----------------------------------- | ------------------------ | -------------------------------------- | ------------------- | ------------------------ |
| Node.js  | Express, Koa, Fastify, Hono, Elysia | fetch, axios, http       | pg, mysql2, prisma, drizzle, sequelize | ioredis, redis      | amqplib, kafkajs         |
| Python   | Flask, Django, FastAPI, Starlette   | requests, httpx, aiohttp | psycopg2, sqlalchemy, django.db        | redis-py            | celery, pika             |
| Go       | Gin, Echo, Chi, stdlib              | net/http, http.Client    | database/sql, gorm, sqlx               | go-redis            | sarama, nats.go          |
| Java     | Spring Boot, Servlet, Vert.x        | HttpClient, OkHttp       | JDBC, JPA, R2DBC                       | Lettuce, Jedis      | Kafka, RabbitMQ          |
| .NET     | ASP.NET Core                        | HttpClient               | Entity Framework, Dapper               | StackExchange.Redis | MassTransit, NServiceBus |
| Ruby     | Rails, Rack, Sinatra                | Net::HTTP, Faraday       | ActiveRecord, Sequel                   | redis-rb            | Sidekiq, Bunny           |
| PHP      | Laravel, Symfony, Slim              | Guzzle, HttpClient       | PDO, Doctrine                          | predis, phpredis    | enqueue, php-amqplib     |

## Custom Transactions & Spans

### Manual Transaction (Background Jobs)

```typescript
// TypeScript
import * as Sentry from "@sentry/node";

async function processOrderQueue() {
  const transaction = Sentry.startTransaction({
    name: "Process Order Queue",
    op: "task.queue",
  });

  try {
    const orders = await fetchPendingOrders();

    for (const order of orders) {
      const span = transaction.startChild({
        op: "task.process",
        description: `Order ${order.id}`,
      });

      await processOrder(order);
      span.end();
    }

    transaction.setTag("orders_processed", orders.length);
    transaction.setStatus("ok");
  } catch (error) {
    transaction.setStatus("internal_error");
    throw error;
  } finally {
    transaction.end();
  }
}
```

```python
# Python
import sentry_sdk

def process_order_queue():
    transaction = sentry_sdk.start_transaction(
        name="Process Order Queue",
        op="task.queue",
    )
    
    try:
        orders = fetch_pending_orders()
        
        for order in orders:
            span = transaction.start_child(
                op="task.process",
                description=f"Order {order.id}",
            )
            
            process_order(order)
            span.finish()
        
        transaction.set_tag("orders_processed", len(orders))
        transaction.set_status("ok")
    except Exception as e:
        transaction.set_status("internal_error")
        raise
    finally:
        transaction.finish()
```

```go
// Go
import "github.com/getsentry/sentry-go"

func processOrderQueue() {
    transaction := sentry.StartTransaction(
        sentry.TransactionContext{
            Name: "Process Order Queue",
            Op: "task.queue",
        },
    )
    
    defer transaction.Finish()
    
    orders := fetchPendingOrders()
    
    for _, order := range orders {
        span := transaction.StartChild("task.process", sentry.SpanDescription(fmt.Sprintf("Order %s", order.ID)))
        processOrder(order)
        span.Finish()
    }
    
    transaction.SetTag("orders_processed", len(orders))
    transaction.Status = sentry.SpanStatusOK
}
```

### Custom Spans (Database, External API, Business Logic)

```typescript
// TypeScript
async function getUserWithOrders(userId: string) {
  // Database span
  const dbSpan = Sentry.startSpan({
    op: "db.query",
    name: "SELECT user + orders",
    attributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "db.table": "users",
    },
  });

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { orders: true },
  });

  dbSpan.end();

  // External API span
  const apiSpan = Sentry.startSpan({
    op: "http.client",
    name: "GET /api/loyalty",
    attributes: {
      "http.method": "GET",
      url: "https://loyalty.example.com/api/points",
    },
  });

  const loyalty = await fetch(
    `https://loyalty.example.com/api/points/${userId}`,
  );
  apiSpan.setAttribute("http.status_code", loyalty.status);
  apiSpan.end();

  return { user, loyalty: await loyalty.json() };
}
```

```python
# Python
import sentry_sdk

def get_user_with_orders(user_id):
    # Database span
    with sentry_sdk.start_span(op="db.query", description="SELECT user + orders") as db_span:
        db_span.set_data("db.system", "postgresql")
        db_span.set_data("db.operation", "SELECT")
        db_span.set_data("db.table", "users")
        
        user = db.query.users.find_first(where=eq(users.id, user_id), with_={"orders": True})
    
    # External API span
    with sentry_sdk.start_span(op="http.client", description="GET /api/loyalty") as api_span:
        api_span.set_data("http.method", "GET")
        api_span.set_data("url", "https://loyalty.example.com/api/points")
        
        loyalty = requests.get(f"https://loyalty.example.com/api/points/{user_id}")
        api_span.set_data("http.status_code", loyalty.status_code)
    
    return {"user": user, "loyalty": loyalty.json()}
```

### Span Attributes (OpenTelemetry Semantic Conventions)

Use standard attributes for better querying:

```typescript
// Database
span.setAttributes({
  "db.system": "postgresql",
  "db.operation": "SELECT",
  "db.table": "orders",
  "db.statement": "SELECT * FROM orders WHERE user_id = $1",
  "db.rows_returned": 42,
});

// HTTP Client
span.setAttributes({
  "http.method": "POST",
  url: "https://api.stripe.com/v1/charges",
  "http.status_code": 200,
  "http.request.body.size": 1024,
  "http.response.body.size": 2048,
});

// Messaging
span.setAttributes({
  "messaging.system": "rabbitmq",
  "messaging.destination": "orders.created",
  "messaging.operation": "publish",
});

// Custom business logic
span.setAttributes({
  "app.user.tier": "premium",
  "app.order.value": 99.99,
  "app.feature": "checkout",
});
```

**Reference:** [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Sampling Strategies

### Fixed Rate

```typescript
// TypeScript
Sentry.init({ tracesSampleRate: 0.2 });
```

```python
# Python
sentry_sdk.init(traces_sample_rate=0.2)
```

```go
// Go
sentry.Init(sentry.ClientOptions{TracesSampleRate: 0.2})
```

### Dynamic Sampling (Function)

```typescript
// TypeScript
Sentry.init({
  tracesSampler(ctx) {
    if (ctx.transactionContext?.op === "http.server") {
      const url = ctx.transactionContext.name;

      // High priority: always sample
      if (url.includes("/payment") || url.includes("/checkout")) return 1.0;

      // Health checks: never sample
      if (url.includes("/health") || url.includes("/ready")) return 0.0;

      // API: 10%
      if (url.startsWith("/api/")) return 0.1;

      // Static assets: 1%
      return 0.01;
    }
    return 0.1;
  },
});
```

```python
# Python
def traces_sampler(ctx):
    if ctx.get("transaction_context", {}).get("op") == "http.server":
        url = ctx["transaction_context"].get("name", "")
        
        if "/payment" in url or "/checkout" in url:
            return 1.0
        if "/health" in url or "/ready" in url:
            return 0.0
        if url.startswith("/api/"):
            return 0.1
        return 0.01
    return 0.1

sentry_sdk.init(traces_sampler=traces_sampler)
```

### Head-Based vs Tail-Based

| Strategy                       | When Decision Made     | Pros                        | Cons                                 |
| ------------------------------ | ---------------------- | --------------------------- | ------------------------------------ |
| **Head-based** (tracesSampler) | At transaction start   | Low overhead                | Can't sample based on outcome        |
| **Tail-based**                 | After transaction ends | Sample errors/slow requests | Higher overhead, limited SDK support |

## Performance Metrics & Dashboards

### Key Metrics to Monitor

| Metric          | Description             | Target  |
| --------------- | ----------------------- | ------- |
| **p50 latency** | Median response time    | < 200ms |
| **p95 latency** | 95th percentile         | < 1s    |
| **p99 latency** | 99th percentile         | < 3s    |
| **Throughput**  | Requests/second         | —       |
| **Error rate**  | Errors / total requests | < 0.1%  |
| **Apdex**       | User satisfaction score | > 0.9   |

### Discover Queries (SQL-like)

```sql
-- Slowest endpoints
SELECT transaction, percentile(duration, 95) as p95
FROM transactions
WHERE timestamp > now() - 1h
GROUP BY transaction
ORDER BY p95 DESC
LIMIT 20

-- Error rate by endpoint
SELECT transaction, count() as total, 
       countif(status >= 500) as errors,
       errors / total as error_rate
FROM transactions
WHERE timestamp > now() - 1h
GROUP BY transaction
HAVING total > 100
ORDER BY error_rate DESC

-- Database query performance
SELECT span.description as query, 
       avg(span.duration) as avg_ms,
       max(span.duration) as max_ms
FROM spans
WHERE span.op = 'db.query'
  AND timestamp > now() - 1h
GROUP BY query
ORDER BY avg_ms DESC
```

## Continuous Profiling

### TypeScript / Node.js / Bun

```bash
# Node.js: --enable-source-map for better stacks
node --enable-source-map server.js

# Bun: --enable-profiling
bun --enable-profiling run server.ts
```

```typescript
Sentry.init({
  profilesSampleRate: 0.1,
});
```

### Python

```bash
# Python profiling requires py-spy or similar
pip install py-spy
```

```python
sentry_sdk.init(
    profiles_sample_rate=0.1,
    # Enable profiling integration
    _experiments={"profiling": True},
)
```

### Go

```go
// Go profiling via pprof
import _ "net/http/pprof"

sentry.Init(sentry.ClientOptions{
    ProfilesSampleRate: 0.1,
})
```

### Java

```java
// Java profiling via JFR
Sentry.init(options -> {
    options.setProfilesSampleRate(0.1);
    options.setEnableJfrProfiling(true);
});
```

### .NET

```csharp
// .NET profiling via EventPipe
SentrySdk.Init(o => {
    o.ProfilesSampleRate = 0.1;
});
```

## Distributed Tracing

### Propagating Trace Context

```typescript
// TypeScript - Automatic for supported HTTP clients
// Manual propagation if needed:
const transaction = Sentry.getCurrentScope().getTransaction();
const traceparent = transaction?.toTraceparent();

const response = await fetch("https://api.example.com/data", {
  headers: { traceparent: traceparent },
});
```

```python
# Python
from sentry_sdk import Hub

transaction = Hub.current.scope.transaction
traceparent = transaction.to_traceparent() if transaction else None

response = requests.get("https://api.example.com/data", headers={"traceparent": traceparent})
```

```go
// Go
transaction := sentry.TransactionFromContext(ctx)
traceparent := ""
if transaction != nil {
    traceparent = transaction.ToTraceparent()
}

req, _ := http.NewRequest("GET", "https://api.example.com/data", nil)
req.Header.Set("traceparent", traceparent)
```

### Receiving from Frontend

All SDKs automatically extract `traceparent` and `tracestate` headers from incoming requests when using supported frameworks.

## Database Integration Examples

### TypeScript (Drizzle/Prisma)

```typescript
// Drizzle
import { drizzle } from "drizzle-orm/node-postgres";
import * as Sentry from "@sentry/node";

const db = drizzle(sql);

async function getOrders(userId: string) {
  return Sentry.startSpan({ op: "db.query", name: "getOrders" }, async () =>
    db.select().from(orders).where(eq(orders.userId, userId)),
  );
}

// Prisma
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

prisma.$use(async (params, next) => {
  return Sentry.startSpan(
    { op: "db.query", name: `prisma.${params.model}.${params.action}` },
    async () => next(params),
  );
});
```

### Python (SQLAlchemy/Django)

```python
# SQLAlchemy
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

sentry_sdk.init(integrations=[SqlalchemyIntegration()])

# Django
from sentry_sdk.integrations.django import DjangoIntegration

sentry_sdk.init(integrations=[DjangoIntegration()])
```

### Go (GORM/sqlx)

```go
// GORM
import "gorm.io/plugin/opentelemetry/tracing"

db.Use(tracing.NewPlugin())

// Or manual spans
func query(db *gorm.DB, span *sentry.Span) {
    span.SetData("db.system", "postgresql")
    // ... query
}
```

## Performance Budgets & Alerts

### Budget Configuration (Sentry UI)

1. **Settings → Performance → Budgets**
2. Create budget:
   - Transaction: `GET /api/orders`
   - Threshold: p95 > 500ms
   - Alert: Slack #backend-alerts

### Custom Metric Alerts

```typescript
// TypeScript
Sentry.metrics.increment("orders.created", 1, { tags: { tier: "premium" } });
Sentry.metrics.distribution("order.value", 99.99, {
  tags: { currency: "USD" },
});
Sentry.metrics.timing("checkout.duration", 1250, {
  tags: { payment_method: "stripe" },
});
```

```python
# Python
sentry_sdk.metrics.increment("orders.created", 1, tags={"tier": "premium"})
sentry_sdk.metrics.distribution("order.value", 99.99, tags={"currency": "USD"})
sentry_sdk.metrics.timing("checkout.duration", 1250, tags={"payment_method": "stripe"})
```

```go
// Go
sentry.Metrics.Increment("orders.created", 1, map[string]string{"tier": "premium"})
sentry.Metrics.Distribution("order.value", 99.99, map[string]string{"currency": "USD"})
sentry.Metrics.Timing("checkout.duration", 1250, map[string]string{"payment_method": "stripe"})
```

## Troubleshooting

| Issue                | Solution                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| No transactions      | Check `tracesSampleRate > 0`, verify DSN                                        |
| Missing spans        | Ensure DB/HTTP libraries are supported/instrumented                             |
| High overhead        | Lower `tracesSampleRate`, disable profiling                                     |
| No profiling data    | Enable profiling in runtime (Node: `--enable-source-map`, Go: pprof, Java: JFR) |
| Trace not continuing | Check `traceparent` header propagation                                          |
| Spans too granular   | Filter spans in `beforeSendTransaction`                                         |

## Quick Reference

```typescript
// TypeScript
const transaction = Sentry.startTransaction({ name, op });
const span = transaction.startChild({ op, description });
const span = Sentry.getCurrentScope().getSpan();
span.setStatus("ok" | "error" | "cancelled");
span.setAttribute(key, value);
span.addEvent("cache.miss", { key: "user:123" });
span.end();
transaction.end();

Sentry.metrics.increment(name, value, tags);
Sentry.metrics.distribution(name, value, tags);
Sentry.metrics.timing(name, ms, tags);
```

```python
# Python
transaction = sentry_sdk.start_transaction(name, op)
span = transaction.start_child(op, description)
span = sentry_sdk.get_current_span()
span.set_status("ok" | "error" | "cancelled")
span.set_data(key, value)
span.finish()
transaction.finish()

sentry_sdk.metrics.increment(name, value, tags)
sentry_sdk.metrics.distribution(name, value, tags)
sentry_sdk.metrics.timing(name, ms, tags)
```

```go
// Go
transaction := sentry.StartTransaction(sentry.TransactionContext{Name: name, Op: op})
span := transaction.StartChild(op, sentry.SpanDescription(description))
span := sentry.SpanFromContext(ctx)
span.Status = sentry.SpanStatusOK
span.SetData(key, value)
span.Finish()
transaction.Finish()

sentry.Metrics.Increment(name, value, tags)
sentry.Metrics.Distribution(name, value, tags)
sentry.Metrics.Timing(name, ms, tags)
```

## Next: [Session Replay →](./04-session-replay.md)
