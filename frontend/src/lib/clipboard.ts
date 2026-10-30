/** Clipboard write helper: resolves true only after the write succeeds, so
 * callers show their transient confirmation off the result (there is no
 * global toaster in the SPA). */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
