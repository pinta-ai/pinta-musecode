import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADAPTER_VERSION } from "../../src/core/otlp.js";

/**
 * `ADAPTER_VERSION` is a hand-written literal (see the comment on it for why it
 * cannot be a package.json import). This test is the mechanism that keeps it
 * honest.
 *
 * It exists because the constant already drifted once: 0.1.1 was published
 * reporting `telemetry.sdk.version: 0.1.0`, so every span from it was
 * attributed to the version with the OTLP endpoint bug. aware-backend stores
 * this field verbatim, so the drift is not cosmetic — it makes "which adaptor
 * version produced this span?" unanswerable from the data.
 */
describe("ADAPTER_VERSION", () => {
  it("matches the version in package.json", () => {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf-8")) as {
      version: string;
    };
    expect(ADAPTER_VERSION).toBe(pkg.version);
  });
});
