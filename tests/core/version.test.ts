import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTER_VERSION } from "../../src/core/version.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function packageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".mts") ? [full] : [];
  });
}

/**
 * These two tests exist because a `// keep in sync with package.json` comment
 * failed twice in this repo, in two different files:
 *
 *   - `otlp.ts`  shipped 0.1.1 spans reporting `telemetry.sdk.version` 0.1.0
 *   - `guard.ts` was still sending `User-Agent: pinta-musecode/0.1.0` at 0.1.2,
 *     which the manager parses to attribute guard calls per adaptor
 *
 * Both are consumed by systems that *store* the value, so neither drift was
 * visible locally. Fixing only the first one would have left the pattern
 * intact, so the second test bans the pattern outright rather than pinning one
 * more constant.
 */
describe("adaptor version", () => {
  it("matches the version in package.json", () => {
    expect(ADAPTER_VERSION).toBe(packageVersion());
  });

  it("is the only version literal in src/", () => {
    // Matches this adaptor's own version shape. Host-binary references such as
    // `muse 0.1.0-R708.1` carry a suffix and are deliberately not matched:
    // they describe what was measured, not what we ship.
    const versionLiteral = /(?<![\w.-])\d+\.\d+\.\d+(?![\w.-])/;
    const offenders: string[] = [];

    for (const file of sourceFiles(join(repoRoot, "src"))) {
      const rel = file.slice(repoRoot.length);
      readFileSync(file, "utf-8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.split("//")[0];
          if (!versionLiteral.test(code)) return;
          if (rel.endsWith("core/version.ts")) return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }

    expect(
      offenders,
      "Version literals must be derived from ADAPTER_VERSION in src/core/version.ts, " +
        "not copied. Copies drift silently.",
    ).toEqual([]);
  });
});
