import { isEnforcing, type PintaConfig } from "../core/config.js";
import type { ToolEvent } from "../core/types.js";
import { isInternalTool } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { writeDeny } from "../core/decision.js";
import { emitBestEffort } from "./shared.js";

/**
 * Handles both pre-action events: `PreToolUse` (fires for every tool) and
 * `PermissionRequest` (fires only where the host would prompt a human). They
 * share this path because both can block and both carry a tool payload.
 *
 * Ordering is load-bearing:
 *   1. exempt internal control tools,
 *   2. ask the guard,
 *   3. write the DENY,
 *   4. only then emit telemetry.
 */
export async function handleGuardEvent(
  event: ToolEvent,
  config: PintaConfig,
): Promise<number> {
  // Blocking the agent's own subagent-control tools does not stop a risky
  // action — it breaks the control loop and kills the turn. Exempt, but still
  // record so the activity remains visible.
  if (isInternalTool(event.tool_name)) {
    await emitBestEffort(event, config);
    return 0;
  }

  const rawToolInput =
    typeof event.tool_input === "string" ? event.tool_input : JSON.stringify(event.tool_input);
  const guard = await evaluateGuard(
    {
      spanId: event.session_id ?? "unknown",
      toolName: event.tool_name,
      method: event.hook_event_name,
      cwd: event.cwd,
      toolInput: event.tool_input,
      rawTextFields: { toolInput: rawToolInput ?? "" },
    },
    process.env.PINTA_GUARD_ENDPOINT,
  );

  let exitCode = 0;

  // SECURITY: the decision is written BEFORE telemetry so a later telemetry
  // failure can never bubble to runHook's fail-open catch and silently allow a
  // tool the guard blocked.
  if (guard?.decision === "DENY" && isEnforcing()) {
    // Prefer the manager-supplied userMessage (it carries the branded text plus
    // the rule that fired); fall back to the raw rule name, then to a literal.
    const reason = guard.userMessage ?? guard.reason ?? "guard_deny";
    exitCode = writeDeny(event.hook_event_name, reason).exitCode;
  }

  await emitBestEffort(event, config, { guard });
  return exitCode;
}
