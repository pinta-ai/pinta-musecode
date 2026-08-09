import { describe, expect, it, vi } from "vitest";
import { dispatch, parsePayload } from "../src/hook.js";

const CONFIG = { pluginData: "/tmp/pinta-musecode-test", tracePath: "/tmp/x/trace.json" };

describe("parsePayload", () => {
  it("parses a normal object body", () => {
    expect(parsePayload('{"tool_name":"bash"}')).toEqual({ tool_name: "bash" });
  });

  it("treats an empty body as an empty payload", () => {
    // `muse hooks run --fixture` explicitly allows `"stdin": {}`.
    expect(parsePayload("")).toEqual({});
    expect(parsePayload("   \n ")).toEqual({});
  });

  it("never throws on malformed or non-object bodies", () => {
    // A parse failure must not kill the hook — the event is still routed by argv.
    expect(parsePayload("not json")).toEqual({});
    expect(parsePayload("[1,2,3]")).toEqual({});
    expect(parsePayload("null")).toEqual({});
    expect(parsePayload("42")).toEqual({});
  });
});

describe("dispatch", () => {
  it("routes both pre-action events to the guard handler", async () => {
    const guard = vi.fn().mockResolvedValue(7);
    vi.doMock("../src/handlers/guard-event.js", () => ({ handleGuardEvent: guard }));
    vi.resetModules();
    const { dispatch: fresh } = await import("../src/hook.js");

    expect(await fresh({ hook_event_name: "PreToolUse" }, CONFIG)).toBe(7);
    expect(await fresh({ hook_event_name: "PermissionRequest" }, CONFIG)).toBe(7);
    expect(guard).toHaveBeenCalledTimes(2);

    vi.doUnmock("../src/handlers/guard-event.js");
    vi.resetModules();
  });

  it("skips the chatty per-LLM-call events unless explicitly enabled", async () => {
    const observe = vi.fn().mockResolvedValue(0);
    vi.doMock("../src/handlers/observe.js", () => ({
      handleObserve: observe,
      handleUserPrompt: vi.fn().mockResolvedValue(0),
      handleDefault: vi.fn().mockResolvedValue(0),
    }));
    vi.resetModules();
    const { dispatch: fresh } = await import("../src/hook.js");

    const saved = process.env.PINTA_MUSE_LLM_EVENTS;
    delete process.env.PINTA_MUSE_LLM_EVENTS;
    await fresh({ hook_event_name: "PostLLMCall" }, CONFIG);
    expect(observe).not.toHaveBeenCalled();

    process.env.PINTA_MUSE_LLM_EVENTS = "1";
    await fresh({ hook_event_name: "PostLLMCall" }, CONFIG);
    expect(observe).toHaveBeenCalledOnce();

    if (saved === undefined) delete process.env.PINTA_MUSE_LLM_EVENTS;
    else process.env.PINTA_MUSE_LLM_EVENTS = saved;
    vi.doUnmock("../src/handlers/observe.js");
    vi.resetModules();
  });

  it("routes an unrecognised future event to the observe path rather than dropping it", async () => {
    const observe = vi.fn().mockResolvedValue(0);
    vi.doMock("../src/handlers/observe.js", () => ({
      handleObserve: observe,
      handleUserPrompt: vi.fn().mockResolvedValue(0),
      handleDefault: vi.fn().mockResolvedValue(0),
    }));
    vi.resetModules();
    const { dispatch: fresh } = await import("../src/hook.js");

    await fresh({ hook_event_name: "SomeFutureEvent" }, CONFIG);
    expect(observe).toHaveBeenCalledOnce();

    vi.doUnmock("../src/handlers/observe.js");
    vi.resetModules();
  });

  it("is exported alongside parsePayload for the spike harness", () => {
    expect(typeof dispatch).toBe("function");
  });
});
