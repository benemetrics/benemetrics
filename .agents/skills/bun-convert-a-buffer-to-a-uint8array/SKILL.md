---
name: Bun Convert a Buffer to a Uint8Array
description: Convert a Buffer to a Uint8Array
---

# Convert a Buffer to a Uint8Array

The Node.js [`Buffer`](https://nodejs.org/api/buffer.html) class extends [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), so no conversion is needed. All properties and methods on `Uint8Array` are available on `Buffer`.

```ts  theme={"theme":{"light":"github-light","dark":"dracula"}}
const buf = Buffer.alloc(64);
buf instanceof Uint8Array; // => true
```

***

See [Docs > API > Binary Data](/runtime/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
