import { MUSE_EVENTS } from "../src/core/types.js";

/**
 * Pure summariser for a stage-0 capture file. Kept separate from the CLI so it
 * can be unit-tested without a `muse` binary present.
 */

export interface CaptureEntry {
  argv?: string[];
  payloadKeys?: string[];
  payload?: Record<string, unknown> | null;
  parseError?: string | null;
  rawLength?: number;
  durationMs?: number;
  env?: { keys?: string[] };
}

export interface EventSummary {
  event: string;
  count: number;
  /** Union of payload keys seen, so a shape that varies is still visible. */
  payloadKeys: string[];
  /** Keys absent from at least one sample — i.e. optional in practice. */
  inconsistentKeys: string[];
  nameFromArgv: number;
  nameInPayload: number;
  emptyPayload: number;
  parseErrors: number;
  maxDurationMs: number;
}

export interface SpikeReport {
  totalEntries: number;
  events: EventSummary[];
  missingEvents: string[];
  unknownEvents: string[];
  /** Env keys that survived on EVERY capture — the reliable allowlist. */
  envAlwaysPresent: string[];
  /** Env keys present on some captures only. */
  envSometimesPresent: string[];
}

const NAME_KEYS = ["hook_event_name", "event", "hook", "hook_event", "eventName"];

function eventNameOf(e: CaptureEntry): string {
  const fromArgv = (e.argv ?? []).find((a) => (MUSE_EVENTS as readonly string[]).includes(a));
  if (fromArgv) return fromArgv;
  for (const k of NAME_KEYS) {
    const v = e.payload?.[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "(unresolved)";
}

export function summarise(entries: CaptureEntry[]): SpikeReport {
  const byEvent = new Map<string, CaptureEntry[]>();
  for (const e of entries) {
    const name = eventNameOf(e);
    const bucket = byEvent.get(name);
    if (bucket) bucket.push(e);
    else byEvent.set(name, [e]);
  }

  const events: EventSummary[] = [];
  for (const [event, group] of [...byEvent.entries()].sort()) {
    const keyCounts = new Map<string, number>();
    for (const e of group) {
      for (const k of e.payloadKeys ?? []) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    }
    events.push({
      event,
      count: group.length,
      payloadKeys: [...keyCounts.keys()].sort(),
      inconsistentKeys: [...keyCounts.entries()]
        .filter(([, n]) => n < group.length)
        .map(([k]) => k)
        .sort(),
      nameFromArgv: group.filter((e) =>
        (e.argv ?? []).some((a) => (MUSE_EVENTS as readonly string[]).includes(a)),
      ).length,
      nameInPayload: group.filter((e) =>
        NAME_KEYS.some((k) => typeof e.payload?.[k] === "string"),
      ).length,
      emptyPayload: group.filter((e) => (e.payloadKeys ?? []).length === 0).length,
      parseErrors: group.filter((e) => Boolean(e.parseError)).length,
      maxDurationMs: group.reduce((m, e) => Math.max(m, e.durationMs ?? 0), 0),
    });
  }

  const seen = new Set(byEvent.keys());
  const envCounts = new Map<string, number>();
  for (const e of entries) {
    for (const k of e.env?.keys ?? []) envCounts.set(k, (envCounts.get(k) ?? 0) + 1);
  }

  return {
    totalEntries: entries.length,
    events,
    missingEvents: MUSE_EVENTS.filter((e) => !seen.has(e)),
    unknownEvents: [...seen]
      .filter((e) => e !== "(unresolved)" && !(MUSE_EVENTS as readonly string[]).includes(e))
      .sort(),
    envAlwaysPresent: [...envCounts.entries()]
      .filter(([, n]) => n === entries.length && entries.length > 0)
      .map(([k]) => k)
      .sort(),
    envSometimesPresent: [...envCounts.entries()]
      .filter(([, n]) => n < entries.length)
      .map(([k]) => k)
      .sort(),
  };
}

export function parseCaptureFile(content: string): CaptureEntry[] {
  const out: CaptureEntry[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t) as CaptureEntry);
    } catch {
      // A partially written final line is normal while a session is live.
    }
  }
  return out;
}

export function formatReport(r: SpikeReport): string {
  const lines: string[] = [];
  lines.push(`captures: ${r.totalEntries}`);
  lines.push("");
  for (const e of r.events) {
    lines.push(`${e.event}  (${e.count})`);
    lines.push(`  payload keys      ${e.payloadKeys.join(", ") || "(none)"}`);
    if (e.inconsistentKeys.length > 0) {
      lines.push(`  NOT always present ${e.inconsistentKeys.join(", ")}`);
    }
    lines.push(`  name from argv     ${e.nameFromArgv}/${e.count}`);
    lines.push(`  name in payload    ${e.nameInPayload}/${e.count}`);
    if (e.emptyPayload > 0) lines.push(`  empty payload      ${e.emptyPayload}/${e.count}`);
    if (e.parseErrors > 0) lines.push(`  PARSE ERRORS       ${e.parseErrors}/${e.count}`);
    lines.push(`  slowest            ${e.maxDurationMs}ms`);
    lines.push("");
  }
  if (r.unknownEvents.length > 0) {
    lines.push(`undocumented events seen: ${r.unknownEvents.join(", ")}`);
  }
  lines.push(`events never fired: ${r.missingEvents.join(", ") || "(none)"}`);
  lines.push("");
  lines.push(`env always present (${r.envAlwaysPresent.length}): ${r.envAlwaysPresent.join(", ")}`);
  if (r.envSometimesPresent.length > 0) {
    lines.push(`env sometimes present: ${r.envSometimesPresent.join(", ")}`);
  }
  return lines.join("\n");
}
