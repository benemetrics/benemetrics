import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

// Sentry exception payload shape (after backend best-effort symbolication):
// frames are oldest→newest and carry pre/post context lines.
export interface SentryFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  precontext?: string[];
  context_line?: string;
  postcontext?: string[];
}

export interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: { frames?: SentryFrame[] };
}

export function exceptionsFromPayload(
  payload: Record<string, unknown> | null,
): SentryException[] {
  const exc = payload?.["exception"] as
    { values?: SentryException[] } | undefined;
  if (exc?.values?.length) return exc.values;
  // Transaction/span payloads carry a plain stacktrace instead.
  const st = payload?.["stacktrace"] as { frames?: SentryFrame[] } | undefined;
  if (st?.frames?.length) return [{ stacktrace: st }];
  return [];
}

export function Stacktrace({ exceptions }: { exceptions: SentryException[] }) {
  const [appOnly, setAppOnly] = useState(true);
  useEffect(() => setAppOnly(true), [exceptions]);

  const frames = exceptions.flatMap((e) => e.stacktrace?.frames ?? []);
  if (frames.length === 0) return null;

  // Newest frame first — the crashing line leads.
  const ordered = [...frames].reverse();
  const shown = appOnly ? ordered.filter((f) => f.in_app !== false) : ordered;
  const header = exceptions[0];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Stack trace
        </h3>
        <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(
            [
              ["App only", true],
              ["Full", false],
            ] as const
          ).map(([l, v]) => (
            <button
              key={l}
              onClick={() => setAppOnly(v)}
              className={cn(
                "rounded-sm px-2 py-0.5",
                appOnly === v ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-code font-mono text-xs">
        {header?.value && (
          <div className="border-b px-3 py-2 text-destructive">
            {header.type ? `${header.type}: ` : ""}
            {header.value}
          </div>
        )}
        {shown.length === 0 && (
          <div className="px-3 py-2 text-muted-foreground">
            No in-app frames.
          </div>
        )}
        {shown.map((f, idx) => {
          const file = f.filename ?? f.abs_path ?? f.module ?? "unknown";
          const context = [
            ...(f.precontext ?? []).map((code, i) => ({
              line: (f.lineno ?? 0) - (f.precontext?.length ?? 0) + i,
              code,
            })),
            ...(f.context_line != null && f.lineno != null
              ? [{ line: f.lineno, code: f.context_line }]
              : []),
            ...(f.postcontext ?? []).map((code, i) => ({
              line: (f.lineno ?? 0) + 1 + i,
              code,
            })),
          ];
          return (
            <div key={idx} className="border-b last:border-0">
              <div
                className={cn(
                  "flex flex-wrap gap-x-2 px-3 py-2",
                  f.in_app === false && "opacity-50",
                )}
              >
                <span className="text-muted-foreground">at</span>
                <span className="font-semibold text-warning">
                  {f.function ?? f.module ?? "unknown"}
                </span>
                <span className="text-muted-foreground">
                  ({file}:
                  <span className="text-foreground">{f.lineno ?? "?"}</span>:
                  {f.colno ?? "?"})
                </span>
              </div>
              {context.length > 0 && (
                <pre className="overflow-x-auto bg-card py-1">
                  {context.map((c) => (
                    <div
                      key={c.line}
                      className={cn(
                        "px-3",
                        c.line === f.lineno &&
                          "bg-destructive/10 text-foreground",
                      )}
                    >
                      <span className="mr-4 inline-block w-8 text-right text-muted-foreground">
                        {c.line}
                      </span>
                      {c.code}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
