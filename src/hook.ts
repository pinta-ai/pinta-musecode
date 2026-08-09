/**
 * Shared hook dispatch: argv + stdin -> event -> handler -> exit code.
 *
 * Factored out so both build targets share one implementation:
 *   - dist/index.js  (CJS, from src/index.ts)  — always direct-exec.
 *   - dist/index.mjs (ESM, from src/index.mts) — direct-exec guarded, so the
 *     pinta-manager sidecar can import() it without running a hook.
 *
 * `runHook()` deliberately does NOT call process.exit() — each entry point owns
 * exiting with the returned code.
 */
import { llmEventsEnabled, loadConfig } from "./core/config.js";
import { isGuardEvent, isLlmCallEvent, resolveEventName } from "./core/types.js";
import type { BaseEvent } from "./core/types.js";
import { handleGuardEvent } from "./handlers/guard-event.js";
import { handleDefault, handleObserve, handleUserPrompt } from "./handlers/observe.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Muse Code may hand the hook an empty stdin (its fixture format allows
 * `"stdin": {}`), so an unparseable or empty body is normal, not an error.
 */
export function parsePayload(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through — an opaque body still deserves a routed, named event
  }
  return {};
}

export async function dispatch(
  event: BaseEvent,
  config: ReturnType<typeof loadConfig>,
): Promise<number> {
  const name = event.hook_event_name;

  if (isGuardEvent(name)) {
    return handleGuardEvent(event, config);
  }
  if (name === "UserPromptSubmit") {
    return handleUserPrompt(event, config);
  }
  if (isLlmCallEvent(name) && !llmEventsEnabled()) {
    // Opt-in only: PostLLMCall is expected to fire per response chunk.
    return handleDefault(event);
  }
  return handleObserve(event, config);
}

export async function runHook(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let exitCode = 0;

  try {
    const config = loadConfig();
    const payload = parsePayload(await readStdin());
    const name = resolveEventName(argv, payload);

    if (name === null) {
      // Neither argv nor payload named the event. Guessing here could route a
      // blocking event to an observational handler, so stay silent instead.
      process.stderr.write("[pinta-musecode] could not resolve hook event name; skipping\n");
      return 0;
    }

    const event: BaseEvent = { ...payload, hook_event_name: name };
    exitCode = await dispatch(event, config);
  } catch (err) {
    process.stderr.write(`[pinta-musecode] error: ${err}\n`);
    exitCode = 0; // top-level catch-all stays fail-open
  }

  return exitCode;
}
