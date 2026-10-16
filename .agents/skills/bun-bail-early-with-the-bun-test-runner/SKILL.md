---
name: Bun Bail early with the Bun test runner
description: Bail early with the Bun test runner
---

# Bail early with the Bun test runner

Use the `--bail` flag to bail on a test run after a single failure. This is useful for aborting as soon as possible in a continuous integration environment.

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun test --bail
```

***

To bail after a certain threshold of failures, optionally specify a number after the flag.

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
# bail after 10 failures
bun test --bail=10
```

***

See [Docs > Test runner](/test) for complete documentation of `bun test`.
