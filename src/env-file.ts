/**
 * Muse Code config directory resolution + graceful env-file loading.
 *
 * Muse Code follows XDG: its user config lives at `$XDG_CONFIG_HOME/muse`,
 * falling back to `~/.config/muse` (dev.meta.ai/docs/muse-code/extending §skills
 * cites `$XDG_CONFIG_HOME/muse/skills`).
 *
 * We cannot reuse @pinta-ai/core's `envFilePath(dir, file, overrideEnvVar)`
 * directly: its override treats the env var as the FULL base directory, whereas
 * `XDG_CONFIG_HOME` is the parent of `muse/`. So the directory is resolved here
 * and only the parser/merge semantics are borrowed from core.
 *
 * The env file matters more here than on other hosts: Muse Code runs hook
 * commands with "a cleared environment with a small allowlist"
 * (dev.meta.ai/docs/muse-code/extending §hooks), so inherited process env cannot
 * be relied on at all.
 */
import os from "node:os";
import path from "node:path";
import { loadEnvFile as coreLoadEnvFile, parseEnvFile } from "@pinta-ai/core";

export { parseEnvFile };

export const ENV_FILE_NAME = "pinta-musecode.env";

/** `$XDG_CONFIG_HOME/muse`, else `~/.config/muse`. */
export function museConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return path.join(xdg, "muse");
  return path.join(os.homedir(), ".config", "muse");
}

export function envFilePath(): string {
  return path.join(museConfigDir(), ENV_FILE_NAME);
}

/** Fills only unset keys; silent no-op when the file is absent. */
export function loadEnvFile(filePath: string = envFilePath()): void {
  coreLoadEnvFile(filePath);
}
