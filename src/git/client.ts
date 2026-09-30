import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitContext {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export async function runGit(args: readonly string[], context: GitContext): Promise<string> {
  const env = { ...(context.env ?? process.env) };
  // The requested checkout, not inherited Git process state, selects the repository.
  const repositoryOverrides = new Set([
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]);
  for (const key of Object.keys(env)) {
    if (repositoryOverrides.has(key.toUpperCase())) delete env[key];
  }
  const result = await execute("git", [...args], {
    cwd: context.cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}
