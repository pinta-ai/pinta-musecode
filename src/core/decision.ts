/**
 * The deny wire contract — deliberately isolated in one file.
 *
 * Measured against `muse 0.1.0-R708.1`, not inferred. The measurement changed
 * the design: there is no single deny shape. Blocking `UserPromptSubmit` with
 * `hookSpecificOutput.permissionDecision` was silently IGNORED and the turn ran
 * anyway; the top-level `{"decision":"block"}` blocked it. Emitting the wrong
 * family's shape therefore fails open without any error, which is exactly the
 * failure mode a security control must not have.
 *
 * What was verified on a live host, via a managed `UserPromptSubmit` hook:
 *
 *   {"decision":"block","reason":…}                        -> BLOCKED
 *   {"hookSpecificOutput":{…,"permissionDecision":"deny"}}  -> ignored, proceeded
 *   {"hookSpecificOutput":{…,"decision":"deny"}}            -> ignored, proceeded
 *   {"continue":false,"stopReason":…}                       -> ignored, proceeded
 *   exit code 2                                             -> BLOCKED
 *   exit code 1 / unparseable stdout / missing binary       -> proceeded
 *
 * So exit 2 is a universal blocking channel, and the host is otherwise
 * fail-open: a crashed adapter cannot wedge the agent, but it also cannot
 * enforce. That asymmetry is why stage 3 needs bypass visibility.
 *
 * The tool-side shape (`PreToolUse` / `PermissionRequest`) could NOT be
 * exercised — the account hit a billing error before any tool call. It is taken
 * from the binary's own validation strings, which require `hookSpecificOutput`
 * to carry a `hookEventName` matching the firing event alongside
 * `permissionDecision` / `permissionDecisionReason`, and which mention
 * "pre-tool hook blocked tool use" and "permission hook denied tool use".
 * Treat it as strong evidence, not measurement.
 */
import { isGuardEvent } from "./types.js";

export type DenyFormat = "auto" | "json" | "exit2";

export interface DenyOutcome {
  /** Whether anything was actually emitted to the host. */
  written: boolean;
  /** Exit code the hook process should terminate with. */
  exitCode: number;
}

const ALLOW_OUTCOME: DenyOutcome = { written: false, exitCode: 0 };

/**
 * `auto` (default) picks the shape from the event family. `exit2` forces the
 * universal channel, which is the safe escape hatch if a host update ever
 * changes the JSON shapes again.
 */
export function denyFormat(): DenyFormat {
  const raw = process.env.PINTA_MUSE_DENY_FORMAT;
  if (raw === "exit2" || raw === "json") return raw;
  return "auto";
}

/**
 * Tool-gating events answer with `hookSpecificOutput`; everything else answers
 * with the top-level `decision` object. Verified for the latter, evidenced for
 * the former — see the module comment.
 */
export function renderDenyJson(eventName: string, reason: string): Record<string, unknown> {
  if (isGuardEvent(eventName)) {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  }
  return { decision: "block", reason };
}

/**
 * Emit a DENY back to Muse Code.
 *
 * SECURITY: callers must invoke this BEFORE any telemetry work. A telemetry
 * failure must never be able to bubble into the top-level fail-open catch and
 * silently turn a DENY into an ALLOW.
 *
 * In `auto` mode the JSON is written AND the process exits 2. The two channels
 * are independent — exit 2 blocks on its own — so pairing them means a deny
 * still lands if the JSON shape is ever rejected. The reason text only reaches
 * the user through the JSON, hence writing both rather than picking one.
 *
 * `stdout`/`stderr` are injectable purely so tests do not have to hijack the
 * real process streams.
 */
export function writeDeny(
  eventName: string,
  reason: string,
  io: { stdout?: (s: string) => void; stderr?: (s: string) => void } = {},
): DenyOutcome {
  const out = io.stdout ?? ((s: string) => process.stdout.write(s));
  const err = io.stderr ?? ((s: string) => process.stderr.write(s));
  const format = denyFormat();

  if (format === "exit2") {
    err(`${reason}\n`);
    return { written: true, exitCode: 2 };
  }

  out(JSON.stringify(renderDenyJson(eventName, reason)) + "\n");

  if (format === "json") {
    return { written: true, exitCode: 0 };
  }

  err(`${reason}\n`);
  return { written: true, exitCode: 2 };
}

export { ALLOW_OUTCOME };
