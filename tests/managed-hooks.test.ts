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
 * Verified against muse 0.1.0-R708.1: all three nesting levels are load-bearing.
 * Get any of them wrong and Muse Code ignores the file without printing anything,
 * so nothing else in this repo would catch the regression.
 */
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
