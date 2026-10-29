# Sentry Integration Guide — Platform Agnostic

Complete documentation for integrating Sentry's top 6 features into any application (Node.js, Python, Go, Java, .NET, Ruby, PHP, Bun, Deno, Browser, Mobile, etc.).

## Quick Start

```bash
# 1. Install the Sentry SDK for your platform
# Node.js/Bun/Deno:     npm install @sentry/node
# Python:               pip install sentry-sdk
# Go:                   go get github.com/getsentry/sentry-go
# Java:                 implementation 'io.sentry:sentry'
# .NET:                 dotnet add package Sentry
# Ruby:                 gem install sentry-ruby
# PHP:                  composer require sentry/sentry
# Browser:              npm install @sentry/browser

# 2. Initialize Sentry early in your application startup
# (See platform-specific examples in each feature doc)

# 3. Set your DSN
export SENTRY_DSN="https://xxx@o1.ingest.sentry.io/123"
```

## Documentation Index

| #   | Feature                    | Document                                                       | Covers                                                     |
| --- | -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | **Error Tracking**         | [01-error-tracking.md](./01-error-tracking.md)                 | Exception capture, context, grouping, manual capture       |
| 2   | **Release Tracking**       | [02-release-tracking.md](./02-release-tracking.md)             | Release creation, deploy tracking, suspect commits         |
| 3   | **Performance Monitoring** | [03-performance-monitoring.md](./03-performance-monitoring.md) | Transactions, spans, tracing, profiling                    |
| 4   | **Session Replay**         | [04-session-replay.md](./04-session-replay.md)                 | Frontend replay, backend trace linking                     |
| 5   | **Breadcrumbs**            | [05-breadcrumbs.md](./05-breadcrumbs.md)                       | Auto-captured breadcrumbs, custom breadcrumbs              |
| 6   | **Alerting**               | [06-alerting.md](./06-alerting.md)                             | Alert rules, metric alerts, Slack/PagerDuty, ownership     |
| 7   | **Protocol Spec**          | [07-protocol-spec.md](./07-protocol-spec.md)                   | Ingestion protocol with source references                  |
| 8   | **Authentication**         | [08-authentication.md](./08-authentication.md)                 | None, OIDC, OAuth2 — auth methods for Sentry server & SDKs |
| 9   | **Feature Flags**          | [09-feature-flags.md](./09-feature-flags.md)                   | Release-scoped flags, rollouts, targeting, experimentation |

## Project Structure

```
sentry-docs/
├── README.md                    # This file
├── 01-error-tracking.md         # Error tracking deep dive
├── 02-release-tracking.md       # Release tracking deep dive
├── 03-performance-monitoring.md # APM deep dive
├── 04-session-replay.md         # Session replay deep dive
├── 05-breadcrumbs.md            # Breadcrumbs deep dive
├── 06-alerting.md               # Alerting deep dive
├── 07-protocol-spec.md          # Protocol specification with sources
├── 08-authentication.md         # Authentication (None, OIDC, OAuth2)
├── 09-feature-flags.md          # Feature flags per release
├── sentry.config.example.ts     # Shared config pattern (TypeScript)
├── server.example.ts            # Example server (TypeScript/Node)
├── server.example.py            # Example server (Python)
└── scripts/
    └── sentry-release.sh        # Release automation script
```

## Core Configuration Pattern

All platforms follow the same initialization pattern:

```typescript
// sentry.config.example.ts — TypeScript/Node/Bun/Deno
import * as Sentry from "@sentry/node"; // or @sentry/bun, @sentry/deno

export function initSentry(options: {
  dsn: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
}) {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment || process.env.NODE_ENV || "development",
    release: options.release || process.env.APP_VERSION || "1.0.0",

    // Performance Monitoring
    tracesSampleRate: options.tracesSampleRate ?? 1.0,
    profilesSampleRate: options.profilesSampleRate ?? 0.1,

    // Debug in development
    debug: process.env.NODE_ENV === "development",

    // Before send - filter/modify events
    beforeSend(event, hint) {
      // Filter out health check noise
      if (event.request?.url?.includes("/health")) return null;
      return event;
    },
  });

  return Sentry;
}
```

```python
# sentry_config.py — Python
import sentry_sdk
import os

def init_sentry(dsn: str, **kwargs):
    sentry_sdk.init(
        dsn=dsn,
        environment=kwargs.get("environment", os.getenv("ENVIRONMENT", "development")),
        release=kwargs.get("release", os.getenv("APP_VERSION", "1.0.0")),
        traces_sample_rate=kwargs.get("traces_sample_rate", 1.0),
        profiles_sample_rate=kwargs.get("profiles_sample_rate", 0.1),
        debug=os.getenv("ENVIRONMENT") == "development",
        before_send=lambda event, hint: None if event.get("request", {}).get("url", "").includes("/health") else event,
    )
```

```go
// sentry_config.go — Go
package main

import (
    "os"
    "github.com/getsentry/sentry-go"
)

func InitSentry(dsn string, options ...sentry.ClientOption) {
    opts := []sentry.ClientOption{
        sentry.Dsn(dsn),
        sentry.Environment(getEnv("ENVIRONMENT", "development")),
        sentry.Release(getEnv("APP_VERSION", "1.0.0")),
        sentry.TracesSampleRate(1.0),
        sentry.ProfilesSampleRate(0.1),
        sentry.Debug(os.Getenv("ENVIRONMENT") == "development"),
        sentry.BeforeSend(func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
            if event.Request != nil && contains(event.Request.URL, "/health") {
                return nil
            }
            return event
        }),
    }
    opts = append(opts, options...)
    sentry.Init(opts)
}
```

## Environment Variables (Universal)

```bash
# Required
SENTRY_DSN=https://xxx@o1.ingest.sentry.io/123

# Optional
SENTRY_ENVIRONMENT=production          # or development, staging
SENTRY_RELEASE=v2.3.1                  # or git sha, build number
SENTRY_TRACES_SAMPLE_RATE=0.2          # 0.0 - 1.0
SENTRY_PROFILES_SAMPLE_RATE=0.1        # 0.0 - 1.0
SENTRY_DEBUG=false                     # true/false
```

## Feature Matrix (Platform Support)

| Feature               | Node/Bun/Deno | Python     | Go         | Java       | .NET       | Ruby       | PHP        | Browser | Mobile |
| --------------------- | ------------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ------- | ------ |
| Error Tracking        | ✅            | ✅         | ✅         | ✅         | ✅         | ✅         | ✅         | ✅      | ✅     |
| Release Tracking      | ✅            | ✅         | ✅         | ✅         | ✅         | ✅         | ✅         | ✅      | ✅     |
| Performance (Tracing) | ✅            | ✅         | ✅         | ✅         | ✅         | ✅         | ✅         | ✅      | ✅     |
| Profiling             | ✅            | ✅         | ✅         | ✅         | ✅         | ⚠️         | ⚠️         | ✅      | ✅     |
| Session Replay        | ⚠️ Backend    | ⚠️ Backend | ⚠️ Backend | ⚠️ Backend | ⚠️ Backend | ⚠️ Backend | ⚠️ Backend | ✅      | ✅     |
| Breadcrumbs           | ✅            | ✅         | ✅         | ✅         | ✅         | ✅         | ✅         | ✅      | ✅     |
| Alerting              | ✅            | ✅         | ✅         | ✅         | ✅         | ✅         | ✅         | ✅      | ✅     |

_Session Replay is primarily a frontend/mobile feature. Backend SDKs provide trace context linking._

## Next Steps

1. Read each feature doc in order (01→06)
2. Choose your platform's SDK and follow the examples
3. Configure shared settings via environment variables
4. Set up CI/CD for release tracking (see 02-release-tracking.md)
5. Configure alerts in Sentry UI (see 06-alerting.md)

## Resources

- [Sentry Platforms](https://docs.sentry.io/platforms/) — All supported platforms
- [sentry-cli](https://docs.sentry.io/product/cli/) — Release automation
- [Performance docs](https://docs.sentry.io/product/performance/)
- [Alerting docs](https://docs.sentry.io/product/alerts/)
- [Protocol Spec](./07-protocol-spec.md) — Ingestion API with sources
