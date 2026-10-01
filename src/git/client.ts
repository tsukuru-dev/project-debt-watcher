import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitContext {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export async function runGit(args: readonly string[], context: GitContext, input?: string): Promise<string> {
  const env = { ...(context.env ?? process.env) };
  // The requested checkout, not inherited Git process state, selects the repository.
  const repositoryOverrides = new Set([
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]);
  for (const key of Object.keys(env)) {
    if (repositoryOverrides.has(key.toUpperCase())) delete env[key];
  }
  const execution = execute("git", [...args], {
    cwd: context.cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  execution.child.stdin?.end(input);
  const result = await execution;
  return result.stdout;
}
