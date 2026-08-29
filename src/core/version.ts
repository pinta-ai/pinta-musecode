/**
 * The single source of truth for this adaptor's own version.
 *
 * There is exactly one version literal in `src/`, and it lives here. That is a
 * deliberate constraint, enforced by `tests/core/adapter-version.test.ts`,
 * which both checks this value against package.json and scans `src/` for any
 * other literal that looks like this adaptor's version.
 *
 * The constraint exists because the previous arrangement -- two separate
 * literals, each carrying a `// keep in sync with package.json` comment --
 * failed on the very first version bump. 0.1.1 shipped reporting 0.1.0 in its
 * spans, and the guard User-Agent was still reporting 0.1.0 at 0.1.2. Both
 * values are consumed by systems that store or attribute them, so the drift
 * was invisible locally and wrong everywhere else. A comment is not a
 * mechanism; a failing test is.
 *
 * It is a literal rather than an import of package.json because the bundle is
 * produced by an esbuild CLI invocation with no config file, and importing
 * JSON would inline the entire manifest into `dist/`.
 */
export const ADAPTER_VERSION = "0.2.0";
