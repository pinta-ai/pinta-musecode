import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guard/telemetry ordering invariant is the single most security-relevant
// behaviour in this adapter, so it is tested through the real handler with only
// its two collaborators mocked.
const evaluateGuard = vi.fn();
const emitBestEffort = vi.fn();

vi.mock("../../src/core/guard.js", () => ({ evaluateGuard }));
vi.mock("../../src/handlers/shared.js", () => ({ emitBestEffort }));

const { handleGuardEvent } = await import("../../src/handlers/guard-event.js");

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
    expect(emitBestEffort.mock.calls[0][2]).toEqual({ guard: DENY });
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
    emitBestEffort.mockImplementation(async () => {
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

  it("stringifies an object tool_input for the guard's raw text field", async () => {
    evaluateGuard.mockResolvedValue(ALLOW);
    await handleGuardEvent(
      { hook_event_name: "PreToolUse", tool_name: "bash", tool_input: { cmd: "ls" } },
      CONFIG,
    );
    expect(evaluateGuard.mock.calls[0][0].rawTextFields.toolInput).toBe('{"cmd":"ls"}');
  });

  it("never emits undefined for an absent tool_input", async () => {
    evaluateGuard.mockResolvedValue(ALLOW);
    await handleGuardEvent({ hook_event_name: "PreToolUse", tool_name: "bash" }, CONFIG);
    // JSON.stringify(undefined) is undefined, which would break the guard body.
    expect(evaluateGuard.mock.calls[0][0].rawTextFields.toolInput).toBe("");
  });
});
