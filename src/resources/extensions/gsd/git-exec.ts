/**
 * Shared git execution helper.
 *
 * Centralises the execFileSync("git", …) pattern used across
 * git-service.ts, native-git-bridge.ts and worktree-manager.ts.
 */

import { execFileSync } from "node:child_process";

/** Env overlay that suppresses all interactive git credential prompts. */
export const GIT_NO_PROMPT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
};

export interface GitExecOptions {
  allowFailure?: boolean;
  /** When provided, piped to stdin. */
  input?: string;
}

/**
 * Run a git command in the given directory.
 * Returns trimmed stdout. Throws on non-zero exit unless allowFailure is set.
 */
export function gitExec(
  cwd: string,
  args: string[],
  opts: GitExecOptions = {},
): string {
  try {
    return execFileSync("git", args, {
      cwd,
      stdio: [opts.input != null ? "pipe" : "ignore", "pipe", "pipe"],
      encoding: "utf-8",
      env: GIT_NO_PROMPT_ENV,
      ...(opts.input != null ? { input: opts.input } : {}),
    }).trim();
  } catch (error) {
    if (opts.allowFailure) return "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${message}`);
  }
}
