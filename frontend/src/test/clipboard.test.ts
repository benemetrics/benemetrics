import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../lib/clipboard";

afterEach(() => vi.restoreAllMocks());

describe("Clipboard confirmation", () => {
  it("resolves true only after a successful write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await expect(copyToClipboard("dsn-value")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("dsn-value");
  });
  it("does not claim a failed copy succeeded", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    await expect(copyToClipboard("dsn-value")).resolves.toBe(false);
  });
});
