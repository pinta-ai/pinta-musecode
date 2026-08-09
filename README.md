# pinta-musecode

Pinta AI adapter for **Meta Muse Code** — forwards Muse Code lifecycle hook
events to an OTLP collector and, optionally, enforces guard decisions.

> **Status: stage 1, verified end to end against `muse 0.1.0-R708.1`.**
> Telemetry and blocking are both confirmed against a real binary — the
> adapter's own deny output cancelled a live turn. Enforcement is still **off by
> default**, because the *tool-side* deny shape could not be exercised (the test
> account hit a billing error before any tool call) and because stage 2 wants
> false-positive data first. See [Confirmed contracts](#confirmed-contracts).

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
| `PINTA_MUSE_DENY_FORMAT` | `auto` (default), `json`, or `exit2`. See below. |
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

The file needs the `hooks` wrapper and the matcher-**group** level. Each was
tested on its own, holding everything else constant:

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

| Variant | Result |
| --- | --- |
| As above | fires |
| Handlers listed straight under the event name | **never fires** |
| Event names hoisted to the top level, no `hooks` wrapper | **never fires** |
| `schema_version` omitted | fires — it is optional |
| `matcher` omitted | fires — it is optional |

> ⚠️ **A malformed or missing managed hooks file is ignored in total silence** —
> no warning, no exit code, no log. `tests/managed-hooks.test.ts` guards the
> template against exactly this, because nothing else would catch it.

Worse, group and handler objects are **deserialized strictly, and a rejection is
also silent**. One unrecognised key and the whole event is skipped while the rest
of the file keeps working — so a typo removes monitoring from one event and
leaves the adapter looking healthy:

| Handler key | |
| --- | --- |
| `type` `command` `commandWindows` `timeout` `statusMessage` `silent` `async` | accepted |
| **`env`** | **rejected — event skipped** |
| `shell` | rejected — event skipped |
| `enabled` on a matcher group | rejected — event skipped |
| any unknown key | rejected — event skipped |

Unknown keys at the *top* level are tolerated, which is why the template can
carry `_note`-style documentation.

`timeout` is in **seconds**: a hook sleeping 3s under `timeout: 1` was killed at
~1s wall.

The rejected `env` key is the reason configuration goes through an env file.
The binary's strings advertise it, but there is no working in-file way to pass a
variable to a hook.

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

### Deny contract — measured

There is **no single deny shape**, and the plan's warning not to assume one was
right. Verified with a live managed `UserPromptSubmit` hook:

| Hook output | Result |
| --- | --- |
| `{"decision":"block","reason":…}` | **BLOCKED** |
| `{"hookSpecificOutput":{…,"permissionDecision":"deny"}}` | ignored, turn proceeded |
| `{"hookSpecificOutput":{…,"decision":"deny"}}` | ignored, turn proceeded |
| `{"continue":false,"stopReason":…}` | ignored, turn proceeded |
| exit code **2** | **BLOCKED** |
| exit code 1 | proceeded |
| unparseable stdout | proceeded |
| missing hook binary | proceeded |

So the host is **fail-open on everything except exit 2**. A crashed adapter
cannot wedge the agent — but it also cannot enforce, which is why stage 3 needs
bypass visibility rather than trusting the hook to always run.

`PINTA_MUSE_DENY_FORMAT` now defaults to `auto`, which picks the shape by event
family and pairs it with exit 2 (the two channels are independent, so a deny
still lands even if a host update rejects the JSON). `json` and `exit2` force a
single channel.

> ⚠️ Sending the wrong family's shape is **ignored silently** — no error, turn
> proceeds. A security control that fails open without saying so is the worst
> case, so `renderDenyJson()` branches on the event and
> `tests/core/decision.test.ts` pins both branches.

The tool-side shape (`PreToolUse` / `PermissionRequest`) could **not** be
exercised — the account hit `402 billing_error` before any tool call. It comes
from the binary's own validation strings, which require `hookSpecificOutput` to
carry a `hookEventName` matching the firing event alongside `permissionDecision`
/ `permissionDecisionReason`, and which mention "pre-tool hook blocked tool use"
and "permission hook denied tool use". Strong evidence, not measurement.

### Native OTLP is not an alternative

Muse Code ships its own OTLP telemetry, so "just point Muse Code at our
collector and skip the hooks" looks attractive. It does not work. `telemetry.destination`
is an enum (`legacy` | `consolidated` | `edge` | `external`), not a URL, and:

- `external` + `OTEL_EXPORTER_OTLP_ENDPOINT` at our own host → **export DISABLED**;
  the binary detects the non-baseline destination and withholds the bearer
  credential on purpose.
- `edge` / `consolidated` → internal-network destinations, **not available in
  public builds**.

The hook adapter is therefore the only viable telemetry path, not merely the
chosen one.

### Cost

Measured on an 18-core M-series Mac, `--provider echo`, adapter built to `dist/`:

| | |
| --- | --- |
| Hook invocations on a trivial turn | **5** — `SessionStart`, `UserPromptSubmit`, `SubagentStart` ×2, `Stop` |
| One adapter invocation, cold | **~45 ms** (p50 44, max 49) — dominated by Node start-up |
| Turn wall-clock, no hooks → 5 hooks | 0.28 s → 0.47 s |
| 16 concurrent invocations | **123 ms wall** (7.7 ms/hook amortised) |

Hooks for different subagents run **in parallel**, not serially: two
`SubagentStart` handlers each sleeping 1s cost 1.5s of wall clock, not 2.5s. So
the 16-subagent case is bounded by the slowest hook rather than by their sum.

Two things follow. Node start-up is essentially the entire per-hook cost, which
is the strongest argument for a native build if `PreToolUse` is ever enabled on
a hot loop. And `SubagentStart` fires twice even on a turn that does nothing —
subagent traffic is the volume driver here, not tool calls.

### The session log is a viable backstop

`~/.local/share/muse/sessions/YYYY/MM/DD/<session-id>/session.jsonl`, with
subagents nested underneath as `subagent/<child-id>/session.jsonl`. Every line is
a JSON envelope (`record_type: "event"`, plus `sequence`, `recorded_at`,
`payload_type`). Surveyed 73 files / 1351 lines, reading keys only:

- **Hook events are recorded here too** — `SessionStart`, `UserPromptSubmit`,
  `Stop`, `SubagentStart`, `PreLLMCall`, `PostLLMCall` all appear as
  `payload.event.event`. The log is a superset of the hook stream, so stage 3 can
  reconcile against it to detect a bypassed or crashed adapter.
- **Token counts are present**: `model_completed.usage.{input,output,cached,reasoning}_tokens`,
  and again under `goal_usage_attribution.record.quantity.*`.
- **Byte accounting is present but coarse** — `model_input_trace_recorded` reports
  lane and sample byte counts, not per-edit diff sizes.
- **Parent/child correlation exists here**, unlike in the hook payload:
  `parent_session_id`, `parent_run_id` and `child_session_log_path`. The directory
  layout alone recovers the parent that `SubagentStart` omits.
- Tool arguments were **not** observed — no session in the sample reached a tool
  call, so this remains open alongside the tool-side deny shape.

### Still unconfirmed

- The tool-side deny shape, on a live tool call (needs a working account).
- Whether tool arguments and per-edit diff bytes appear in `session.jsonl`.
- Whether the TUI and `muse exec` emit identical payload shapes.
- Whether `read_skill` must be exempted. It is a **real tool** (confirmed in the
  binary, with a `skill_read_ledger` behind it), not the speculative name it was
  assumed to be — but its argument shape is unknown, so it is deliberately still
  NOT exempted. Exempting it would widen the unguarded surface.

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
