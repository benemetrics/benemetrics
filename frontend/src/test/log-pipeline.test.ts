import { describe, expect, it } from "vitest";
import {
  defaultRegex,
  fieldDefaults,
  runPipeline,
  sampleLogs,
  type PipelineConfig,
} from "../lib/log-pipeline";

const base = (parser: PipelineConfig["parser"]): PipelineConfig => ({
  parser,
  regex: defaultRegex,
  ...fieldDefaults[parser],
  minLevel: "warning",
  fingerprint: ["service", "msg"],
  dropPattern: "",
});

describe("log pipeline", () => {
  it("groups messages differing only by numbers into one issue", () => {
    const r = runPipeline(sampleLogs.json, base("json"));
    expect(r.issues.find((i) => i.title.includes("card_declined"))?.count).toBe(2);
  });
  it("drops lines below the minimum level", () => {
    expect(runPipeline(sampleLogs.json, base("json")).dropped).toBe(1);
  });
  it("parses logfmt and regex logs", () => {
    expect(runPipeline(sampleLogs.logfmt, base("logfmt")).events).toHaveLength(3);
    expect(runPipeline(sampleLogs.regex, base("regex")).events[2]?.level).toBe("fatal");
  });
  it("counts unparseable lines as failed", () => {
    expect(runPipeline("not json", base("json")).failed).toBe(1);
  });
});
