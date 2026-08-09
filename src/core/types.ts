// --- Muse Code hook event types ---
//
// Muse Code exposes exactly twelve lifecycle events (dev.meta.ai/docs/muse-code/extending
// §hook-events). A hook binds to exactly ONE event, and `muse hooks run --fixture`
// takes `{ "event": "<Name>", "stdin": { ... } }` — the hook process receives only
// the `stdin` object. The event name therefore may NOT be present in the payload,
// which is why resolveEventName() also accepts it from argv.
//
// Everything here is deliberately envelope-open: we validate the keys we know and
// pass the rest through untouched. Muse Code is 0.1.x beta and its shim self-updates
// hourly, so an unrecognised key must never drop an event.

export const MUSE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreLLMCall",
  "PostLLMCall",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type MuseEventName = (typeof MUSE_EVENTS)[number];

const MUSE_EVENT_SET: ReadonlySet<string> = new Set(MUSE_EVENTS);

export function isKnownEventName(name: string): name is MuseEventName {
  return MUSE_EVENT_SET.has(name);
}

export interface BaseEvent {
  /**
   * Canonical event name. Synthesised by resolveEventName() rather than trusted
   * from the payload, because Muse Code may not put it there at all.
   */
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  // Every other host-supplied field rides through via flattening.
  [key: string]: unknown;
}

export interface ToolEvent extends BaseEvent {
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
}

export interface PostToolUseEvent extends ToolEvent {
  tool_response?: unknown;
  error?: string;
}

export interface UserPromptSubmitEvent extends BaseEvent {
  prompt?: string;
}

export interface SubagentEvent extends BaseEvent {
  agent_id?: string;
  agent_type?: string;
}

// --- Event-name resolution -------------------------------------------------

/**
 * Candidate payload keys that might carry the event name, most specific first.
 * `hook_event_name` mirrors Claude Code, `event`/`hook` mirror the fixture and
 * `muse hooks list` vocabulary. None is confirmed — see the README section
 * "Still unconfirmed"; `npm run spike:report` prints which key each event
 * actually used.
 */
const NAME_KEYS = ["hook_event_name", "event", "hook", "hook_event", "eventName"] as const;

/**
 * Resolve which lifecycle event fired.
 *
 * Precedence is argv-first on purpose: a hook binds to exactly one event, so the
 * command line is the only source that cannot be wrong. A payload field, if the
 * host does supply one, is a fallback for hosts (or fixtures) invoked without an
 * explicit argument.
 *
 * Returns null when neither source yields a usable name — the caller then routes
 * to the default handler rather than guessing.
 */
export function resolveEventName(
  argv: readonly string[],
  payload: Record<string, unknown>,
): string | null {
  for (const arg of argv) {
    // Accept both `PreToolUse` and `--event=PreToolUse`.
    const bare = arg.startsWith("--event=") ? arg.slice("--event=".length) : arg;
    if (isKnownEventName(bare)) return bare;
  }
  for (const key of NAME_KEYS) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// --- Routing groups --------------------------------------------------------

/**
 * Events that carry a guard decision. Both are pre-action, so both can block.
 * `PreToolUse` fires for every tool; `PermissionRequest` fires only when the
 * host would otherwise prompt a human.
 */
export function isGuardEvent(name: string): boolean {
  return name === "PreToolUse" || name === "PermissionRequest";
}

export function isSubagentEvent(name: string): boolean {
  return name === "SubagentStart" || name === "SubagentStop";
}

export function isCompactEvent(name: string): boolean {
  return name === "PreCompact" || name === "PostCompact";
}

/**
 * Per-LLM-call events. `PostLLMCall` in particular is expected to fire per
 * response chunk, which is why it is opt-in — pinta-gemini deliberately skips
 * the equivalent `AfterModel` for the same reason. Enable with
 * `PINTA_MUSE_LLM_EVENTS=1` once the volume has actually been measured.
 */
export function isLlmCallEvent(name: string): boolean {
  return name === "PreLLMCall" || name === "PostLLMCall";
}

/**
 * Native tools the lead agent uses to drive its own subagent team
 * (dev.meta.ai/docs/muse-code/extending §multi-agent). Blocking one of these
 * does not stop a risky action — it breaks the agent's own control loop and
 * kills the turn. They are exempt from guard evaluation.
 *
 * Only names confirmed in the official docs are listed. Do NOT add speculative
 * entries: an over-broad exemption is a hole in the guard.
 */
export const INTERNAL_TOOLS: ReadonlySet<string> = new Set([
  "subagent_spawn",
  "subagent_status",
  "subagent_send_message",
  "subagent_cancel",
  "subagent_wait",
  "subagent_read_result",
]);

export function isInternalTool(toolName: string | undefined): boolean {
  return toolName !== undefined && INTERNAL_TOOLS.has(toolName);
}
