import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MUSE_EVENTS } from "../src/core/types.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template = JSON.parse(
  fs.readFileSync(path.join(root, "hooks", "managed-hooks.template.json"), "utf-8"),
) as Record<string, any>;

/**
 * Verified one variant at a time against muse 0.1.0-R708.1. Two things are
 * load-bearing and neither of them announces itself when you get it wrong:
 *
 *   - the `hooks` wrapper and the matcher-GROUP level are mandatory. Hoisting
 *     events to the top level, or listing handlers straight under an event,
 *     silently disables the file.
 *   - group and handler objects are deserialized strictly. One unknown key and
 *     the entire event is skipped, again silently. `env` and `shell` are NOT
 *     accepted keys, however plausible they look.
 *
 * "Silently" is the whole reason this file has tests: no error, no exit code and
 * no log line, so nothing else in this repo could catch the regression.
 */
const ACCEPTED_HANDLER_KEYS = new Set([
  "type",
  "command",
  "commandWindows",
  "timeout",
  "statusMessage",
  "silent",
  "async",
]);
const ACCEPTED_GROUP_KEYS = new Set(["matcher", "hooks"]);

describe("managed hooks template", () => {
  it("carries the schema_version + hooks wrapper", () => {
    expect(template.schema_version).toBe(1);
    expect(typeof template.hooks).toBe("object");
  });

  it("maps every event to an array of matcher groups, not straight to handlers", () => {
    for (const [event, groups] of Object.entries(template.hooks)) {
      expect(Array.isArray(groups), `${event} must be an array`).toBe(true);
      for (const group of groups as any[]) {
        expect(typeof group.matcher, `${event} needs a string matcher`).toBe("string");
        expect(Array.isArray(group.hooks), `${event} group needs a hooks array`).toBe(true);
        for (const handler of group.hooks) {
          expect(handler.type).toBe("command");
          expect(handler.command).toContain("${PINTA_MUSECODE_ROOT}");
          // argv-first event resolution — see resolveEventName().
          expect(handler.command.endsWith(` ${event}`), `${event} argv suffix`).toBe(true);
        }
      }
    }
  });

  it("uses no key the host would reject, which it would do without saying so", () => {
    for (const [event, groups] of Object.entries(template.hooks)) {
      for (const group of groups as any[]) {
        for (const key of Object.keys(group)) {
          expect(ACCEPTED_GROUP_KEYS.has(key), `${event}: group key "${key}" is rejected`).toBe(
            true,
          );
        }
        for (const handler of group.hooks) {
          for (const key of Object.keys(handler)) {
            expect(
              ACCEPTED_HANDLER_KEYS.has(key),
              `${event}: handler key "${key}" is rejected`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("never tries to pass configuration through a handler env block", () => {
    // The host drops the key and skips the event. src/env-file.ts is the only route.
    const serialized = JSON.stringify(template.hooks);
    expect(serialized).not.toContain('"env"');
  });

  it("registers every known event except the opt-in LLM pair", () => {
    const registered = Object.keys(template.hooks);
    const expected = MUSE_EVENTS.filter((e) => e !== "PreLLMCall" && e !== "PostLLMCall");
    expect(registered.sort()).toEqual([...expected].sort());
  });

  it("keeps the LLM events out, since they carry the full messages array", () => {
    expect(template.hooks.PreLLMCall).toBeUndefined();
    expect(template.hooks.PostLLMCall).toBeUndefined();
  });
});
