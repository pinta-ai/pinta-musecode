import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guard/telemetry ordering invariant is the single most security-relevant
// behaviour in this adapter, so it is tested through the real handler with only
// its two collaborators mocked.
const evaluateGuard = vi.fn();
const emitBestEffort = vi.fn();
const sendBestEffort = vi.fn();

vi.mock("../../src/core/guard.js", () => ({ evaluateGuard }));
// The build is real (a span from the event); only the two sends are mocked.
vi.mock("../../src/handlers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/handlers/shared.js")>()),
  emitBestEffort,
  sendBestEffort,
}));

const { handleGuardEvent } = await import("../../src/handlers/guard-event.js");

/** Attributes of the single span in a sent payload, keyed by name. */
const sentAttrs = (call = 0): Record<string, unknown> =>
  Object.fromEntries(
    (sendBestEffort.mock.calls[call]?.[0] as { resourceSpans: { scopeSpans: { spans: { attributes: { key: string; value: Record<string, unknown> }[] }[] }[] }[] })
      .resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a) => [a.key, Object.values(a.value)[0]]),
  );

const CONFIG = { pluginData: "/tmp/pinta-musecode-test", tracePath: "/tmp/x/trace.json" };

const DENY = {
  decision: "DENY" as const,
  reason: "rule:destructive",
  userMessage: "Blocked by Pinta AI: destructive command",
  durationMs: 3,
};
const ALLOW = { decision: "ALLOW" as const, reason: null, userMessage: null, durationMs: 3 };

const SAVED = {
  enforce: process.env.PINTA_MUSE_ENFORCE,
  endpoint: process.env.PINTA_GUARD_ENDPOINT,
  format: process.env.PINTA_MUSE_DENY_FORMAT,
};

let stdout: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdout = [];
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  process.env.PINTA_GUARD_ENDPOINT = "http://127.0.0.1:5147/guard/evaluate";
  delete process.env.PINTA_MUSE_DENY_FORMAT;
});

afterEach(() => {
  writeSpy.mockRestore();
  for (const [k, v] of [
    ["PINTA_MUSE_ENFORCE", SAVED.enforce],
    ["PINTA_GUARD_ENDPOINT", SAVED.endpoint],
    ["PINTA_MUSE_DENY_FORMAT", SAVED.format],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("handleGuardEvent — internal tool exemption", () => {
  it("never queries the guard for the agent's own subagent control tools", async () => {
    process.env.PINTA_MUSE_ENFORCE = "1";
    const code = await handleGuardEvent(
      { hook_event_name: "PreToolUse", tool_name: "subagent_spawn", tool_input: {} },
      CONFIG,
    );

    // Blocking these would break the control loop, not a risky action.
    expect(evaluateGuard).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    expect(code).toBe(0);
    // Still recorded, so the activity stays visible.
    expect(emitBestEffort).toHaveBeenCalledOnce();
  });
});

describe("handleGuardEvent — shadow mode (default)", () => {
  it("evaluates and records a DENY but does not write it back", async () => {
    delete process.env.PINTA_MUSE_ENFORCE;
    evaluateGuard.mockResolvedValue(DENY);

    const code = await handleGuardEvent(
      { hook_event_name: "PreToolUse", tool_name: "bash", tool_input: { cmd: "rm -rf /" } },
      CONFIG,
    );

    expect(evaluateGuard).toHaveBeenCalledOnce();
    expect(stdout).toEqual([]); // nothing reaches the host
    expect(code).toBe(0);
    // The verdict still rides on the span so false positives can be measured.
    expect(sentAttrs()["pinta.guard.decision"]).toBe("deny");
    expect(sentAttrs()["pinta.guard.matched_rule"]).toBe("rule:destructive");
  });
});

describe("handleGuardEvent — enforcing", () => {
  beforeEach(() => {
    process.env.PINTA_MUSE_ENFORCE = "1";
  });

  it("writes the deny BEFORE telemetry", async () => {
    evaluateGuard.mockResolvedValue(DENY);
    const order: string[] = [];
    writeSpy.mockImplementation((chunk: unknown) => {
      order.push("stdout");
      stdout.push(String(chunk));
      return true;
    });
    sendBestEffort.mockImplementation(async () => {
      order.push("telemetry");
    });

    await handleGuardEvent(
      { hook_event_name: "PreToolUse", tool_name: "bash", tool_input: {} },
      CONFIG,
    );

    // A telemetry failure must never be able to swallow a written decision.
    expect(order).toEqual(["stdout", "telemetry"]);
  });

  it("prefers the manager's userMessage over the raw rule name", async () => {
    evaluateGuard.mockResolvedValue(DENY);
    await handleGuardEvent({ hook_event_name: "PreToolUse", tool_name: "bash" }, CONFIG);

    const payload = JSON.parse(stdout[0]);
    expect(payload.hookSpecificOutput.permissionDecisionReason).toBe(DENY.userMessage);
    expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });

  it("falls back to the rule name, then to a literal, for older managers", async () => {
    evaluateGuard.mockResolvedValue({ ...DENY, userMessage: null });
    await handleGuardEvent({ hook_event_name: "PreToolUse", tool_name: "bash" }, CONFIG);
    expect(JSON.parse(stdout[0]).hookSpecificOutput.permissionDecisionReason).toBe(
      "rule:destructive",
    );

    stdout = [];
    evaluateGuard.mockResolvedValue({ ...DENY, userMessage: null, reason: null });
    await handleGuardEvent({ hook_event_name: "PreToolUse", tool_name: "bash" }, CONFIG);
    expect(JSON.parse(stdout[0]).hookSpecificOutput.permissionDecisionReason).toBe("guard_deny");
  });

  it("echoes PermissionRequest as its own event name", async () => {
    evaluateGuard.mockResolvedValue(DENY);
    await handleGuardEvent({ hook_event_name: "PermissionRequest", tool_name: "bash" }, CONFIG);
    expect(JSON.parse(stdout[0]).hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  });

  it("stays silent on ALLOW, REVIEW, and a null guard result", async () => {
    for (const result of [ALLOW, { ...ALLOW, decision: "REVIEW" as const }, null]) {
      stdout = [];
      evaluateGuard.mockResolvedValue(result);
      const code = await handleGuardEvent(
        { hook_event_name: "PreToolUse", tool_name: "bash" },
        CONFIG,
      );
      expect(stdout).toEqual([]);
      expect(code).toBe(0);
    }
  });

  it("asks the guard about the span it then sends, with the verdict attached", async () => {
    evaluateGuard.mockResolvedValue(DENY);
    await handleGuardEvent(
      { hook_event_name: "PreToolUse", tool_name: "bash", tool_input: { cmd: "ls" } },
      CONFIG,
    );
    const judged = evaluateGuard.mock.calls[0][0];
    expect(sendBestEffort.mock.calls[0][0]).toBe(judged);
    const attrs = sentAttrs();
    expect(attrs["muse.tool_input"]).toBe('{"cmd":"ls"}');
    expect(attrs["pinta.guard.decision"]).toBe("deny");
  });
});

/**
 * The guard is asked about the span itself, so what it is told is what the
 * span carries: `cwd`, which locates a relative target — `rm -rf passwd` reads
 * as routine work until you know it was issued from /etc (PTA-176) — and the
 * hook name, which is what lets the manager trust `tool_name` (PTA-207). Both
 * used to be copied into a separate summary by hand, and were dropped there.
 */
describe("handleGuardEvent — what the guard is told about the invocation", () => {
  it("carries the working directory and the event on the span", async () => {
    process.env.PINTA_MUSE_ENFORCE = "1";
    evaluateGuard.mockResolvedValue(ALLOW);
    await handleGuardEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "rm -rf passwd" },
        cwd: "/etc",
      },
      CONFIG,
    );
    const payload = evaluateGuard.mock.calls[0]?.[0];
    const attrs = Object.fromEntries(
      payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a: { key: string; value: Record<string, unknown> }) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs).toMatchObject({ "ingest.type": "musecode", "muse.cwd": "/etc", "muse.hook": "PreToolUse", "muse.tool_name": "Bash" });
    expect("input" in payload).toBe(false);
  });
});
