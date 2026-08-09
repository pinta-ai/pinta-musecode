import { describe, expect, it } from "vitest";
import {
  formatReport,
  parseCaptureFile,
  summarise,
  type CaptureEntry,
} from "../tools/spike-report.js";

const entry = (over: Partial<CaptureEntry> = {}): CaptureEntry => ({
  argv: ["PreToolUse"],
  payloadKeys: ["session_id", "tool_name"],
  payload: { session_id: "s1", tool_name: "bash" },
  parseError: null,
  durationMs: 5,
  env: { keys: ["PATH", "HOME"] },
  ...over,
});

describe("parseCaptureFile", () => {
  it("skips a partially written trailing line rather than throwing", () => {
    // Normal while a session is still live.
    const content = '{"argv":["Stop"]}\n{"argv":["PreTool';
    expect(parseCaptureFile(content)).toEqual([{ argv: ["Stop"] }]);
  });

  it("ignores blank lines", () => {
    expect(parseCaptureFile('\n\n{"argv":["Stop"]}\n\n')).toHaveLength(1);
  });
});

describe("summarise", () => {
  it("groups by event and unions payload keys across samples", () => {
    const r = summarise([
      entry(),
      entry({ payloadKeys: ["session_id", "tool_input"], payload: { session_id: "s1" } }),
    ]);

    expect(r.totalEntries).toBe(2);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].payloadKeys).toEqual(["session_id", "tool_input", "tool_name"]);
    // A key missing from one sample is optional in practice — the thing that
    // silently breaks a transformer later.
    expect(r.events[0].inconsistentKeys).toEqual(["tool_input", "tool_name"]);
  });

  it("counts argv vs payload as the source of the event name", () => {
    // This is the P0 question the capture exists to answer.
    const r = summarise([
      entry({ argv: ["PreToolUse"], payload: {} }),
      entry({ argv: [], payload: { hook_event_name: "PreToolUse" }, payloadKeys: [] }),
    ]);
    expect(r.events[0].nameFromArgv).toBe(1);
    expect(r.events[0].nameInPayload).toBe(1);
    expect(r.events[0].count).toBe(2);
  });

  it("resolves the event from the payload when argv carries nothing", () => {
    const r = summarise([entry({ argv: [], payload: { event: "Stop" }, payloadKeys: [] })]);
    expect(r.events[0].event).toBe("Stop");
  });

  it("buckets an unresolvable capture rather than dropping it", () => {
    const r = summarise([entry({ argv: [], payload: {}, payloadKeys: [] })]);
    expect(r.events[0].event).toBe("(unresolved)");
  });

  it("reports documented events that never fired", () => {
    const r = summarise([entry()]);
    expect(r.missingEvents).toHaveLength(11);
    expect(r.missingEvents).toContain("PostCompact");
    expect(r.missingEvents).not.toContain("PreToolUse");
  });

  it("flags an undocumented event, which means the host drifted", () => {
    const r = summarise([entry({ argv: [], payload: { hook_event_name: "BrandNewEvent" } })]);
    expect(r.unknownEvents).toEqual(["BrandNewEvent"]);
  });

  it("separates always-present env keys from sometimes-present ones", () => {
    // The always-present set is the reliable allowlist.
    const r = summarise([
      entry({ env: { keys: ["PATH", "HOME"] } }),
      entry({ env: { keys: ["PATH"] } }),
    ]);
    expect(r.envAlwaysPresent).toEqual(["PATH"]);
    expect(r.envSometimesPresent).toEqual(["HOME"]);
  });

  it("surfaces parse errors and the slowest invocation", () => {
    const r = summarise([entry({ parseError: "boom", durationMs: 42 }), entry({ durationMs: 7 })]);
    expect(r.events[0].parseErrors).toBe(1);
    expect(r.events[0].maxDurationMs).toBe(42);
  });

  it("handles an empty capture without dividing by zero", () => {
    const r = summarise([]);
    expect(r.totalEntries).toBe(0);
    expect(r.envAlwaysPresent).toEqual([]);
    expect(r.missingEvents).toHaveLength(12);
  });
});

describe("formatReport", () => {
  it("renders the answers a human is looking for", () => {
    const text = formatReport(summarise([entry()]));
    expect(text).toContain("PreToolUse  (1)");
    expect(text).toContain("name from argv     1/1");
    expect(text).toContain("events never fired:");
  });
});
