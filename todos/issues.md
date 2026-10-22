# Issues — open questions & implementation order

Moved out of [`docs/issues.md`](../docs/issues.md), which describes the design. Section
references (§4, §7, …) point at that document. Nothing below changes the design; each batch
ships with `bun run typecheck` + `bun run test` green.

## Implementation status

**Implemented today**

- The Postgres projection and its transitions (§5–§6), resolve/reopen (§6.2), the one-shot `new_issue`/`regression` triggers (§11), scoped reads (§10), and the list/detail/patch API (§9.1).
- Grouping lives in `backend/issues/grouping.ts` (fingerprint/title/culprit/level/type + `extractIssueDigests`); explicit fingerprints expand `{{ default }}` and truncate to 500 chars (§4.1).
- The digest rides the message as `issueEvents` (§5); the consumer prefers it and falls back to the envelope items.
- The ClickHouse issue index (`sentry_issue_events` + the materialized view) with the occurrence, stats and release-fingerprint reads (§8).
- The search query protocol: the grammar (`backend/issues/query.ts`), the resolver (`backend/issues/resolve.ts`) and the `query`/`sort` list endpoint (§9).
- The projection carries `culprit`/`level`/`type`/`first_release`/`last_release` (§7) and `markSeen` is message-id guarded (§6.1).
- The frontend reads the server's occurrences and counters; the local grouping mirror is gone (§12).

## Open questions

- [x] Any-occurrence `level:`/`release:` semantics served by the CH index — `level:`, `user:` and `tag:` match any occurrence (the ClickHouse issue index carries the level, the user and the tags).
- [x] `sort=users` — the distinct-user count is aggregated over the ClickHouse issue index (`clickHouseIssueUserCounts`, `uniqIf(user, ...)`) and synced into the `issues.user_count` column (a set value, never an increment) when a `sort=users` read happens; the read then orders on it with normal cursor pagination (`backend/issues/index.ts`, `db/dao/issues.ts`, hop test in `backend/tests/42`).
- [x] OR groups in the grammar — `a | b` (the groups are ORed, the terms inside one are ANDed; the AND binds tighter).
- [ ] Server-side dimension aggregation for the issue metrics panel (browser/OS/release breakdowns over the CH index). **Held**: the issue index carries `tags` (JSON) but the SDKs do not consistently send browser/OS as tags, so honest aggregates would mean widening the index with new parsed columns and re-reading history — put on hold until a real breakdown is needed. `release:` filtering and the per-release summary already read the index.
- [x] Release summary from the CH index (replaces the event scan in `backend/releases/metrics.ts`) — the summary reads the issue index (the occurrences, the first appearance and the first release of every issue).
- [x] Whether `clear` should keep or drop the message-id guard semantics for `event_count` reconciliation — there is no `clear` surface to reconcile: the guard stays (the `event_count` increments once per message).

## Implementation batches

- [x] 1. Grouping module: move fingerprint/title/crash-frame to `backend/issues/grouping.ts`; add digest extraction (`extractIssueDigests(items)`); update imports (`tracking.ts`, `evaluation.ts`, `releases/metrics.ts`); unit tests.
- [x] 2. Message digest: extend `SentryEventMessage` in `backend/nats.ts` (`issueEvents` as JSON text); attach it in both ingest routes; consumer prefers digests (envelope-parse fallback kept until batch 7); hop test 1.
- [x] 3. PG projection: `culprit`/`level`/`type`/`first_release`/`last_release` columns via `drizzle-kit generate`; digest-driven transitions; message-id-guarded `markSeen`; DTO/protocol updates; hop test 2.
- [x] 4. CH issue index: engine column (new installs + `ALTER`), `sentry_issue_events` with the events-table TTL + MV via `ensureView` + truncate on clear; extend the events-TTL setting to the index; occurrence/stats/release-fingerprint queries; hop test 3.
- [x] 5. Query protocol: `backend/issues/query.ts` parser + AST; resolved filter in `issueDAO.listPaged`; list route rewrite (`query`/`sort` only); update call sites (`frontend/src/lib/api.ts`, `Issues.tsx`, `AppSidebar.tsx`, `backend/tests/25`, `backend/tests/42`, `e2e/31`); parser unit tests + query protocol test.
- [x] 6. Detail reads: `/:id/events`, `/:id/stats` routes; extend `SCOPED_READ_PATHS`; scope checks; hop test 4.
- [x] 7. Frontend + cleanup: Issues page tokens/sort, sidebar count, EventDetail server reads; delete `payloadFingerprint` mirror and window-matching code; remove the consumer's envelope-parse fallback; refresh `BACKEND_API.md` §5.11 and the `AGENTS.md` landmine note; e2e 26/30 updates.
  - The event page is reached with its issue (`?issue=<id>`); the envelope-parse fallback in the consumer stays until every publisher sends digests.
- [x] 8. Optional follow-ups from the open questions above — `sort=users` landed; the dimension aggregation is held with its reason recorded above (batch 7 removed the consumer fallback).
