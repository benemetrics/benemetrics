// Boot-time initialization retries: the services (NATS, ClickHouse) are
// required, so a slow start is retried a few times and a persistent
// failure is fatal — the server never runs half-wired.
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 1000;

export async function retryInit(
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  const attempts = Number(process.env.INIT_RETRY_ATTEMPTS) || DEFAULT_ATTEMPTS;
  const delayMs = Number(process.env.INIT_RETRY_DELAY_MS) || DEFAULT_DELAY_MS;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[init] ${label} attempt ${attempt}/${attempts} failed: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
