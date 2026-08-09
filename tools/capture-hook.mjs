#!/usr/bin/env node
/**
 * Stage-0 spike capture hook.
 *
 * Point Muse Code's hooks at THIS file instead of the adapter, run a normal
 * session, and every hook invocation is recorded verbatim. That single capture
 * closes most of the plan's P0 unknowns at once:
 *
 *   - the stdin payload schema for each of the twelve events
 *   - whether the event name arrives on argv, in the payload, or both
 *   - what survives Muse Code's "cleared environment with a small allowlist"
 *   - hook latency and how often each event actually fires
 *
 * Deliberately dependency-free plain ESM so it can be pointed at directly with
 * no build step, and deliberately fail-open: any error here must never disturb
 * the host session being observed.
 *
 * Usage in a managed hooks file:
 *   node /abs/path/tools/capture-hook.mjs <EventName>
 *
 * Env:
 *   PINTA_SPIKE_OUT    capture file (default ~/.pinta/spike/capture.jsonl)
 *   PINTA_SPIKE_DENY   emit a probe DENY for this event, to test the wire
 *                      contract against a real session. Use a throwaway
 *                      workspace — it really does try to block.
 *   PINTA_SPIKE_DENY_FORMAT  json (default) | exit2
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const startedAt = Date.now();

function outPath() {
  return (
    process.env.PINTA_SPIKE_OUT || path.join(os.homedir(), ".pinta", "spike", "capture.jsonl")
  );
}

async function readStdin() {
  // A hook may be invoked with no stdin at all; never hang waiting for it.
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function record(entry) {
  const file = outPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Values may contain workspace paths and prompt text, so only key NAMES are
 * recorded by default — that is all the env-allowlist question needs. Set
 * PINTA_SPIKE_ENV_VALUES=1 to capture values too, on a throwaway machine.
 */
function envSnapshot() {
  const keys = Object.keys(process.env).sort();
  if (process.env.PINTA_SPIKE_ENV_VALUES !== "1") return { keys };
  return { keys, values: { ...process.env } };
}

const raw = await readStdin();
let payload = null;
let parseError = null;
try {
  payload = raw.trim().length > 0 ? JSON.parse(raw) : null;
} catch (err) {
  parseError = String(err);
}

const argv = process.argv.slice(2);
const payloadKeys =
  payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload).sort()
    : [];

try {
  record({
    capturedAt: new Date().toISOString(),
    argv,
    rawLength: raw.length,
    parseError,
    payloadKeys,
    payload,
    env: envSnapshot(),
    cwd: process.cwd(),
    durationMs: Date.now() - startedAt,
  });
} catch (err) {
  // Never let a capture failure disturb the session under observation.
  process.stderr.write(`[pinta-spike] capture failed: ${err}\n`);
}

// Optional probe: does the host actually honour a deny, and in which shape?
const probeFor = process.env.PINTA_SPIKE_DENY;
const eventName = argv[0] ?? (payload && payload.hook_event_name) ?? "";
if (probeFor && probeFor === eventName) {
  const reason = "pinta spike probe — deliberate test denial";
  if (process.env.PINTA_SPIKE_DENY_FORMAT === "exit2") {
    process.stderr.write(reason + "\n");
    process.exit(2);
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
}

process.exit(0);
