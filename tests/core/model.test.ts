import { describe, expect, it } from "vitest";
import { flattenEvent } from "../../src/core/otlp.js";
import { MUSE_EVENTS } from "../../src/core/types.js";
import type { BaseEvent } from "../../src/core/types.js";

function attrs(event: BaseEvent) {
  return Object.fromEntries(flattenEvent(event).map(({ key, value }) => [key, Object.values(value)[0]]));
}

describe("Muse's event-local reported model", () => {
  it.each(MUSE_EVENTS)("preserves the reported model and provenance on %s", (hook_event_name) => {
    const event = {
      hook_event_name, session_id: "session", turn_id: "turn", model: "muse-model-v1",
      provider: "meta", request_id: "request", tool_input: { command: "mysql -psecretpw" },
    };
    const actual = attrs(event);
    expect(actual["muse.model"]).toBe("muse-model-v1");
    expect(actual["muse.model_source"]).toBe("reported:model");
    expect(actual["muse.provider"]).toBe("meta");
    expect(actual["muse.turn_id"]).toBe("turn");
    expect(actual["muse.request_id"]).toBe("request");
    expect(actual["muse.tool_input"]).not.toContain("secretpw");
    expect(event.tool_input.command).toBe("mysql -psecretpw");
  });

  it.each([
    undefined, null, "", "  ", "unknown", " UNKNOWN ", "none", "n/a", "auto", "default", {}, [], 1,
    "{}", "[]", '{"id":"model"}', '["model"]', "{", "[", "{truncated", "[truncated", " \t{broken", "\n [broken",
  ])(
    "omits placeholder/non-scalar model %j and retains the raw host field", (model) => {
      const actual = attrs({ hook_event_name: "SessionStart", model });
      expect(actual["muse.model"]).toBeUndefined();
      expect(actual["muse.model_source"]).toBeUndefined();
      if (model !== null && model !== undefined) {
        expect(actual["muse.model_raw"]).toEqual(typeof model === "object" ? JSON.stringify(model) : model);
      }
    },
  );

  it("trims boundaries without rejecting brackets inside an otherwise scalar identifier", () => {
    expect(attrs({ hook_event_name: "PreLLMCall", model: "  provider/model[variant]  " })["muse.model"])
      .toBe("provider/model[variant]");
  });

  it("has no session cache to leak across turns, switches, subagents, or delayed end events", () => {
    const events: BaseEvent[] = [
      { hook_event_name: "UserPromptSubmit", session_id: "a", turn_id: "1", model: "lead-v1" },
      { hook_event_name: "PreToolUse", session_id: "b", model: "other" },
      { hook_event_name: "SubagentStart", session_id: "a", subagent_id: "child", model: "child-v1" },
      { hook_event_name: "PreToolUse", session_id: "a" },
      { hook_event_name: "UserPromptSubmit", session_id: "a", turn_id: "2", model: "lead-v2" },
      { hook_event_name: "SubagentStop", session_id: "a", turn_id: "1", model: "child-v1" },
      { hook_event_name: "Stop", session_id: "a" },
    ];
    for (const event of events) {
      expect(attrs(event)["muse.model"]).toBe(event.model);
    }
  });

  it("does not mistake a requested child model or response text for the firing event's model", () => {
    const actual = attrs({
      hook_event_name: "PreToolUse", tool_name: "subagent_spawn",
      tool_input: { model: "child-model" }, llm_response: { model: "not-a-Muse-contract" },
    });
    expect(actual["muse.model"]).toBeUndefined();
    expect(actual["muse.tool_input"]).toBe('{"model":"child-model"}');
  });
});
