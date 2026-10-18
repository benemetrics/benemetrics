# Issues — open questions & implementation order

Moved out of [`docs/issues.md`](../docs/issues.md), which describes the design. Section
references (§4, §7, …) point at that document. Nothing below changes the design; each batch
ships with `bun run typecheck` + `bun run test` green.

## Implementation status

**Implemented today**

- The Postgres projection and its transitions (§5–§6), resolve/reopen (§5.2), the one-shot `new_issue`/`regression` triggers (§10), scoped reads (§9), and the interim list/detail/patch API (§8.1).
- Grouping lives in `backend/events/utils.ts` (`issueFingerprint`/`issueTitle`/`crashFrame`); `issueFingerprint` matches rules 2–4 of §3.1 and joins explicit fingerprints as-is (no `{{ default }}` expansion/truncation yet).
- The consumer extracts digests from `envelopeItems` (no `issueEvents` on the message yet); the list endpoint's interim params are `appId`/`projectId`/`status`/`q`.

**Not yet implemented (the design)**

- The ingest-time digest (§4), the ClickHouse issue index (§7), the search query protocol (§8), the `/:id/events` + `/:id/stats` reads (§8.1), the `markSeen` message-id guard (§5.1), and the extra projection columns `culprit`/`level`/`type`/`first_release`/`last_release` (§6).

## Open questions

- [ ] Any-occurrence `level:`/`release:` semantics served by the CH index.
- [ ] `sort=users` and `user:`/`tag:` filters (need CH aggregation).
- [ ] OR groups in the grammar.
- [ ] Server-side dimension aggregation for the issue metrics panel (browser/OS/release breakdowns over the CH index).
- [ ] Release summary from the CH index (replaces the event scan in `backend/admin/releases/metrics.ts`).
- [ ] Whether `clear` should keep or drop the message-id guard semantics for `event_count` reconciliation.

## Implementation batches

- [ ] 1. Grouping module: move fingerprint/title/crash-frame to `backend/issues/grouping.ts`; add digest extraction (`extractIssueDigests(items)`); update imports (`tracking.ts`, `evaluation.ts`, `releases/metrics.ts`); unit tests.
- [ ] 2. Message digest: extend `SentryEventMessage` in `backend/nats.ts` (`issueEvents` as JSON text); attach it in both ingest routes; consumer prefers digests (envelope-parse fallback kept until batch 7); hop test 1.
- [ ] 3. PG projection: `culprit`/`level`/`type`/`first_release`/`last_release` columns via `drizzle-kit generate`; digest-driven transitions; message-id-guarded `markSeen`; DTO/protocol updates; hop test 2.
- [ ] 4. CH issue index: engine column (new installs + `ALTER`), `sentry_issue_events` with the events-table TTL + MV via `ensureView` + truncate on clear; extend the events-TTL setting to the index; occurrence/stats/release-fingerprint queries; hop test 3.
- [ ] 5. Query protocol: `backend/issues/query.ts` parser + AST; resolved filter in `issueDAO.listPaged`; list route rewrite (`query`/`sort` only); update call sites (`frontend/src/lib/api.ts`, `Issues.tsx`, `AppSidebar.tsx`, `tests/25`, `tests/42`, `e2e/31`); parser unit tests + query protocol test.
- [ ] 6. Detail reads: `/:id/events`, `/:id/stats` routes; extend `SCOPED_READ_PATHS`; scope checks; hop test 4.
- [ ] 7. Frontend + cleanup: Issues page tokens/sort, sidebar count, EventDetail server reads; delete `payloadFingerprint` mirror and window-matching code; remove the consumer's envelope-parse fallback; refresh `BACKEND_API.md` §5.11 and the `AGENTS.md` landmine note; e2e 26/30 updates.
- [ ] 8. Optional follow-ups from the open questions above.
