# sentry

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To type check:

```bash
bun check
```

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Local services

Postgres, ClickHouse, NATS (JetStream), and RustFS run through docker compose:

```bash
docker compose up -d
```

The NATS service also exposes a WebSocket listener (port 9222): the UI live
feed subscribes to `sentry.events` directly (override the URL with a
`__NATS_WS_URL__` global). Smoke-test the NATS → ClickHouse ingestion path
(ClickHouse consumes JetStream by configuration):

```bash
docker compose up -d nats clickhouse
bun scripts/smoke-ch-nats.ts
```
