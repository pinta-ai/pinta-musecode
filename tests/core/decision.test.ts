import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { denyFormat, renderDenyJson, writeDeny } from "../../src/core/decision.js";

const ORIGINAL = process.env.PINTA_MUSE_DENY_FORMAT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PINTA_MUSE_DENY_FORMAT;
  else process.env.PINTA_MUSE_DENY_FORMAT = ORIGINAL;
});

describe("denyFormat", () => {
  it("defaults to auto", () => {
    delete process.env.PINTA_MUSE_DENY_FORMAT;
    expect(denyFormat()).toBe("auto");
  });

  it("honours the exit2 override", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "exit2";
    expect(denyFormat()).toBe("exit2");
  });

  it("honours the json override", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "json";
    expect(denyFormat()).toBe("json");
  });

  it("falls back to auto for an unrecognised value", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "nonsense";
    expect(denyFormat()).toBe("auto");
  });
});

describe("renderDenyJson", () => {
  /**
   * The two families are NOT interchangeable. Measured on muse 0.1.0-R708.1:
   * sending the tool-gating shape for UserPromptSubmit was ignored and the turn
   * proceeded. Getting this wrong fails open silently.
   */
  it("uses hookSpecificOutput for tool-gating events", () => {
    expect(renderDenyJson("PreToolUse", "blocked: rm -rf")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked: rm -rf",
      },
    });
    expect(renderDenyJson("PermissionRequest", "r").hookSpecificOutput).toMatchObject({
      hookEventName: "PermissionRequest",
    });
  });

  it("uses the top-level decision object for everything else", () => {
    // The one shape actually observed blocking a live turn.
    expect(renderDenyJson("UserPromptSubmit", "secret in prompt")).toEqual({
      decision: "block",
      reason: "secret in prompt",
    });
    expect(renderDenyJson("Stop", "r")).toEqual({ decision: "block", reason: "r" });
  });
});

describe("writeDeny", () => {
  let out: string[];
  let err: string[];
  const io = () => ({ stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) });

  beforeEach(() => {
    out = [];
    err = [];
  });

  it("pairs JSON with exit 2 in auto mode, since exit 2 blocks on its own", () => {
    delete process.env.PINTA_MUSE_DENY_FORMAT;
    const outcome = writeDeny("PreToolUse", "nope", io());

    expect(outcome).toEqual({ written: true, exitCode: 2 });
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(out[0])).toEqual(renderDenyJson("PreToolUse", "nope"));
    // The reason only reaches the user through one of the two channels.
    expect(err).toEqual(["nope\n"]);
  });

  it("routes a prompt deny through the decision shape in auto mode", () => {
    delete process.env.PINTA_MUSE_DENY_FORMAT;
    writeDeny("UserPromptSubmit", "nope", io());
    expect(JSON.parse(out[0])).toEqual({ decision: "block", reason: "nope" });
  });

  it("writes JSON and exits 0 when json is forced", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "json";
    const outcome = writeDeny("PreToolUse", "nope", io());

    expect(outcome).toEqual({ written: true, exitCode: 0 });
    expect(err).toEqual([]);
    expect(JSON.parse(out[0])).toEqual(renderDenyJson("PreToolUse", "nope"));
  });

  it("writes the reason on stderr and exits 2 in exit2 mode", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "exit2";
    const outcome = writeDeny("PreToolUse", "nope", io());

    expect(outcome).toEqual({ written: true, exitCode: 2 });
    expect(out).toEqual([]);
    expect(err).toEqual(["nope\n"]);
  });
});
