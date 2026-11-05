# Todo: crash-free sessions metric (`sessions.*` counters + `crash_free_rate`)

**Definition:** crash-free % = `(sessions − crashed) / sessions × 100` per app/release/environment over a window. Unit = **session** (envelope item `session`, `status: ok | exited | abnormal | crashed`), NOT events. `abnormal` is reported but never counted as a crash. Until an app sends sessions, every read returns `null` (UI shows "—") — no invented baselines, no fatal/error-ratio proxies labeled "crash".

The storage side needs nothing new: `benemetrics.metrics` already flows to `benemetrics_metrics` (`PROJECTID, APPID, EVENTID, metric, value, dimension, tags, receivedAt`, `ReplacingMergeTree` + `FINAL`). The metric name + tags carry the session semantics.

## 1. Ingest edge (extract sessions → counters) — ✅ done

- [x] `backend/metrics/samples.ts` → `extractMetricSamples`: accepts `header.type === "session"` alongside `event`/`transaction`.
- [x] Parses the session payload (`sid`, `status`, `attrs.release`, `attrs.environment`); tolerates missing fields (session still counts, just untagged).
- [x] Emits per terminal session item: `session_total = 1`, `session_crashed = 1` (`status=crashed`), `session_abnormal = 1` (`status=abnormal`), tagged `sid`/`release`/`environment`.
- [x] Only terminal states (`exited`/`abnormal`/`crashed`) count; `started`/`ok` flushes never emit; `sid` tag + `FINAL` collapse redeliveries.
- [x] Publish path untouched (`extractMetricSamples` already flows through `dispatchIngestedEvent`).
- [ ] **Session semantics unit tests still missing** (see §7).

## 2. Issue / side-effects consumer — nothing to do (verified)

- [x] `session` items produce no issue digest (`docs/issues.md` §51) and metric samples are not read by the side-effects consumer; no code added.

## 3. Read side (series + crash-free rate) — ✅ done (release-filtered series: not yet)

- [x] `session_total` / `session_crashed` / `session_abnormal` flow through the existing series endpoint (`backend/metrics/index.ts`, units in `METRIC_UNITS`).
- [x] `crash_free_rate = 100 × (1 − crashed/total)` derived per bucket in `crashFreeSeries` (`backend/metrics/index.ts`); `count` = sample count; rate fills `mean` + quantiles.
- [x] `<crash_free_rate>` is a derived read only — never published as a sample at ingest.
- [ ] Series with a `release`/`environment` tag filter (`MetricReadFilter.tags`) — needed for the releases page column.

## 4. UI — partially done

- [x] Replacement for the mock `App.crashFree`: `useCrashFree(appId)` (`frontend/src/hooks/use-metrics.ts`) reads the last bucket of the derived series; `null` until sessions exist. Rendered as a `crash-free` Pill in the app header (`frontend/src/components/app-layout.tsx`).
- [x] Alerts form metric list now carries the real alertable metrics (`event_count | error_count | fatal_count | new_issue_count | session_total | session_crashed`); mock fake names (`flag_error_rate`, `p95_latency`, `new_issues`, `crash_free_rate`) removed; the mock alert rule in `frontend/src/lib/data.ts` now uses `session_crashed`.
- [x] Mock `crashFree` removed from `frontend/src/lib/data.ts` (type, generator, mock alert metric).
- [x] Known limitation (noted in code): `useMetrics`' live-reload filter matches raw sample names, so a `crash_free_rate` series refreshes on navigation only (no live tick) — harmless, revisit if the pill must be live.
- [ ] Releases page: crash-free-per-release column (blocked on §3 tag-filtered series).

## 5. Alerting (phase 1: flat counters) — ✅ done

- [x] `AlertMetric` (`backend/protocol/alerting.ts`) + arktype unions (`backend/alerting/index.ts`) extended with `session_total`, `session_crashed`.
- [x] `computeRuleValue` + `computeBaselineMetric` cases (`backend/alerting/evaluation.ts`) — same ClickHouse count path as `event_count`.
- [x] `crash_free_rate` deliberately NOT alertable — the flat sweeper cannot divide two series (a `ratio` rule kind is a later, separate decision).

## 6. Docs — ✅ done

- [x] `docs/metrics.md` — sessions taxonomy (terminal-state-only rule, sid idempotency, abnormal semantics), crash-free formula, alerting note.
- [x] `docs/alerting.md` — metric table + threshold-evaluation list + severity note (`session_*` are counts → default severity).
- [x] `docs/BACKEND_API.md` — rule metric union, series note for the derived `crash_free_rate`, extraction paragraph.

## 7. Tests (one hop each) — ❌ NOT done (explicitly skipped: "dump with no checks")

- [ ] ingest → NATS: envelope with a `session` item (`status: crashed`) publishes `session_total` + `session_crashed`; `started` publishes nothing.
- [ ] NATS → CH: samples land in `benemetrics_metrics` via the MV.
- [ ] CH → API: `/api/admin/metrics/series?metric=crash_free_rate` returns the expected ratio; empty window → no points; `session_total`/`session_crashed` series present.
- [ ] Alert evaluation: a `session_crashed > N` rule fires and does not double-fire on redelivery.
- [ ] `sid` replay dedup (`FINAL`) unit test.

Post-dump review list (run when checking): `bun run typecheck`, `bun run test`, plus frontend `bunx tsc -p frontend/tsconfig.json --noEmit` and `bun run build`.
