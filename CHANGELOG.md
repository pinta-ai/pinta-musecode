# Changelog

## 0.1.0 (unreleased)

Initial scaffold — stage 1 (observation) of the MuseCode adapter plan.

### Added
- Hook dispatch for all twelve Muse Code lifecycle events, with event-name
  resolution from **both** argv and the stdin payload (argv wins).
- OTLP export with the `musecode` ingest discriminator and `muse.*` attributes,
  reusing `@pinta-ai/core` for redaction, transport, retry queue, and traces.
- Per-turn trace rotation on `UserPromptSubmit`.
- Guard evaluation on `PreToolUse` and `PermissionRequest`, with the
  enforce-before-telemetry ordering invariant covered by tests.
- Exemption for the six documented subagent control tools.
- `tools/doctor.ts` — environment preflight; fails on Linux without Node.
- `tools/capture-hook.mjs` + `tools/spike.ts` — stage-0 spike harness that
  captures real hook invocations and reports payload shapes, event-name source,
  undocumented events, and the surviving env allowlist.

### Verified

Stage 0 was executed against **`muse 0.1.0-R708.1`**. The adapter ran as a real
managed hook and emitted OTLP spans end to end. See README §Confirmed contracts.
Notable corrections this produced:

- The managed hooks file needs a `schema_version` + `hooks` wrapper **and** a
  matcher-group level; the previous template had neither and would have been
  ignored silently. Now guarded by `tests/managed-hooks.test.ts`.
- `managed_hooks_path` is a `settings.json` key, not an environment variable.
- The hook environment is filtered to 13 variables, confirming the env file as
  the only usable config channel — and revealing that `XDG_CONFIG_HOME` is
  stripped, so the env file must be written under `$HOME/.config/muse/`.
- `PreLLMCall`/`PostLLMCall` carry the full `messages` array, which justifies
  keeping them opt-in.
- `SubagentStart` reports the child's `session_id`, not the parent's.
- The six subagent control tool names in `INTERNAL_TOOLS` are confirmed exactly
  as listed, including `subagent_status`.

### Fixed

- **The deny contract was wrong.** `hookSpecificOutput.permissionDecision` is
  ignored for `UserPromptSubmit` — the turn just proceeds. The working shape is
  the top-level `{"decision":"block","reason":…}`. `renderDenyJson()` now
  branches on the event family, and `PINTA_MUSE_DENY_FORMAT` defaults to `auto`,
  pairing the JSON with exit 2 (measured to block on its own).
  Verified end to end: the adapter's own output cancelled a live turn.
- Ruled out Muse Code's native OTLP export as a cheaper telemetry path — it
  refuses to send to a non-Meta destination by design.

### Notes
- Enforcement is **off by default** (shadow mode). The deny wire contract is
  unconfirmed and isolated in `src/core/decision.ts`; see README "Spike-pending".
- `PreLLMCall` / `PostLLMCall` are opt-in via `PINTA_MUSE_LLM_EVENTS=1`.
