# 4. Session Replay — Platform Agnostic

> **Important:** Session Replay is primarily a **frontend/mobile** feature. Backend SDKs provide **trace context linking** — the actual replay recording happens in the browser or mobile app.

## What Session Replay Captures (Frontend/Mobile)

| Captured | Not Captured |
|----------|--------------|
| DOM mutations (HTML/CSS) | Video/audio |
| Mouse clicks, scrolls, hovers | Password/credit card fields (masked by default) |
| Form inputs (masked by default) | `data-sentry-ignore` elements |
| Console logs & errors | WebGL/Canvas content (optional) |
| Network requests (XHR/fetch) | LocalStorage/IndexedDB (optional) |
| Viewport resize, orientation | |
| Touch gestures (mobile) | |

## Backend Role: Trace Context Propagation

Your backend provides the **bridge** between backend errors and frontend replays by propagating trace headers.

### 1. Propagate Trace Context to Frontend

All backend SDKs can extract the current trace context and pass it to the frontend.

```typescript
// TypeScript / Node.js / Bun / Deno
import * as Sentry from "@sentry/node";

app.get("/", (req, res) => {
  const transaction = Sentry.getCurrentScope().getTransaction();
  const traceHeaders = transaction?.toTraceparent();
  const traceState = transaction?.toTracestate();
  
  // Option A: Inject into HTML template
  if (req.headers.accept?.includes("text/html")) {
    const html = renderApp({ sentryTrace: traceHeaders, sentryTraceState: traceState });
    return res.send(html);
  }
  
  // Option B: Return in API response headers
  res.set({
    "sentry-trace": traceHeaders || "",
    "sentry-trace-state": traceState || "",
  });
  res.json(data);
});
```

```python
# Python (Flask/FastAPI/Django)
from sentry_sdk import Hub

@app.route("/")
def index():
    transaction = Hub.current.scope.transaction
    trace_headers = transaction.to_traceparent() if transaction else None
    trace_state = transaction.to_tracestate() if transaction else None
    
    # Option A: Inject into template
    if "text/html" in request.headers.get("accept", ""):
        return render_template("index.html", 
            sentry_trace=trace_headers, 
            sentry_trace_state=trace_state)
    
    # Option B: Return in headers
    response = jsonify(data)
    response.headers["sentry-trace"] = trace_headers or ""
    response.headers["sentry-trace-state"] = trace_state or ""
    return response
```

```go
// Go (Gin/Echo/Chi/stdlib)
import "github.com/getsentry/sentry-go"

func handler(c *gin.Context) {
    transaction := sentry.TransactionFromContext(c.Request.Context())
    traceHeaders := ""
    traceState := ""
    if transaction != nil {
        traceHeaders = transaction.ToTraceparent()
        traceState = transaction.ToTracestate()
    }
    
    // Option A: Inject into template
    if strings.Contains(c.GetHeader("Accept"), "text/html") {
        c.HTML(200, "index.html", gin.H{
            "sentryTrace": traceHeaders,
            "sentryTraceState": traceState,
        })
        return
    }
    
    // Option B: Return in headers
    c.Header("sentry-trace", traceHeaders)
    c.Header("sentry-trace-state", traceState)
    c.JSON(200, data)
}
```

```java
// Java (Spring Boot)
import io.sentry.Sentry;
import io.sentry.Span;

@Controller
public class HomeController {
    @GetMapping("/")
    public String index(Model model, HttpServletRequest request) {
        Span span = Sentry.getSpan();
        String traceHeaders = span != null ? span.toTraceparent() : null;
        String traceState = span != null ? span.toTracestate() : null;
        
        model.addAttribute("sentryTrace", traceHeaders);
        model.addAttribute("sentryTraceState", traceState);
        return "index";
    }
}
```

```csharp
// .NET (ASP.NET Core)
using Sentry;

[HttpGet("/")]
public IActionResult Index() {
    var transaction = SentrySdk.GetSpan();
    var traceHeaders = transaction?.ToTraceparent();
    var traceState = transaction?.ToTracestate();
    
    // Option A: Inject into view
    if (Request.Headers.Accept.Any(h => h.MediaType == "text/html")) {
        ViewData["SentryTrace"] = traceHeaders;
        ViewData["SentryTraceState"] = traceState;
        return View();
    }
    
    // Option B: Return in headers
    Response.Headers["sentry-trace"] = traceHeaders ?? "";
    Response.Headers["sentry-trace-state"] = traceState ?? "";
    return Json(data);
}
```

### 2. Frontend Receives & Initializes Replay

```tsx
// React / Vue / Svelte / Solid / Angular
import * as Sentry from "@sentry/react"; // or @sentry/vue, @sentry/svelte, etc.
import { Replay } from "@sentry/replay";

// Get trace headers from server-rendered HTML or API response
const sentryTrace = document.querySelector('meta[name="sentry-trace"]')?.content;
const sentryTraceState = document.querySelector('meta[name="sentry-trace-state"]')?.content;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Replay({
      // Capture 100% of error sessions, 10% of all sessions
      replaysOnErrorSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      
      // Link to backend trace
      tracePropagationTargets: ["api.example.com"],
    }),
  ],
  
  // Continue trace from backend
  initialScope: {
    propagationContext: sentryTrace ? {
      traceId: sentryTrace.split("-")[1],
      parentSpanId: sentryTrace.split("-")[2],
    } : undefined,
  },
});
```

```html
<!-- HTML Template (any template engine) -->
<!DOCTYPE html>
<html>
<head>
  <!-- Sentry trace context from backend -->
  <meta name="sentry-trace" content="{{sentryTrace}}">
  <meta name="sentry-trace-state" content="{{sentryTraceState}}">
  
  <!-- Sentry SDK loads and reads these automatically -->
  <script src="https://browser.sentry-cdn.com/.../bundle.min.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

### 3. Mobile Apps (React Native, iOS, Android)

```typescript
// React Native
import * as Sentry from "@sentry/react-native";
import { Replay } from "@sentry/replay";

Sentry.init({
  dsn: "https://...",
  integrations: [
    Replay({
      replaysOnErrorSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
    }),
  ],
});

// Trace context automatically propagated via native modules
```

```swift
// iOS (Swift)
import Sentry

SentrySDK.start { options in
    options.dsn = "https://..."
    options.enableReplay = true
    options.replaySessionSampleRate = 0.1
    options.replayOnErrorSampleRate = 1.0
}

// Trace context automatically propagated via URLSession
```

```kotlin
// Android (Kotlin)
import io.sentry.Sentry
import io.sentry.android.core.SentryAndroid

Sentry.init { options ->
    options.dsn = "https://..."
    options.enableReplay = true
    options.replaySessionSampleRate = 0.1
    options.replayOnErrorSampleRate = 1.0
}

// Trace context automatically propagated via OkHttp
```

## Backend Error → Frontend Replay Link

When an error occurs in your backend API, the frontend replay shows the **exact user actions** leading to the API call.

```
┌────────────────────────────────────────────────────────────┐
│  Sentry Issue: TypeError: Cannot read 'id' of null        │
├────────────────────────────────────────────────────────────┤
│  🔗 Backend Trace: GET /api/users/123/orders (span 45ms)  │
│  🎬 Frontend Replay: [Watch 30s before error]             │
│       ├─ 0:00 User clicks "My Orders"                     │
│       ├─ 0:05 Loading spinner appears                     │
│       ├─ 0:12 API call: GET /api/users/123/orders         │
│       ├─ 0:15 Error toast: "Failed to load orders"        │
│       └─ 0:18 User clicks "Retry"                         │
└────────────────────────────────────────────────────────────┘
```

## Frontend Configuration Options

```typescript
// All frontend frameworks
import * as Sentry from "@sentry/react";
import { Replay } from "@sentry/replay";

Sentry.init({
  dsn: "https://...",
  integrations: [
    Replay({
      // Sampling
      replaysOnErrorSampleRate: 1.0,    // 100% sessions with errors
      replaysSessionSampleRate: 0.1,    // 10% of all sessions
      
      // Performance
      maxReplayDuration: 60000,         // Max 60 seconds
      bufferSize: 1024 * 1024,          // 1MB buffer
      
      // Privacy
      maskAllText: false,               // Mask text content
      blockAllMedia: false,             // Block images/video
      mask: {
        // Custom masking rules (CSS selectors)
        ".credit-card": true,
        "[data-sensitive]": true,
      },
      
      // Network
      networkRequestBodies: true,       // Capture request bodies
      networkResponseBodies: true,      // Capture response bodies
      networkDetailAllowUrls: [
        "https://api.example.com/**",
      ],
      
      // Callbacks
      beforeAddRecordingEvent(event) {
        // Filter/modify events before sending
        return event;
      },
    }),
  ],
});
```

## Privacy & Compliance

### Default Masking

```typescript
// Automatic masking (enabled by default)
Replay({
  maskAllText: true,        // All text → ••••
  blockAllMedia: true,      // Images/video → blocked
});

// Selective masking
Replay({
  mask: {
    "input[type=password]": true,
    "input[type=credit-card]": true,
    ".ssn": true,
    "[data-pii]": true,
  },
  block: {
    ".user-avatar": true,
    ".document-preview": true,
  },
});
```

### Custom Privacy Rules

```tsx
// In your components (React example)
<div data-sentry-ignore>
  {/* This entire subtree won't be recorded */}
  <SensitiveComponent />
</div>

<input data-sentry-mask />  {/* Value masked but structure recorded */}
```

```html
<!-- Vue/Svelte/Angular/Plain HTML -->
<div data-sentry-ignore>
  <!-- This entire subtree won't be recorded -->
  <sensitive-component></sensitive-component>
</div>

<input data-sentry-mask>  <!-- Value masked but structure recorded -->
```

## Cost Control

| Setting | Default | Recommended |
|---------|---------|-------------|
| `replaysSessionSampleRate` | 0 | 0.01–0.1 (1–10%) |
| `replaysOnErrorSampleRate` | 1.0 | 1.0 (keep) |
| `maxReplayDuration` | 60000ms | 30000–60000ms |
| `bufferSize` | 1MB | 512KB–2MB |

**Estimated cost:** ~50KB/session → 10K sessions = ~500MB/month

## Backend-Specific: API Error Context

Even without frontend replay, enrich API errors for debugging:

```typescript
// TypeScript middleware
import * as Sentry from "@sentry/node";

export function addRequestContext(req, res, next) {
  const scope = Sentry.getCurrentScope();
  
  scope.setContext("request", {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: req.query,
  });
  
  if (req.user) {
    scope.setUser({ id: req.user.id, email: req.user.email });
  }
  
  scope.setTags({
    route: req.path,
    user_agent: req.headers["user-agent"] || "unknown",
  });
  
  next();
}
```

```python
# Python middleware
from sentry_sdk import Hub

class SentryContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        scope = Hub.current.scope
        
        scope.set_context("request", {
            "method": request.method,
            "url": request.url,
            "headers": dict(request.headers),
            "query": dict(request.GET),
        })
        
        if hasattr(request, "user") and request.user.is_authenticated:
            scope.set_user({"id": request.user.id, "email": request.user.email})
        
        scope.set_tags({
            "route": request.path,
            "user_agent": request.headers.get("user-agent", "unknown"),
        })
        
        return self.get_response(request)
```

```go
// Go middleware
func SentryContextMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        hub := sentry.GetHubFromContext(r.Context())
        if hub == nil {
            hub = sentry.CurrentHub()
        }
        
        hub.Scope().SetContext("request", map[string]interface{}{
            "method": r.Method,
            "url": r.URL.String(),
            "headers": r.Header,
            "query": r.URL.Query(),
        })
        
        // Add user if available in context
        if user := getUserFromContext(r.Context()); user != nil {
            hub.Scope().SetUser(sentry.User{ID: user.ID, Email: user.Email})
        }
        
        hub.Scope().SetTags(map[string]string{
            "route": r.URL.Path,
            "user_agent": r.UserAgent(),
        })
        
        next.ServeHTTP(w, r)
    })
}
```

## Testing Replay Integration

### 1. Verify Trace Propagation

```bash
# Check response headers include trace context
curl -i http://localhost:3000/api/test

# Should see:
# sentry-trace: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
# sentry-trace-state: sentry-release=v2.3.1,sentry-environment=development
```

### 2. Frontend Console Check

```javascript
// In browser console
Sentry.getCurrentScope().getPropagationContext()
// Should show traceId, spanId from backend
```

### 3. Trigger Test Error

```tsx
// Frontend button
<button onClick={() => {
  fetch("/api/trigger-error").then(r => r.json())
}}>Trigger Backend Error</button>

// Backend route (any platform)
app.get("/api/trigger-error", () => {
  throw new Error("Test error for replay linking");
});
```

Check Sentry: Issue should show **both** backend trace + frontend replay.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No replay in issue | Check `replaysOnErrorSampleRate: 1.0`, verify frontend SDK version |
| Trace not linking | Ensure `sentry-trace` header passed from backend to frontend |
| Replay not loading | Check CORS, network tab for `replay` endpoint errors |
| High bandwidth | Lower `replaysSessionSampleRate`, reduce `maxReplayDuration` |
| PII in replay | Add `mask` rules, use `data-sentry-ignore` |

## Architecture Summary

```
┌─────────────┐     HTTP + trace headers      ┌─────────────┐
│  Backend    │ ─────────────────────────────▶ │  Frontend   │
│  (Any)      │                                 │  (Browser/  │
│             │ ◀───────────────────────────── │   Mobile)   │
│ - Errors    │     User actions + API calls   │             │
│ - Traces    │                                 │ - Replay    │
└─────────────┘                                 │ - Errors    │
       │                                        └─────────────┘
       └──────────────┬────────────────────────────────┘
                      ▼
              ┌───────────────┐
              │   Sentry UI   │
              │               │
              │ Backend trace │
              │ + Frontend    │
              │   replay      │
              └───────────────┘
```

## Next: [Breadcrumbs →](./05-breadcrumbs.md)