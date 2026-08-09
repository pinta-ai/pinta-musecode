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

### Notes
- Enforcement is **off by default** (shadow mode). The deny wire contract is
  unconfirmed and isolated in `src/core/decision.ts`; see README "Spike-pending".
- `PreLLMCall` / `PostLLMCall` are opt-in via `PINTA_MUSE_LLM_EVENTS=1`.
