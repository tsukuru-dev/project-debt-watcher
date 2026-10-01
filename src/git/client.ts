import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitContext {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

function executionOptions(context: GitContext, maxBuffer: number) {
  const env = { ...(context.env ?? process.env) };
  // The requested checkout, not inherited Git process state, selects the repository.
  const repositoryOverrides = new Set([
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]);
  for (const key of Object.keys(env)) {
    if (repositoryOverrides.has(key.toUpperCase())) delete env[key];
  }
  return { cwd: context.cwd, env, windowsHide: true, maxBuffer };
}

export async function runGit(args: readonly string[], context: GitContext, input?: string): Promise<string> {
  const execution = execute("git", [...args], { ...executionOptions(context, 1024 * 1024), encoding: "utf8" });
  execution.child.stdin?.end(input);
  const result = await execution;
  return result.stdout;
}

/** Keep blob bytes intact so callers can distinguish text from invalid UTF-8 or binary data. */
export async function runGitBytes(args: readonly string[], context: GitContext, maxBuffer: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1) throw new Error("Git output limit must be a positive integer.");
  const execution = execute("git", [...args], { ...executionOptions(context, maxBuffer), encoding: "buffer" });
  execution.child.stdin?.end();
  return (await execution).stdout;
}
