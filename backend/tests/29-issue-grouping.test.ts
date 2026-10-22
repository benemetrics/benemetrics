/**
 * Unit Test: the issue grouping protocol (pure).
 *
 * Covers the fingerprint, the title, the culprit, the level and the type
 * — the fields the issue projection stores. No database, no HTTP.
 */

import { describe, it, expect } from "bun:test";
import {
  issueFingerprint,
  issuePresentation,
  issueTitle,
} from "../issues/grouping";

function errorEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: "e1",
    message: "boom",
    ...overrides,
  };
}

function frames(...list: Array<Record<string, unknown>>): unknown {
  return { values: [{ type: "TypeError", value: "boom", stacktrace: { frames: list } }] };
}

describe("Issue grouping", () => {
  describe("fingerprint", () => {
    it("joins an explicit fingerprint with ::", () => {
      expect(
        issueFingerprint({ fingerprint: ["database-error", "checkout"] }),
      ).toBe("database-error::checkout");
    });

    it("expands {{ default }} to the default component", () => {
      const payload = errorEvent({ fingerprint: ["database-error", "{{ default }}"] });
      expect(issueFingerprint(payload)).toBe(
        `database-error::${issueFingerprint({ ...payload, fingerprint: undefined })}`,
      );
    });

    it("truncates to 500 characters", () => {
      const fingerprint = issueFingerprint({
        fingerprint: ["x".repeat(600)],
      });
      expect(fingerprint.length).toBe(500);
    });

    it("keys an exception by type, crash frame and function", () => {
      expect(
        issueFingerprint({
          exception: frames(
            { filename: "a.js", function: "first", in_app: false },
            { filename: "b.js", function: "boom", in_app: true },
          ),
        }),
      ).toBe("TypeError@b.js:boom");
    });

    it("prefers the newest in_app frame with a filename", () => {
      expect(
        issueFingerprint({
          exception: frames(
            { filename: "a.js", function: "a", in_app: true },
            { filename: "b.js", function: "b", in_app: false },
            { filename: "c.js", function: "c", in_app: true },
          ),
        }),
      ).toBe("TypeError@c.js:c");
    });

    it("falls back to the newest frame with a filename", () => {
      expect(
        issueFingerprint({
          exception: frames(
            { filename: "a.js", function: "a" },
            { filename: "b.js", function: "b" },
            { function: "no-file" },
          ),
        }),
      ).toBe("TypeError@b.js:b");
    });

    it("falls back to the last frame when none has a filename", () => {
      expect(
        issueFingerprint({
          exception: frames({ function: "only" }),
        }),
      ).toBe("TypeError@:only");
    });

    it("is unknown for an exception without frames", () => {
      expect(issueFingerprint({ exception: { values: [{ type: "Error" }] } })).toBe(
        "unknown",
      );
    });

    it("keys a message event by its text", () => {
      expect(issueFingerprint({ message: "something broke" })).toBe(
        "msg:something broke",
      );
    });

    it("is unknown without an exception or a message", () => {
      expect(issueFingerprint({})).toBe("unknown");
    });
  });

  describe("title", () => {
    it("uses the first exception's type and value", () => {
      expect(issueTitle(errorEvent({ exception: frames() }))).toBe(
        "TypeError: boom",
      );
    });

    it("falls back to the message", () => {
      expect(issueTitle({ message: "plain failure" })).toBe("plain failure");
    });

    it("falls back to the fingerprint", () => {
      expect(issueTitle({})).toBe("unknown");
    });
  });

  describe("presentation", () => {
    it("uses the event's own culprit when present", () => {
      const presentation = issuePresentation(
        errorEvent({
          culprit: "myFunction",
          exception: frames({ filename: "a.js", lineno: 7, function: "boom" }),
        }),
      );
      expect(presentation.culprit).toBe("myFunction");
    });

    it("falls back to the crash frame's filename and line", () => {
      const presentation = issuePresentation(
        errorEvent({
          exception: frames({ filename: "a.js", lineno: 7, function: "boom" }),
        }),
      );
      expect(presentation.culprit).toBe("a.js:7");
    });

    it("has no culprit without a frame", () => {
      expect(issuePresentation(errorEvent()).culprit).toBeNull();
    });

    it("normalizes the level and defaults it to error", () => {
      expect(issuePresentation(errorEvent({ level: "WARNING" })).level).toBe(
        "warning",
      );
      expect(issuePresentation(errorEvent({ level: "fatal" })).level).toBe("fatal");
      expect(issuePresentation(errorEvent()).level).toBe("error");
      expect(issuePresentation(errorEvent({ level: "nonsense" })).level).toBe(
        "error",
      );
    });

    it("types an exception event as error and a message as message", () => {
      expect(issuePresentation(errorEvent({ exception: frames() })).type).toBe(
        "error",
      );
      expect(issuePresentation(errorEvent()).type).toBe("message");
    });

    it("carries the release", () => {
      expect(issuePresentation(errorEvent({ release: "1.2.3" })).release).toBe(
        "1.2.3",
      );
      expect(issuePresentation(errorEvent()).release).toBeNull();
    });
  });
});
