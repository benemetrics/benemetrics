---
name: Bun Convert a ReadableStream to JSON
description: Convert a ReadableStream to JSON
---

# Convert a ReadableStream to JSON

Bun provides a number of convenience functions for reading the contents of a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) into different formats.

```ts  theme={"theme":{"light":"github-light","dark":"dracula"}}
const stream = new ReadableStream();
const json = await stream.json();
```

***

See [Docs > API > Utils](/runtime/utils#bun-readablestreamto) for documentation on Bun's other `ReadableStream` conversion functions.
