# pinta-musecode

Pinta AI adapter for **Meta Muse Code** — forwards Muse Code lifecycle hook
events to an OTLP collector and, optionally, enforces guard decisions.

> **Status: stage 1, verified end to end against `muse 0.1.0-R708.1`.**
> Telemetry is confirmed working against a real binary. Enforcement is
> implemented but **off by default** — the deny *shape* is now known from the
> binary, but has not yet been exercised on a live tool call. See
> [Confirmed contracts](#confirmed-contracts).

Implementation plan: [🎼 Meta MuseCode 어댑터 구현 계획](https://app.notion.com/p/3b7dcc09b89a8197b782e2d5ab96d1ea)

---

## Platform support

**macOS and Linux. Both are supported; there is nothing mac-specific in `src/`.**

Windows is not a gap in this adapter — Muse Code itself has no Windows build.
Meta ships *"a native binary on your path for macOS and Linux"*, and the sandbox
exists in exactly two forms (Seatbelt on macOS, bundled bubblewrap on Linux). So
there is no host to hook on Windows, and none of the `.cmd` wrapper handling the
other Pinta adapters carry applies here.

| OS | Muse Code | Node available | Result |
| --- | --- | --- | --- |
| macOS | yes | pinta-manager bundles it | works |
| Linux | yes | **no bundled Node** — literal `node` | works **iff** system Node is present |
| Windows | no | — | not applicable |

The only platform variable is therefore the **Node runtime on Linux**, not the
adapter code. See [Linux requires Node](#-linux-requires-node).

---

## How it works

Muse Code binds a shell command to exactly one of its twelve lifecycle events.
The manager installs this adapter as a **managed hook**, which Muse Code treats
as pre-approved and runs without a trust step.

```
muse ──spawn──> node dist/index.js <EventName> ──stdin──> payload JSON
                        │
                        ├─ PreToolUse / PermissionRequest ─> POST /guard/evaluate ─> DENY? ─> stdout
                        └─ everything else ────────────────> OTLP span
```

Two properties are load-bearing and both are covered by tests:

- **Enforce before telemetry.** A DENY is written to stdout *before* any
  telemetry work, so a telemetry failure can never bubble into the top-level
  fail-open catch and silently allow a blocked tool.
- **Fail open, always.** No endpoint, a timeout, a non-200, a malformed payload,
  or an unhandled throw all resolve to ALLOW. A security gate must not be able
  to wedge the agent.

## Event coverage

All twelve documented events are routed.

| Event | Handling |
| --- | --- |
| `PreToolUse`, `PermissionRequest` | guard evaluation (+ optional deny) |
| `UserPromptSubmit` | opens a **new trace** — the per-turn boundary |
| `SessionStart`, `Stop` | observation |
| `PostToolUse` | observation |
| `SubagentStart`, `SubagentStop` | observation |
| `PreCompact`, `PostCompact` | observation |
| `PreLLMCall`, `PostLLMCall` | **skipped unless `PINTA_MUSE_LLM_EVENTS=1`** |

`PostLLMCall` is expected to fire per response chunk. `pinta-gemini` deliberately
skips the equivalent `AfterModel` for the same reason, so it is opt-in here until
the volume has actually been measured.

Unrecognised events are **not dropped** — they are forwarded as observations.
Muse Code is 0.1.x beta whose shim self-updates hourly, so parsing stays
envelope-open: known keys are validated, everything else rides through.

### Internal tool exemption

The lead agent drives its subagent team through native tools
(`subagent_spawn`, `subagent_status`, `subagent_send_message`, `subagent_cancel`,
`subagent_wait`, `subagent_read_result`). Blocking one of those does not stop a
risky action — it breaks the agent's own control loop and kills the turn. They
skip guard evaluation but are still recorded.

Only names confirmed in the official docs are exempt. **Do not add speculative
entries**: an over-broad exemption is a hole in the guard.

## Configuration

Muse Code runs hook commands with *"a cleared environment with a small
allowlist"*, so inherited process env cannot be relied on. The manager therefore
writes `~/.config/muse/pinta-musecode.env` (`KEY=VALUE` per line), which the
adapter loads before anything else reads `process.env`. This is the same
mechanism every other Pinta hook adapter uses.

`$XDG_CONFIG_HOME/muse` takes precedence over `~/.config/muse` when set.

| Variable | Meaning |
| --- | --- |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP/HTTP traces URL. Unset ⇒ telemetry silently disabled. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Extra headers, e.g. `x-pinta-relay-token=…` |
| `PINTA_GUARD_ENDPOINT` | Guard URL. Unset ⇒ guard silently disabled. |
| `PINTA_RELAY_TOKEN` | Sent as `x-pinta-relay-token` on guard calls. |
| `PINTA_GUARD_DISABLED=1` | Force-disable the guard even with an endpoint set. |
| `PINTA_MUSE_ENFORCE=1` | **Leave a DENY in effect.** Default off = shadow mode. |
| `PINTA_MUSE_DENY_FORMAT` | `json` (default) or `exit2`. See below. |
| `PINTA_MUSE_LLM_EVENTS=1` | Opt into `PreLLMCall` / `PostLLMCall`. |
| `PINTA_MUSECODE_DATA` | State dir. Default `~/.pinta/adaptors/pinta-musecode`. |

State deliberately does **not** live in the workspace: Muse Code treats `.muse`,
`.git` and `.agents` as read-only even inside an otherwise writable workspace.

### Shadow mode

Enforcement is off by default. The guard is still queried and its verdict still
rides on the span, but nothing is written back to the host. That is the plan's
staged rollout expressed in code:

> Muse Code's default approval mode catches only three dangerous commands, so
> **our DENY is the first block a user ever experiences.** One false positive and
> the hook gets deleted. Measure the false-positive rate in shadow first.

## Confirmed contracts

Verified against **`muse 0.1.0-R708.1`** on macOS by running the adapter as a
real managed hook. Anything not listed here is still inference.

### Registration

`managed_hooks_path` is a key in Muse Code's **`settings.json`**, not an
environment variable. `TBH_MANAGED_HOOKS_PATH` exists in the binary but does not
register hooks. Inline `hooks` in `settings.json` did **not** fire in testing;
only the managed file did.

The file needs all three nesting levels:

```json
{
  "schema_version": 1,
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "…" }] }
    ]
  }
}
```

> ⚠️ **A malformed or missing managed hooks file is ignored in total silence** —
> no warning, no exit code, no log. Drop the `schema_version`/`hooks` wrapper or
> the matcher-group level and every hook simply never fires. `tests/managed-hooks.test.ts`
> guards the template against exactly this, because nothing else would catch it.

Handler fields the binary accepts: `type`, `command`, `commandWindows`,
`timeout`, `statusMessage`, `env`, `async`, `shell`, `condition`/`if`, `silent`;
matcher groups also take `enabled`. Hooks may also be `transport`-based
(`url`, `headers`, `framing`) rather than command-based.

### The hook environment

Hook commands get an environment filtered to **thirteen** variables:

```
HOME LANG LOGNAME OLDPWD PATH PWD SHELL SHLVL TERM TMPDIR USER _ __CF_USER_TEXT_ENCODING
```

Consequences, all load-bearing:

- **No `PINTA_*` or `OTEL_*` shell export reaches the hook.** The env file is the
  only configuration channel that works.
- **`XDG_CONFIG_HOME` is stripped too**, so inside a hook the config dir can only
  resolve to `$HOME/.config/muse`. pinta-manager must write the env file there
  even for users who set `XDG_CONFIG_HOME`, or the adapter silently no-ops.
- **`PATH` is inherited in full**, so a bare `node` resolves fine.

### Payload

`hook_event_name` **is** present in the payload on every event, and the event
name also arrives on argv. The adapter prefers argv and falls back to the
payload.

Present on every event: `hook_event_name`, `session_id`, `cwd`, `model`,
`permission_mode`, `transcript_path` (which may be `null`; `model` may be
`"unknown"`). `turn_id` rides on everything except `SessionStart`.

| Event | Additional keys |
| --- | --- |
| `SessionStart` | `source` |
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | + `tool_response` |
| `PreLLMCall` | `attempt`, `provider`, `request_id`, `step`, `messages`, `tools`, `message_count`, `tool_count` |
| `PostLLMCall` | + `response_id`, `finish_reason`, `output_text_preview`, `status`, `error`, `tool_call_count`, `usage` |
| `SubagentStart` | `subagent_id`, `child_session_id` |
| `Stop` | `last_assistant_message`, `stop_hook_active` |

> ⚠️ **`PreLLMCall`/`PostLLMCall` carry the full `messages` array and tool
> schemas** — the entire conversation, not a preview. This is why they are
> opt-in and absent from the template.

> ⚠️ **On `SubagentStart`, `session_id` is the *child's* session id**, not the
> parent's, and no parent id is present. Correlate subagents through the trace
> file (which the adapter does) rather than through `session_id`.

### Still unconfirmed

The deny shape is known from the binary's own error strings —
`hookSpecificOutput` requires `hookEventName` (which must equal the firing
event), alongside `permissionDecision` / `permissionDecisionReason`; the binary
also accepts `additionalContext` and `updatedInput`, and `PermissionRequest`
uses a `decision` field instead. It has **not** been exercised on a live tool
call, so enforcement stays off by default and the shape stays runtime-selectable
via `PINTA_MUSE_DENY_FORMAT`.

| Format | Behaviour |
| --- | --- |
| `json` (default) | `{"hookSpecificOutput":{"hookEventName":…,"permissionDecision":"deny","permissionDecisionReason":…}}` on stdout, exit 0 |
| `exit2` | reason on stderr, exit code 2 |

Also still open:

- Host behaviour when a hook exits non-zero or times out (fail-open vs fail-closed).
- Whether the TUI and `muse exec` emit identical payload shapes.
- Hook latency and spawn cost at 16 parallel subagents.
- `timeout` units, and whether the per-hook `env` field survives the allowlist filter.

### Running the spike

`tools/` ships a harness that answers most of the above in one pass. Point Muse
Code's hooks at the capture script instead of the adapter, use Muse Code
normally, then read the report.

```bash
npx tsx tools/spike.ts hooks > ~/.config/muse/pinta-capture-hooks.json
# then add to ~/.config/muse/settings.json:
#   "managed_hooks_path": "/Users/<you>/.config/muse/pinta-capture-hooks.json"
# ... use Muse Code for a while ...
npx tsx tools/spike.ts report
```

There is no `muse hooks validate` command, and a bad file is ignored silently,
so confirm registration by checking that the capture file actually appears at
`~/.pinta/spike/capture.jsonl` after one session.

The report gives, per event: the union of payload keys, **which keys are not
always present** (the ones that silently break a transformer later), whether the
event name came from argv or the payload, parse failures, the slowest
invocation, any undocumented event the host has started emitting, and the env
keys that survived on every single capture — that last set *is* the allowlist.

`tools/capture-hook.mjs` is dependency-free plain ESM (no build step) and always
exits 0, so it cannot disturb the session it observes. Setting
`PINTA_SPIKE_DENY=<Event>` makes it emit a probe denial for that one event, which
is how the deny wire contract gets confirmed against a real session — use a
throwaway workspace, because it really does try to block.

## ⚠️ Linux requires Node

Muse Code installs as a **single native binary** and runs on macOS and Linux
only, so its users have no reason to have Node installed. pinta-manager bundles
a Node binary for macOS and Windows but **not for Linux**, where it invokes the
literal `node` token.

Those two facts collide exactly on Linux: enrollment succeeds and the hooks then
**silently never run** — a machine that looks protected and is not.

This is a runtime-availability problem, **not a portability one**: the adapter
runs on Linux perfectly well once Node is present. Until the manager ships a
Linux Node bundle or a native adapter build, the rule is simply that
**enrollment must fail loudly when Node is missing on Linux**, rather than leave
a silently unprotected machine. Run the doctor before enrolling:

```bash
npx tsx tools/doctor.ts   # exits non-zero on a blocking problem
```

## Development

```bash
npm install         # @pinta-ai/core comes from GitHub Packages (needs read:packages)
npm run typecheck
npm test
npm run build       # dist/index.js (CJS hook) + dist/index.mjs (ESM, sidecar-importable)
npm run doctor
```

`dist/index.mjs` guards its direct-exec path, so the pinta-manager sidecar can
`import()` it without reading stdin, dispatching a hook, or exiting the process.

## License

PolyForm Noncommercial 1.0.0
