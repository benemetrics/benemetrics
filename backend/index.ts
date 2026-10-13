import { Elysia } from "elysia";
import ui from "../frontend/index.html";
import type { EnvelopeHeader } from "./models/envelope-header";
import type { ItemHeader } from "./models/item-header";
import type { StoredEvent } from "./models/stored-event";
import type { 
  DsnRecord, DsnCreateRequest, DsnCreateResponse, DsnResponse,
  FeatureFlag, FeatureFlagCreateRequest, FeatureFlagUpdateRequest, FeatureFlagListResponse,
  FeatureFlagVariant, TargetingRule, Segment, EvaluationRequest, EvaluationResponse
} from "./models/dsn";
import type {
  Project, AppRecord,
  ProjectCreateRequest, AppCreateRequest,
  AppResponse, ProjectResponse, ProjectDetailResponse,
  ProjectListResponse, AppListResponse
} from "./models/project";

// Types (re-exported for use in handlers)
export type { EnvelopeHeader, ItemHeader, StoredEvent };

// In-memory storage (in production, use a database)
const storedEvents = new Map<string, StoredEvent>();
const dsnStorage = new Map<string, DsnRecord>();
const featureFlagStorage = new Map<string, FeatureFlag>();
const segmentStorage = new Map<string, Segment>();
const projectStorage = new Map<string, Project>();
const appStorage = new Map<string, AppRecord>();
const SERVER_PORT = Number(process.env.PORT) || 31337;

const jsonHeaders = { "Content-Type": "application/json" };

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

// Parse DSN to extract public key and project ID
function parseDsn(dsn: string): { publicKey: string; projectId: string } | null {
  try {
    // Format: https://<public_key>@<host>/<project_id>
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.slice(1); // Remove leading slash
    return { publicKey, projectId };
  } catch {
    return null;
  }
}

// Validate authentication from request (Sentry - DSN based)
function validateAuth(request: Request, expectedProjectId: string): { valid: boolean; publicKey?: string } {
  const authHeader = request.headers.get("X-Sentry-Auth");
  const url = new URL(request.url);
  const sentryKey = url.searchParams.get("sentry_key");

  // Check query parameter first
  if (sentryKey) {
    return { valid: true, publicKey: sentryKey };
  }

  // Check X-Sentry-Auth header
  if (authHeader) {
    const match = authHeader.match(/sentry_key=([^,]+)/);
    if (match) {
      return { valid: true, publicKey: match[1] };
    }
  }

  return { valid: false };
}

// Admin authentication (OAuth2/OIDC)
interface AdminAuthResult {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
  error?: string;
}

function validateAdminAuth(request: Request): AdminAuthResult {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.slice(7); // Remove "Bearer "
  
  // In production, validate OAuth2/OIDC token with JWKS
  // For testing, accept a mock token
  if (token === "admin-test-token" || token.startsWith("admin-")) {
    return {
      valid: true,
      user: {
        id: "admin-1",
        email: "admin@company.com",
        name: "Admin User",
        roles: ["admin"]
      }
    };
  }

  // Simulate token validation
  if (token.length > 20) {
    return {
      valid: true,
      user: {
        id: "admin-" + crypto.randomUUID().slice(0, 8),
        email: "user@company.com",
        name: "Test User",
        roles: ["member"]
      }
    };
  }

  return { valid: false, error: "Invalid or expired token" };
}

// Middleware to check Sentry authentication (DSN)
function requireSentryAuth(projectIdParam: string = "projectId") {
  return async ({ request, params, set }: any) => {
    const projectId = params[projectIdParam];
    const auth = validateAuth(request, projectId);
    if (!auth.valid) {
      set.status = 401;
      return { error: "Unauthorized - Invalid DSN" };
    }
    return { auth };
  };
}

// Middleware to check Admin authentication (OAuth2/OIDC)
function requireAdminAuth() {
  return async ({ request, set }: any) => {
    const auth = validateAdminAuth(request);
    if (!auth.valid) {
      set.status = 401;
      return { error: auth.error || "Unauthorized - Admin authentication required" };
    }
    return { auth };
  };
}

// Parse envelope format
function parseEnvelope(raw: string): { header: EnvelopeHeader; items: Array<{ header: ItemHeader; payload: unknown }> } | null {
  const lines = raw.split("\n");
  if (lines.length < 2) return null;

  try {
    const header = JSON.parse(lines[0] || "{}") as EnvelopeHeader;
    const items: Array<{ header: ItemHeader; payload: unknown }> = [];

    let i = 1;
    while (i < lines.length) {
      const line = lines[i];
      if (!line?.trim()) {
        i++;
        continue;
      }
      const itemHeader = JSON.parse(line) as ItemHeader;
      i++;
      if (i >= lines.length) break;
      const payloadLine = lines[i];
      if (!payloadLine) break;
      const payload = JSON.parse(payloadLine);
      items.push({ header: itemHeader, payload });
      i++;
    }

    return { header, items };
  } catch (e) {
    console.error("Failed to parse envelope:", e);
    return null;
  }
}

// Extract event ID from envelope
function extractEventId(parsed: { header: EnvelopeHeader; items: Array<{ header: ItemHeader; payload: unknown }> }): string {
  // Check envelope header first
  if (parsed.header.event_id) {
    return parsed.header.event_id;
  }

  // Check event items
  for (const item of parsed.items) {
    if (item.header.type === "event" && item.payload && typeof item.payload === "object" && "event_id" in item.payload) {
      return (item.payload as { event_id: string }).event_id;
    }
  }

  // Check transaction items
  for (const item of parsed.items) {
    if (item.header.type === "transaction" && item.payload && typeof item.payload === "object" && "event_id" in item.payload) {
      return (item.payload as { event_id: string }).event_id;
    }
  }

  // Check span items (after conversion, they become transactions)
  for (const item of parsed.items) {
    if (item.header.type === "span" && item.payload && typeof item.payload === "object" && "trace_id" in item.payload) {
      // For spans, use trace_id or span_id as the identifier
      const spanPayload = item.payload as any;
      if (spanPayload.trace_id) {
        return spanPayload.trace_id;
      }
    }
  }

  // Generate new UUID if not found
  return crypto.randomUUID();
}

// Normalize transaction payload by extracting fields from contexts.trace to top level
function normalizeTransactionPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, any>;
    if ("contexts" in p && p.contexts && typeof p.contexts === "object") {
      const trace = p.contexts.trace;
      if (trace && typeof trace === "object") {
        if ("trace_id" in trace && !("trace_id" in p)) {
          p.trace_id = trace.trace_id;
        }
        if ("status" in trace && !("status" in p)) {
          p.status = trace.status;
        }
        if ("measurements" in trace && trace.measurements !== undefined && !("measurements" in p)) {
          p.measurements = trace.measurements;
        }
        // Also extract measurements from trace.data.sentry.measurement.*
        if ("data" in trace && trace.data && typeof trace.data === "object") {
          const measurements: Record<string, any> = {};
          for (const [key, val] of Object.entries(trace.data)) {
            if (key.startsWith("sentry.measurement.") && typeof val === "number") {
              const measurementName = key.replace("sentry.measurement.", "");
              measurements[measurementName] = { value: val };
            }
          }
          if (Object.keys(measurements).length > 0 && !("measurements" in p)) {
            p.measurements = measurements;
          }
        }
      }
    }
    // Also check for top-level measurements (direct transaction payloads)
    if ("measurements" in p && p.measurements !== undefined && typeof p.measurements === "object") {
      // Ensure measurements are in the correct format
      const measurements: Record<string, any> = {};
      for (const [key, val] of Object.entries(p.measurements)) {
        if (typeof val === "object" && val !== null && "value" in val) {
          measurements[key] = val;
        } else if (typeof val === "number") {
          measurements[key] = { value: val };
        }
      }
      if (Object.keys(measurements).length > 0) {
        p.measurements = measurements;
      }
    }
  }
  return payload;
}

// Convert a span batch (SDK v11+) to transaction payload format
function convertSpanToTransaction(itemHeader: ItemHeader, payload: unknown): { header: ItemHeader; payload: unknown } {
  const p = payload as Record<string, any>;
  
  console.log(`[DEBUG] convertSpanToTransaction payload:`, JSON.stringify(p).slice(0, 500));
  
  if (p.version === 2 && Array.isArray(p.items)) {
    const spans = p.items;
    const segmentSpan = spans.find((s: any) => s.is_segment) || spans[0];
    
    if (segmentSpan) {
      console.log(`[DEBUG] segmentSpan:`, JSON.stringify(segmentSpan).slice(0, 500));
      const transactionPayload: Record<string, any> = {
        transaction: segmentSpan.name || segmentSpan.attributes?.["sentry.segment.name"]?.value || "unknown",
        event_id: segmentSpan.span_id || crypto.randomUUID(),
        trace_id: segmentSpan.trace_id,
        span_id: segmentSpan.span_id,
        start_timestamp: segmentSpan.start_timestamp,
        timestamp: segmentSpan.end_timestamp,
      };
      
      // Extract op from attributes
      if (segmentSpan.attributes?.sentry.op) {
        transactionPayload.op = segmentSpan.attributes["sentry.op"].value;
      }
      
      // Extract status
      if (segmentSpan.status) {
        transactionPayload.status = segmentSpan.status;
      }
      
      // Extract measurements from attributes OR from span.measurements
      const measurements: Record<string, any> = {};
      
      // Path 1: sentry.measurement.* attributes
      if (segmentSpan.attributes) {
        for (const [key, attr] of Object.entries(segmentSpan.attributes)) {
          if (key.startsWith("sentry.measurement.")) {
            const measurementName = key.replace("sentry.measurement.", "");
            console.log(`[DEBUG] measurement key: ${key}, attr:`, JSON.stringify(attr));
            if (typeof attr === "object" && attr !== null) {
              // Handle different value formats
              if ("value" in attr && typeof attr.value === "number") {
                measurements[measurementName] = { value: attr.value };
              } else if (typeof attr === "number") {
                measurements[measurementName] = { value: attr };
              } else if ("value" in attr) {
                measurements[measurementName] = { value: attr.value };
              }
            }
          }
        }
      }
      
      // Path 2: segmentSpan.measurements (SDK alternative format)
      if (segmentSpan.measurements && typeof segmentSpan.measurements === "object") {
        for (const [key, val] of Object.entries(segmentSpan.measurements)) {
          if (typeof val === "number") {
            measurements[key] = { value: val };
          }
        }
      }
      
      if (Object.keys(measurements).length > 0) {
        transactionPayload.measurements = measurements;
      }
      
      // Collect child spans (non-segment spans)
      const childSpans = spans.filter((s: any) => !s.is_segment);
      if (childSpans.length > 0) {
        transactionPayload.spans = childSpans.map((s: any) => ({
          span_id: s.span_id,
          parent_span_id: s.parent_span_id,
          name: s.name,
          op: s.attributes?.sentry.op?.value || s.op,
          start_timestamp: s.start_timestamp,
          timestamp: s.end_timestamp,
          status: s.status,
        }));
      }
      
      // Build contexts.trace
      transactionPayload.contexts = {
        trace: {
          trace_id: segmentSpan.trace_id,
          span_id: segmentSpan.span_id,
          op: segmentSpan.attributes?.sentry.op?.value || transactionPayload.op,
          status: segmentSpan.status,
          ...(segmentSpan.parent_span_id ? { parent_span_id: segmentSpan.parent_span_id } : {}),
        }
      };
      
      // Extract duration
      if (segmentSpan.start_timestamp && segmentSpan.end_timestamp) {
        transactionPayload.duration = segmentSpan.end_timestamp - segmentSpan.start_timestamp;
      }
      
      return {
        header: { ...itemHeader, type: "transaction" as const },
        payload: transactionPayload
      };
    }
  }
  // Fallback: return as-is if not a valid span batch
  return { header: itemHeader, payload };
}

// Handle envelope ingestion endpoint
async function handleEnvelope(request: Request, projectId: string): Promise<Response> {
  const auth = validateAuth(request, projectId);
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType = request.headers.get("Content-Type");
  const isGzipped = request.headers.get("Content-Encoding") === "gzip";

  console.log(`[DEBUG] handleEnvelope called, contentType: ${contentType}, isGzipped: ${isGzipped}`);

  let rawBody: string;
  if (isGzipped) {
    const gunzip = new DecompressionStream("gzip");
    const stream = request.body?.pipeThrough(gunzip);
    rawBody = await new Response(stream).text();
  } else {
    rawBody = await request.text();
  }

  console.log(`[DEBUG] Raw body length: ${rawBody.length}`);
  console.log(`[DEBUG] Raw body preview: ${rawBody.slice(0, 200)}`);

  const parsed = parseEnvelope(rawBody);
  console.log(`[DEBUG] Parsed: ${parsed ? "success" : "failed"}`);
  if (parsed) {
    console.log(`[DEBUG] Parsed items: ${parsed.items.map(i => i.header.type).join(", ")}`);
  }
  if (!parsed) {
    return new Response(JSON.stringify({ error: "Invalid envelope format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Convert span items to transaction items (SDK v11 sends spans, not transactions)
  const convertedItems = parsed.items.map(item => {
    if (item.header.type === "span") {
      return convertSpanToTransaction(item.header, item.payload);
    }
    if (item.header.type === "transaction") {
      console.log(`[DEBUG] Received transaction payload:`, JSON.stringify(item.payload).slice(0, 1000));
    }
    if (item.header.type === "event") {
      console.log(`[DEBUG] Received event payload:`, JSON.stringify(item.payload, null, 2));
    }
    return item;
  });
  const convertedParsed = { header: parsed.header, items: convertedItems };

  const eventId = extractEventId(convertedParsed);

// Store the envelope
  console.log(`[DEBUG] About to store event with eventId: ${eventId}, storedEvents size before: ${storedEvents.size}`);
  storedEvents.set(eventId, {
    id: eventId,
    projectId,
    envelope: {
      header: convertedParsed.header,
      items: convertedParsed.items,
      raw: rawBody,
      receivedAt: new Date(),
    },
  });
  console.log(`[DEBUG] Stored event, storedEvents size after: ${storedEvents.size}`);

  console.log(`[Server] Received envelope with event_id: ${eventId}, items: ${parsed.items.map(i => i.header.type).join(", ")}`);

  return new Response(JSON.stringify({ id: eventId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Handle legacy store endpoint
async function handleStore(request: Request, projectId: string): Promise<Response> {
  const auth = validateAuth(request, projectId);
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await request.text();
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const eventId = event.event_id || crypto.randomUUID();
  
  storedEvents.set(eventId, {
    id: eventId,
    projectId,
    envelope: {
      header: { event_id: eventId, sent_at: new Date().toISOString() },
      items: [{ header: { type: "event", content_type: "application/json", length: rawBody.length }, payload: event }],
      raw: rawBody,
      receivedAt: new Date(),
    },
  });

  console.log(`[Server] Received legacy store event: ${eventId}`);

  return new Response(JSON.stringify({ id: eventId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Handle GET /events/:eventId
async function handleGetEvent(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const eventId = url.pathname.split("/").pop();
  
  if (!eventId) {
    return new Response(JSON.stringify({ error: "Event ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stored = storedEvents.get(eventId);
  if (!stored) {
    return new Response(JSON.stringify({ error: "Event not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return the first event payload from the envelope
  const eventItem = stored.envelope.items.find(item => item.header.type === "event");
  if (eventItem) {
    console.log(`[DEBUG] Full Event payload:`, JSON.stringify(eventItem.payload, null, 2));
    return new Response(JSON.stringify(eventItem.payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check for feedback item
  const feedbackItem = stored.envelope.items.find(item => item.header.type === "feedback");
  if (feedbackItem) {
    console.log(`[DEBUG] Full Feedback payload:`, JSON.stringify(feedbackItem.payload, null, 2));
    return new Response(JSON.stringify(feedbackItem.payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

   // If no event item, return the first item payload
   const firstItem = stored.envelope.items[0]?.payload || {};
   const fs = require('fs');
   fs.writeFileSync('/tmp/debug-firstItem.json', JSON.stringify(firstItem, null, 2));
   const normalized = normalizeTransactionPayload(firstItem);
   fs.writeFileSync('/tmp/debug-normalized.json', JSON.stringify(normalized, null, 2));
   return new Response(JSON.stringify(normalized), {
     status: 200,
     headers: { "Content-Type": "application/json" },
   });
}

// Handle GET /events
// List all stored events (returns full event payload for each event)
async function handleListEvents(): Promise<Response> {
  console.log(`[DEBUG] handleListEvents called, storedEvents size: ${storedEvents.size}`);
  const events = Array.from(storedEvents.values()).map(e => {
    const eventItem = e.envelope.items.find(item => item.header.type === "event");
    const txItem = e.envelope.items.find(item => item.header.type === "transaction");
    return {
      id: e.id,
      receivedAt: e.envelope.receivedAt,
      itemTypes: e.envelope.items.map(i => i.header.type),
      event: eventItem ? eventItem.payload : null,
      transaction: txItem ? txItem.payload : null,
    };
  });
  console.log(`[DEBUG] handleListEvents returning: ${JSON.stringify(events)}`);
  
  return new Response(JSON.stringify(events), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Handle POST /events/clear
async function handleClearEvents(): Promise<Response> {
  storedEvents.clear();
   return new Response(
     JSON.stringify({ success: true }),
     { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

// Create a new DSN
async function handleDsnCreate(request: Request): Promise<Response> {
  const body = await request.json() as DsnCreateRequest;

  if (!body.projectId) {
    return new Response(JSON.stringify({ error: "Missing required field: projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.host) {
    return new Response(JSON.stringify({ error: "Missing required field: host" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const publicKey = body.publicKey || crypto.randomUUID();
  const projectId = body.projectId;
  const host = body.host;
  const protocol = "https";
  const id = crypto.randomUUID();
  const createdAt = new Date();

  const record: DsnRecord = {
    id,
    config: { projectId, publicKey, host, protocol },
    createdAt,
  };

  dsnStorage.set(projectId, record);

  const response: DsnCreateResponse = {
    dsn: `https://${publicKey}@${host}/${projectId}`,
    projectId,
    publicKey,
    host,
    protocol,
    id,
    createdAt: createdAt.toISOString(),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Retrieve DSN for a project
async function handleDsnGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.pathname.split("/").pop();

  if (!projectId) {
    return new Response(JSON.stringify({ error: "Project ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = dsnStorage.get(projectId);
  if (!record) {
    return new Response(JSON.stringify({ error: `Project not found: ${projectId}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response: DsnResponse = {
    dsn: `https://${record.config.publicKey}@${record.config.host}/${record.config.projectId}`,
    projectId: record.config.projectId,
    publicKey: record.config.publicKey,
    host: record.config.host,
    protocol: record.config.protocol,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Generate a new DSN with random public key
async function handleDsnGenerate(request: Request): Promise<Response> {
  const body = await request.json() as { projectId: string; host: string };

  if (!body.projectId) {
    return new Response(JSON.stringify({ error: "Missing required field: projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.host) {
    return new Response(JSON.stringify({ error: "Missing required field: host" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const publicKey = crypto.randomUUID();
  const projectId = body.projectId;
  const host = body.host;
  const protocol = "https";
  const id = crypto.randomUUID();
  const createdAt = new Date();

  const record: DsnRecord = {
    id,
    config: { projectId, publicKey, host, protocol },
    createdAt,
  };

  dsnStorage.set(projectId, record);

  const response: DsnCreateResponse = {
    dsn: `https://${publicKey}@${host}/${projectId}`,
    projectId,
    publicKey,
    host,
    protocol,
    id,
    createdAt: createdAt.toISOString(),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ============ Feature Flags Handlers ============

function generateId(prefix: string = ""): string {
  return `${prefix}${prefix ? "_" : ""}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function evaluateFlag(flag: FeatureFlag, user: EvaluationRequest["user"], context?: EvaluationRequest["context"]): { variantKey: string; value: any; reason: string } {
  // Check targeting rules first
  for (const rule of flag.targetingRules) {
    let userValue: any;
    
    // Extract value from user/context based on attribute path
    if (rule.attribute.startsWith("user.")) {
      const path = rule.attribute.slice(5).split(".");
      let obj: any = user;
      for (const key of path) {
        obj = obj?.[key];
      }
      userValue = obj;
    } else if (rule.attribute.startsWith("context.")) {
      const path = rule.attribute.slice(8).split(".");
      let obj: any = context;
      for (const key of path) {
        obj = obj?.[key];
      }
      userValue = obj;
    }
    
    // Evaluate rule
    let matched = false;
    switch (rule.operator) {
      case "equals": matched = userValue === rule.value; break;
      case "not_equals": matched = userValue !== rule.value; break;
      case "contains": matched = String(userValue).includes(String(rule.value)); break;
      case "not_contains": matched = !String(userValue).includes(String(rule.value)); break;
      case "starts_with": matched = String(userValue).startsWith(String(rule.value)); break;
      case "ends_with": matched = String(userValue).endsWith(String(rule.value)); break;
      case "in": matched = Array.isArray(rule.value) && rule.value.includes(userValue); break;
      case "not_in": matched = Array.isArray(rule.value) && !rule.value.includes(userValue); break;
      case "greater_than": matched = Number(userValue) > Number(rule.value); break;
      case "less_than": matched = Number(userValue) < Number(rule.value); break;
      case "greater_than_or_equal": matched = Number(userValue) >= Number(rule.value); break;
      case "less_than_or_equal": matched = Number(userValue) <= Number(rule.value); break;
    }
    
    if (matched) {
      const variant = flag.variants.find(v => v.key === rule.variantKey);
      if (variant) {
        return { variantKey: variant.key, value: variant.value, reason: `Matched targeting rule: ${rule.attribute} ${rule.operator} ${rule.value}` };
      }
    }
  }
  
  // Check segments
  for (const segmentId of flag.segments) {
    const segment = segmentStorage.get(segmentId);
    if (segment) {
      let allMatched = true;
      for (const rule of segment.rules) {
        let userValue: any;
        if (rule.attribute.startsWith("user.")) {
          const path = rule.attribute.slice(5).split(".");
          let obj: any = user;
          for (const key of path) obj = obj?.[key];
          userValue = obj;
        } else if (rule.attribute.startsWith("context.")) {
          const path = rule.attribute.slice(8).split(".");
          let obj: any = context;
          for (const key of path) obj = obj?.[key];
          userValue = obj;
        }
        
        let matched = false;
        switch (rule.operator) {
          case "equals": matched = userValue === rule.value; break;
          case "not_equals": matched = userValue !== rule.value; break;
          case "contains": matched = String(userValue).includes(String(rule.value)); break;
          case "not_contains": matched = !String(userValue).includes(String(rule.value)); break;
          case "in": matched = Array.isArray(rule.value) && rule.value.includes(userValue); break;
          case "not_in": matched = Array.isArray(rule.value) && !rule.value.includes(userValue); break;
        }
        if (!matched) { allMatched = false; break; }
      }
      if (allMatched) {
        // Use rollout percentage to assign variant
        const hash = user.id.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
        const bucket = hash % 100;
        let cumulative = 0;
        for (const variant of flag.variants) {
          cumulative += variant.weight;
          if (bucket < cumulative) {
            return { variantKey: variant.key, value: variant.value, reason: `Matched segment: ${segment.name}` };
          }
        }
      }
    }
  }
  
  // Rollout percentage
  if (flag.rolloutPercentage < 100) {
    const hash = user.id.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
    if (hash % 100 >= flag.rolloutPercentage) {
      const controlVariant = flag.variants.find(v => v.key === "control") || flag.variants[0];
      return { variantKey: controlVariant.key, value: controlVariant.value, reason: "Default (outside rollout percentage)" };
    }
  }
  
  // Default: weighted random assignment
  const hash = user.id.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  const bucket = hash % 100;
  let cumulative = 0;
  for (const variant of flag.variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) {
      return { variantKey: variant.key, value: variant.value, reason: "Weighted random assignment" };
    }
  }
  
  // Fallback
  const fallback = flag.variants[0];
  return { variantKey: fallback.key, value: fallback.value, reason: "Default value (no matching rules)" };
}

// Create a new feature flag
async function handleFeatureFlagCreate(request: Request): Promise<Response> {
  const body = await request.json() as FeatureFlagCreateRequest;

  if (!body.key || !body.name || !body.type || body.defaultValue === undefined) {
    return new Response(JSON.stringify({ error: "Missing required fields: key, name, type, defaultValue" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = generateId("ff");
  const now = new Date();
  
  // Default variants for boolean flags
  let variants = body.variants;
  if (!variants || variants.length === 0) {
    if (body.type === "boolean") {
      variants = [
        { key: "control", name: "Control", value: false, weight: 50 },
        { key: "treatment", name: "Treatment", value: true, weight: 50 }
      ];
    } else {
      variants = [{ key: "default", name: "Default", value: body.defaultValue, weight: 100 }];
    }
  }

  const flag: FeatureFlag = {
    id,
    key: body.key,
    name: body.name,
    description: body.description || "",
    type: body.type,
    defaultValue: body.defaultValue,
    variants,
    targetingRules: body.targetingRules || [],
    segments: body.segments || [],
    status: "draft",
    rolloutPercentage: 100,
    experiment: body.experiment,
    createdAt: now,
    updatedAt: now,
    createdBy: "admin@test.com",
    updatedBy: "admin@test.com",
  };

  featureFlagStorage.set(id, flag);

  return new Response(JSON.stringify(flag), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// List feature flags
async function handleFeatureFlagList(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const status = url.searchParams.get("status") as FeatureFlagStatus | null;
  const type = url.searchParams.get("type") as "boolean" | "string" | "number" | "json" | null;
  const search = url.searchParams.get("search") || "";

  let flags = Array.from(featureFlagStorage.values());

  if (status) {
    flags = flags.filter(f => f.status === status);
  }
  if (type) {
    flags = flags.filter(f => f.type === type);
  }
  if (search) {
    const lowerSearch = search.toLowerCase();
    flags = flags.filter(f => 
      f.key.toLowerCase().includes(lowerSearch) || 
      f.name.toLowerCase().includes(lowerSearch)
    );
  }

  // Sort by updatedAt desc
  flags.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const total = flags.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = flags.slice(start, start + limit);

  const response: FeatureFlagListResponse = {
    data,
    pagination: { page, limit, total, totalPages }
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Get a specific feature flag
async function handleFeatureFlagGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return new Response(JSON.stringify({ error: "Feature flag ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const flag = featureFlagStorage.get(id);
  if (!flag) {
    return new Response(JSON.stringify({ error: `Feature flag not found: ${id}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(flag), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Update a feature flag
async function handleFeatureFlagUpdate(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return new Response(JSON.stringify({ error: "Feature flag ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const flag = featureFlagStorage.get(id);
  if (!flag) {
    return new Response(JSON.stringify({ error: `Feature flag not found: ${id}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json() as FeatureFlagUpdateRequest;
  const now = new Date();

  const updated: FeatureFlag = {
    ...flag,
    ...body,
    id,
    createdAt: flag.createdAt,
    updatedAt: now,
    updatedBy: "admin@test.com",
  };

  featureFlagStorage.set(id, updated);

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Update feature flag status
async function handleFeatureFlagStatus(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Path: /api/admin/feature-flags/:id/status -> split: ["", "api", "admin", "feature-flags", ":id", "status"]
  const id = url.pathname.split("/")[4];

  if (!id) {
    return new Response(JSON.stringify({ error: "Feature flag ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const flag = featureFlagStorage.get(id);
  if (!flag) {
    return new Response(JSON.stringify({ error: `Feature flag not found: ${id}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json() as { status: FeatureFlagStatus };
  const validStatuses: FeatureFlagStatus[] = ["draft", "active", "paused", "archived"];
  
  if (!body.status || !validStatuses.includes(body.status)) {
    return new Response(JSON.stringify({ error: "Invalid status" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated: FeatureFlag = {
    ...flag,
    status: body.status,
    updatedAt: new Date(),
    updatedBy: "admin@test.com",
  };

  featureFlagStorage.set(id, updated);

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Delete a feature flag
async function handleFeatureFlagDelete(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return new Response(JSON.stringify({ error: "Feature flag ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const flag = featureFlagStorage.get(id);
  if (!flag) {
    return new Response(JSON.stringify({ error: `Feature flag not found: ${id}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (flag.status !== "draft") {
    return new Response(JSON.stringify({ error: "Only draft flags can be deleted" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  featureFlagStorage.delete(id);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Segment handlers
async function handleSegmentCreate(request: Request): Promise<Response> {
  const body = await request.json() as { name: string; description?: string; rules: TargetingRule[] };

  if (!body.name || !body.rules || !Array.isArray(body.rules)) {
    return new Response(JSON.stringify({ error: "Missing required fields: name, rules" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = generateId("seg");
  const now = new Date();

  const segment: Segment = {
    id,
    name: body.name,
    description: body.description || "",
    rules: body.rules,
    userCount: 0, // Would be computed in real implementation
    createdAt: now,
    updatedAt: now,
  };

  segmentStorage.set(id, segment);

  return new Response(JSON.stringify(segment), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleSegmentList(request: Request): Promise<Response> {
  const segments = Array.from(segmentStorage.values());
  return new Response(JSON.stringify({ data: segments }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleSegmentGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return new Response(JSON.stringify({ error: "Segment ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const segment = segmentStorage.get(id);
  if (!segment) {
    return new Response(JSON.stringify({ error: `Segment not found: ${id}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return with sample users (mock)
  const response = {
    ...segment,
    userCount: Math.floor(Math.random() * 5000),
    sampleUsers: [
      { id: "user_1", email: "john@example.com", name: "John Doe" },
      { id: "user_2", email: "jane@example.com", name: "Jane Smith" }
    ]
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ============ Projects & Apps Handlers ============

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortId(length: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

function toAppResponse(app: AppRecord): AppResponse {
  return {
    id: app.id,
    projectId: app.projectId,
    name: app.name,
    platform: app.platform,
    ingestKey: app.ingestKey,
    dsn: `${app.protocol}://${app.publicKey}@${app.host}/${app.ingestKey}`,
    publicKey: app.publicKey,
    host: app.host,
    protocol: app.protocol,
    createdAt: app.createdAt.toISOString(),
  };
}

function listAppsFor(projectId: string): AppRecord[] {
  return Array.from(appStorage.values())
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    appCount: listAppsFor(project.id).length,
    createdAt: project.createdAt.toISOString(),
  };
}

async function handleProjectCreate(request: Request): Promise<Response> {
  let body: ProjectCreateRequest;
  try {
    body = await request.json() as ProjectCreateRequest;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!body.name || typeof body.name !== "string") {
    return jsonResponse(400, { error: "Missing required field: name" });
  }

  const id = crypto.randomUUID();
  let slug = body.slug ? slugify(body.slug) : slugify(body.name);
  if (!slug) slug = "project";

  const existingSlugs = new Set(Array.from(projectStorage.values()).map((p) => p.slug));
  if (existingSlugs.has(slug)) {
    slug = `${slug}-${shortId(6)}`;
  }

  const project: Project = {
    id,
    name: body.name,
    slug,
    description: body.description || "",
    createdAt: new Date(),
  };

  projectStorage.set(id, project);

  return jsonResponse(200, toProjectResponse(project));
}

function handleProjectList(): Response {
  const projects = Array.from(projectStorage.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toProjectResponse);

  const response: ProjectListResponse = { data: projects };
  return jsonResponse(200, response);
}

function handleProjectGet(id: string): Response {
  const project = projectStorage.get(id);
  if (!project) {
    return jsonResponse(404, { error: `Project not found: ${id}` });
  }

  const response: ProjectDetailResponse = {
    ...toProjectResponse(project),
    apps: listAppsFor(project.id).map(toAppResponse),
  };

  return jsonResponse(200, response);
}

function handleProjectDelete(id: string): Response {
  const project = projectStorage.get(id);
  if (!project) {
    return jsonResponse(404, { error: `Project not found: ${id}` });
  }

  for (const app of listAppsFor(id)) {
    appStorage.delete(app.id);
  }
  projectStorage.delete(id);

  return jsonResponse(200, { success: true });
}

async function handleAppCreate(request: Request, projectId: string): Promise<Response> {
  const project = projectStorage.get(projectId);
  if (!project) {
    return jsonResponse(404, { error: `Project not found: ${projectId}` });
  }

  let body: AppCreateRequest;
  try {
    body = await request.json() as AppCreateRequest;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!body.name || typeof body.name !== "string") {
    return jsonResponse(400, { error: "Missing required field: name" });
  }

  // Default the DSN host to the host this server was reached on so the
  // generated DSN works out of the box against this instance.
  const requestHost = request.headers.get("host");
  const host = body.host || requestHost || "benemetrics.app";
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(host);
  const protocol = isLocal ? "http" : "https";

  const app: AppRecord = {
    id: crypto.randomUUID(),
    projectId,
    name: body.name,
    platform: body.platform || "node",
    ingestKey: `${project.slug}-${shortId(12)}`,
    publicKey: crypto.randomUUID().replace(/-/g, ""),
    host,
    protocol,
    createdAt: new Date(),
  };

  appStorage.set(app.id, app);

  return jsonResponse(200, toAppResponse(app));
}

function handleAppList(projectId: string): Response {
  if (!projectStorage.has(projectId)) {
    return jsonResponse(404, { error: `Project not found: ${projectId}` });
  }

  const response: AppListResponse = { data: listAppsFor(projectId).map(toAppResponse) };
  return jsonResponse(200, response);
}

function handleAppGet(appId: string): Response {
  const app = appStorage.get(appId);
  if (!app) {
    return jsonResponse(404, { error: `App not found: ${appId}` });
  }

  return jsonResponse(200, toAppResponse(app));
}

function handleAppDelete(appId: string): Response {
  const app = appStorage.get(appId);
  if (!app) {
    return jsonResponse(404, { error: `App not found: ${appId}` });
  }

  appStorage.delete(appId);

  return jsonResponse(200, { success: true });
}

// Evaluation endpoint
async function handleFeatureFlagEvaluate(request: Request): Promise<Response> {
  const body = await request.json() as EvaluationRequest;

  if (!body.user?.id || !body.flags?.length) {
    return new Response(JSON.stringify({ error: "Missing required fields: user.id, flags" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const evaluations = [];
  
  for (const flagKey of body.flags) {
    const flag = Array.from(featureFlagStorage.values()).find(f => f.key === flagKey);
    if (!flag) {
      evaluations.push({
        flagKey,
        variantKey: "default",
        value: null,
        reason: "Feature flag not found"
      });
      continue;
    }

    if (flag.status !== "active") {
      const controlVariant = flag.variants.find(v => v.key === "control") || flag.variants[0];
      evaluations.push({
        flagKey,
        variantKey: controlVariant.key,
        value: controlVariant.value,
        reason: `Flag is ${flag.status}, returning default`
      });
      continue;
    }

    const result = evaluateFlag(flag, body.user, body.context);
    evaluations.push({
      flagKey,
      ...result
    });
  }

  const response: EvaluationResponse = {
    evaluations,
    evaluatedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Handle GET /health
async function handleHealth(): Promise<Response> {
  return new Response(JSON.stringify({ status: "ok", eventsStored: storedEvents.size }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Create Elysia app
// Serve the frontend via Bun's fullstack dev server (HTML import).
// Bun bundles the <script>/<link> tags on the fly (TSX, CSS, Tailwind via
// bunfig.toml [serve.static] plugins) — no separate frontend build needed.
// HMR is enabled when NODE_ENV !== "production".
const app = new Elysia({
  serve: {
    routes: {
      "/ui": ui,
      "/ui/*": ui,
    },
  },
})
  // Health check (public)
  .get("/health", () => handleHealth())

  // Events endpoints (public for testing)
  .get("/events", () => handleListEvents())
  .post("/events/clear", () => handleClearEvents())
  .get("/events/:eventId", ({ params }) => handleGetEvent(new Request(`http://localhost:${SERVER_PORT}/events/${params.eventId}`)))

  // Sentry endpoints (DSN authentication)

  .group("/api", (app) =>
    app
      // Envelope ingestion: POST /api/:projectId/envelope/
      .post("/:projectId/envelope/", async ({ request, params, set }) => {
        console.log(`[DEBUG] Route handler called for projectId: ${params.projectId}`);
        const auth = validateAuth(request, params.projectId);
        console.log(`[DEBUG] Auth result: ${JSON.stringify(auth)}`);
        if (!auth.valid) {
          set.status = 401;
          return { error: "Unauthorized - Invalid DSN" };
        }
        return await handleEnvelope(request, params.projectId);
      })
      // Legacy store: POST /api/:projectId/store/
      .post("/:projectId/store/", async ({ request, params, set }) => {
        const auth = validateAuth(request, params.projectId);
        if (!auth.valid) {
          set.status = 401;
          return { error: "Unauthorized - Invalid DSN" };
        }
        return await handleStore(request, params.projectId);
      })
      // DSN management endpoints (Sentry - DSN auth)
      .post("/dsn/create", async ({ request, set }) => {
        const authHeader = request.headers.get("Authorization");
        const url = new URL(request.url);
        const sentryKey = url.searchParams.get("sentry_key");
        
        let valid = false;
        if (sentryKey) {
          valid = true;
        } else if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          if (token.length > 10) valid = true; // Accept any reasonable token for testing
        }
        
        if (!valid) {
          set.status = 401;
          return { error: "Unauthorized - DSN authentication required" };
        }
        return await handleDsnCreate(request);
      })
      .get("/dsn/:projectId", async ({ request, set }) => {
        const authHeader = request.headers.get("Authorization");
        const url = new URL(request.url);
        const sentryKey = url.searchParams.get("sentry_key");
        
        let valid = false;
        if (sentryKey) {
          valid = true;
        } else if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          if (token.length > 10) valid = true;
        }
        
        if (!valid) {
          set.status = 401;
          return { error: "Unauthorized - DSN authentication required" };
        }
        return await handleDsnGet(request);
      })
      .post("/dsn/generate", async ({ request, set }) => {
        const authHeader = request.headers.get("Authorization");
        const url = new URL(request.url);
        const sentryKey = url.searchParams.get("sentry_key");
        
        let valid = false;
        if (sentryKey) {
          valid = true;
        } else if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          if (token.length > 10) valid = true;
        }
        
        if (!valid) {
          set.status = 401;
          return { error: "Unauthorized - DSN authentication required" };
        }
        return await handleDsnGenerate(request);
      })
      // Feature flag evaluation (Sentry - DSN auth)
      .post("/feature-flags/evaluate", async ({ request, set }) => {
        const authHeader = request.headers.get("Authorization");
        const url = new URL(request.url);
        const sentryKey = url.searchParams.get("sentry_key");
        
        let valid = false;
        if (sentryKey) {
          valid = true;
        } else if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          if (token.length > 10) valid = true;
        }
        
        if (!valid) {
          set.status = 401;
          return { error: "Unauthorized - DSN authentication required" };
        }
        return await handleFeatureFlagEvaluate(request);
      })
  )

  // Admin endpoints (OAuth2/OIDC authentication)
  .group("/api/admin", (app) =>
    app
      .derive(async ({ request, set }) => {
        const auth = validateAdminAuth(request);
        if (!auth.valid) {
          set.status = 401;
          return { error: auth.error || "Unauthorized - Admin authentication required" };
        }
        return { adminUser: auth.user };
      })
      // Feature Flags management endpoints
      .post("/feature-flags", async ({ request }) => {
        return await handleFeatureFlagCreate(request);
      })
      .get("/feature-flags", async ({ request }) => {
        return await handleFeatureFlagList(request);
      })
      .get("/feature-flags/:id", async ({ request, params }) => {
        return await handleFeatureFlagGet(new Request(`http://localhost:${SERVER_PORT}/api/admin/feature-flags/${params.id}`));
      })
      .patch("/feature-flags/:id", async ({ request, params }) => {
        return await handleFeatureFlagUpdate(new Request(`http://localhost:${SERVER_PORT}/api/admin/feature-flags/${params.id}`, { method: "PATCH", body: JSON.stringify(await request.json()), headers: { "Content-Type": "application/json" } }));
      })
      .post("/feature-flags/:id/status", async ({ request, params }) => {
        return await handleFeatureFlagStatus(new Request(`http://localhost:${SERVER_PORT}/api/admin/feature-flags/${params.id}/status`, { method: "POST", body: JSON.stringify(await request.json()), headers: { "Content-Type": "application/json" } }));
      })
      .delete("/feature-flags/:id", async ({ request, params }) => {
        return await handleFeatureFlagDelete(new Request(`http://localhost:${SERVER_PORT}/api/admin/feature-flags/${params.id}`, { method: "DELETE" }));
      })
      // Segments endpoints
      .post("/segments", async ({ request }) => {
        return await handleSegmentCreate(request);
      })
      .get("/segments", async ({ request }) => {
        return await handleSegmentList(request);
      })
      .get("/segments/:id", async ({ request, params }) => {
        return await handleSegmentGet(new Request(`http://localhost:${SERVER_PORT}/api/admin/segments/${params.id}`));
      })
      // Projects & Apps management
      .post("/projects", async ({ request }) => {
        return await handleProjectCreate(request);
      })
      .get("/projects", () => handleProjectList())
      .get("/projects/:id", ({ params }) => handleProjectGet(params.id))
      .delete("/projects/:id", ({ params }) => handleProjectDelete(params.id))
      .post("/projects/:id/apps", async ({ request, params }) => {
        return await handleAppCreate(request, params.id);
      })
      .get("/projects/:id/apps", ({ params }) => handleAppList(params.id))
      .get("/apps/:appId", ({ params }) => handleAppGet(params.appId))
      .delete("/apps/:appId", ({ params }) => handleAppDelete(params.appId))
  );

// Redirect root to the UI
app.get("/", () => Response.redirect(new URL("/ui", `http://localhost:${SERVER_PORT}`)));

export type App = typeof app;

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(SERVER_PORT, () => {
    console.log(`[Sentry Server] Started on http://localhost:${SERVER_PORT}`);
    console.log(`[Sentry Server] Endpoints:`);
    console.log(`  POST   /api/:projectId/envelope/  - Receive envelopes`);
    console.log(`  POST   /api/:projectId/store/     - Legacy store endpoint`);
    console.log(`  POST   /api/dsn/create         - Create a new DSN`);
    console.log(`  GET    /api/dsn/:projectId     - Get DSN by project ID`);
    console.log(`  POST   /api/dsn/generate       - Generate a new DSN with random key`);
    console.log(`  POST   /api/admin/projects           - Create a project`);
    console.log(`  GET    /api/admin/projects           - List projects`);
    console.log(`  GET    /api/admin/projects/:id       - Get project with apps`);
    console.log(`  POST   /api/admin/projects/:id/apps  - Create app (with DSN)`);
    console.log(`  GET    /api/admin/apps/:appId        - Get app + DSN`);
    console.log(`  GET    /events                    - List all stored events`);
    console.log(`  GET    /events/:eventId           - Fetch event by ID`);
    console.log(`  POST   /events/clear              - Clear all events`);
    console.log(`  GET    /health                    - Health check`);
  });
}

export default app;