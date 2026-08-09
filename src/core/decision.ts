/**
 * The deny wire contract — deliberately isolated in one file.
 *
 * ⚠️ SPIKE-PENDING. Muse Code's public docs describe how to *register* and
 * *fixture-test* a hook (`muse hooks run <key> --fixture`), but publish no
 * schema for what a hook writes back to block an action. Until `muse hooks run`
 * has been driven against a real binary, the exact shape below is a hypothesis.
 *
 * Two things keep that safe:
 *   1. Enforcement is OFF by default (see config.ts `isEnforcing()`), so stage 1
 *      observation never writes anything to stdout at all.
 *   2. The shape is selectable at runtime via `PINTA_MUSE_DENY_FORMAT`, so the
 *      spike result can be rolled out as config before it is baked into code.
 *
 * Why this hypothesis: Muse Code's event vocabulary is a near-superset of Claude
 * Code's (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`,
 * `Stop`, `PreCompact`, `SubagentStop`), and Claude Code answers a hook decision
 * with JSON on stdout and exit 0. `exit2` covers the other common convention
 * (non-zero exit + stderr) seen in the same family of hosts.
 */

export type DenyFormat = "json" | "exit2";

export interface DenyOutcome {
  /** Whether anything was actually emitted to the host. */
  written: boolean;
  /** Exit code the hook process should terminate with. */
  exitCode: number;
}

const ALLOW_OUTCOME: DenyOutcome = { written: false, exitCode: 0 };

export function denyFormat(): DenyFormat {
  return process.env.PINTA_MUSE_DENY_FORMAT === "exit2" ? "exit2" : "json";
}

/**
 * The stdout object for a `json`-format deny. Exported so tests can assert the
 * shape without capturing stdout, and so the spike can diff it against a real
 * `muse hooks run` transcript.
 */
export function renderDenyJson(eventName: string, reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Emit a DENY back to Muse Code.
 *
 * SECURITY: callers must invoke this BEFORE any telemetry work. A telemetry
 * failure must never be able to bubble into the top-level fail-open catch and
 * silently turn a DENY into an ALLOW.
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

  if (denyFormat() === "exit2") {
    err(`${reason}\n`);
    return { written: true, exitCode: 2 };
  }
  out(JSON.stringify(renderDenyJson(eventName, reason)) + "\n");
  return { written: true, exitCode: 0 };
}

export { ALLOW_OUTCOME };
