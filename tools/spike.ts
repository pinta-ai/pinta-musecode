/**
 * Stage-0 spike driver.
 *
 *   npx tsx tools/spike.ts hooks    # emit a managed-hooks file pointing at the capture hook
 *   npx tsx tools/spike.ts report   # summarise what has been captured so far
 *
 * The point of stage 0 is not to write shippable code — it is to delete the
 * plan's P0 unknown list. Run `hooks`, install the emitted file as Muse Code's
 * managed hooks, use Muse Code normally for a while, then run `report`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MUSE_EVENTS } from "../src/core/types.js";
import { formatReport, parseCaptureFile, summarise } from "./spike-report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const captureHook = path.join(here, "capture-hook.mjs");

function capturePath(): string {
  return (
    process.env.PINTA_SPIKE_OUT || path.join(os.homedir(), ".pinta", "spike", "capture.jsonl")
  );
}

function emitHooks(): void {
  // Every event, including the chatty LLM pair — measuring their volume is one
  // of the things stage 0 exists to do.
  const hooks: Record<string, unknown> = {};
  for (const event of MUSE_EVENTS) {
    hooks[event] = [{ type: "command", command: `node ${captureHook} ${event}` }];
  }
  const doc = {
    _note:
      "Stage-0 capture hooks. The outer schema is spike-pending — verify with `muse hooks validate`. Managed hooks run pre-approved, without a trust step.",
    _capture: capturePath(),
    hooks,
  };
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
}

function report(): void {
  const file = capturePath();
  if (!fs.existsSync(file)) {
    process.stderr.write(
      `no capture file at ${file}\n` +
        "Run `npx tsx tools/spike.ts hooks`, install it as Muse Code's managed hooks, then use Muse Code.\n",
    );
    process.exit(1);
  }
  const entries = parseCaptureFile(fs.readFileSync(file, "utf-8"));
  process.stdout.write(formatReport(summarise(entries)) + "\n");
}

const cmd = process.argv[2];
if (cmd === "hooks") {
  emitHooks();
} else if (cmd === "report") {
  report();
} else {
  process.stderr.write("usage: tsx tools/spike.ts <hooks|report>\n");
  process.exit(2);
}
