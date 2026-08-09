import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { denyFormat, renderDenyJson, writeDeny } from "../../src/core/decision.js";

const ORIGINAL = process.env.PINTA_MUSE_DENY_FORMAT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PINTA_MUSE_DENY_FORMAT;
  else process.env.PINTA_MUSE_DENY_FORMAT = ORIGINAL;
});

describe("denyFormat", () => {
  it("defaults to json", () => {
    delete process.env.PINTA_MUSE_DENY_FORMAT;
    expect(denyFormat()).toBe("json");
  });

  it("honours the exit2 override", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "exit2";
    expect(denyFormat()).toBe("exit2");
  });

  it("falls back to json for an unrecognised value", () => {
    process.env.PINTA_MUSE_DENY_FORMAT = "nonsense";
    expect(denyFormat()).toBe("json");
  });
});

describe("renderDenyJson", () => {
  it("echoes the event name so the host can match the decision to its hook", () => {
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
});

describe("writeDeny", () => {
  let out: string[];
  let err: string[];
  const io = () => ({ stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) });

  beforeEach(() => {
    out = [];
    err = [];
  });

  it("writes newline-terminated JSON on stdout and exits 0 in json mode", () => {
    delete process.env.PINTA_MUSE_DENY_FORMAT;
    const outcome = writeDeny("PreToolUse", "nope", io());

    expect(outcome).toEqual({ written: true, exitCode: 0 });
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("\n")).toBe(true);
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
