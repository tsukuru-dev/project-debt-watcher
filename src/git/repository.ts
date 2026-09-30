import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { runGit, type GitContext } from "./client.js";

/** Find the active worktree root without switching branches or requiring a commit. */
export async function resolveRepositoryRoot(
  repo: string | undefined,
  context: GitContext,
): Promise<string> {
  const target = resolve(context.cwd, repo ?? ".");
  let directory;
  try {
    directory = await stat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(`Cannot access repository path "${target}" (${code ?? "filesystem error"}).`);
  }
  if (!directory.isDirectory()) throw new Error(`Repository path "${target}" must be a directory.`);

  try {
    const root = await runGit(["rev-parse", "--show-toplevel"], { ...context, cwd: target });
    // Use the filesystem's canonical spelling, including Windows path casing.
    return await realpath(resolve(root.replace(/\r?\n$/, "")));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === "ENOENT") {
      throw new Error("Git is required to locate repository configuration. Install Git and make it available on PATH.");
    }
    const details = failure.stderr?.trim() || failure.code || "Git command failed";
    throw new Error(`Cannot resolve a Git working tree from "${target}": ${details}`);
  }
}
