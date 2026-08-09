import { describe, expect, it } from "vitest";
import {
  INTERNAL_TOOLS,
  MUSE_EVENTS,
  isGuardEvent,
  isInternalTool,
  isKnownEventName,
  isLlmCallEvent,
  resolveEventName,
} from "../../src/core/types.js";

describe("MUSE_EVENTS", () => {
  it("covers exactly the twelve documented lifecycle events", () => {
    expect(MUSE_EVENTS).toHaveLength(12);
    expect([...MUSE_EVENTS].sort()).toEqual(
      [
        "PostCompact",
        "PostLLMCall",
        "PostToolUse",
        "PreCompact",
        "PreLLMCall",
        "PreToolUse",
        "PermissionRequest",
        "SessionStart",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "UserPromptSubmit",
      ].sort(),
    );
  });

  it("rejects names from other hosts", () => {
    expect(isKnownEventName("PreToolUse")).toBe(true);
    // Claude Code events that Muse Code does not have
    expect(isKnownEventName("SessionEnd")).toBe(false);
    expect(isKnownEventName("PostToolUseFailure")).toBe(false);
    expect(isKnownEventName("Notification")).toBe(false);
  });
});

describe("resolveEventName", () => {
  it("prefers argv, which is the only source that cannot be wrong", () => {
    // A hook binds to exactly one event, so a conflicting payload loses.
    expect(resolveEventName(["PreToolUse"], { hook_event_name: "Stop" })).toBe("PreToolUse");
  });

  it("accepts the --event= form", () => {
    expect(resolveEventName(["--event=PostToolUse"], {})).toBe("PostToolUse");
  });

  it("ignores argv entries that are not event names", () => {
    expect(resolveEventName(["--verbose", "/path/to/thing"], {})).toBeNull();
  });

  it("falls back to payload keys in priority order", () => {
    expect(resolveEventName([], { hook_event_name: "Stop" })).toBe("Stop");
    expect(resolveEventName([], { event: "SessionStart" })).toBe("SessionStart");
    expect(resolveEventName([], { hook: "PreCompact" })).toBe("PreCompact");
    expect(resolveEventName([], { eventName: "SubagentStop" })).toBe("SubagentStop");
  });

  it("passes through an unknown payload name so a new host event is still routed", () => {
    // Envelope-open: Muse Code is 0.1.x beta and self-updates hourly.
    expect(resolveEventName([], { hook_event_name: "SomeFutureEvent" })).toBe("SomeFutureEvent");
  });

  it("returns null when neither source names the event", () => {
    expect(resolveEventName([], {})).toBeNull();
    expect(resolveEventName([], { hook_event_name: "" })).toBeNull();
    expect(resolveEventName([], { hook_event_name: 42 })).toBeNull();
  });
});

describe("routing groups", () => {
  it("treats both pre-action events as guard events", () => {
    expect(isGuardEvent("PreToolUse")).toBe(true);
    expect(isGuardEvent("PermissionRequest")).toBe(true);
    // PostToolUse is after the fact — it cannot block.
    expect(isGuardEvent("PostToolUse")).toBe(false);
  });

  it("classifies the opt-in per-LLM-call pair", () => {
    expect(isLlmCallEvent("PreLLMCall")).toBe(true);
    expect(isLlmCallEvent("PostLLMCall")).toBe(true);
    expect(isLlmCallEvent("PreToolUse")).toBe(false);
  });
});

describe("INTERNAL_TOOLS", () => {
  it("exempts every documented subagent control tool", () => {
    for (const name of [
      "subagent_spawn",
      "subagent_status",
      "subagent_send_message",
      "subagent_cancel",
      "subagent_wait",
      "subagent_read_result",
    ]) {
      expect(isInternalTool(name)).toBe(true);
    }
  });

  it("does not exempt anything else", () => {
    expect(INTERNAL_TOOLS.size).toBe(6);
    expect(isInternalTool("bash")).toBe(false);
    expect(isInternalTool("read_skill")).toBe(false); // unconfirmed — must not be exempt
    expect(isInternalTool(undefined)).toBe(false);
  });
});
