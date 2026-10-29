interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: Array<{ key?: string; value?: OtlpAnyValue }> };
}

interface OtlpKeyValue {
  key?: string;
  value?: OtlpAnyValue;
}

interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

interface OtlpInstrumentationScope {
  name?: string;
  version?: string;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpKeyValue[];
  status?: { code?: number; message?: string };
}

interface OtlpScopeSpans {
  scope?: OtlpInstrumentationScope;
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
}

interface OtlpExportTraceServiceRequest {
  resourceSpans?: OtlpResourceSpans[];
}

export type {
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpResource,
  OtlpInstrumentationScope,
  OtlpSpan,
  OtlpScopeSpans,
  OtlpResourceSpans,
  OtlpExportTraceServiceRequest,
};
