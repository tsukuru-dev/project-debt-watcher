import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { userConfigDirectory, type UserPathOptions } from "./paths.js";
import { readSetupFile, writeSetupFile } from "../setup/files.js";

// One file per canonical worktree avoids unrelated repositories overwriting each other's decisions.
export function setupStatePath(repositoryRoot: string, options: UserPathOptions = {}): string {
  const identity = (options.platform ?? process.platform) === "win32"
    ? repositoryRoot.toLowerCase() : repositoryRoot;
  return join(userConfigDirectory(options), "setup-state", createHash("sha256").update(identity).digest("hex") + ".json");
}

export async function setupDeclined(repositoryRoot: string, options: UserPathOptions = {}): Promise<boolean> {
  const path = setupStatePath(repositoryRoot, options);
  const source = await readSetupFile(path);
  if (source === null) return false;
  try {
    const state: unknown = JSON.parse(source);
    if (state === null || typeof state !== "object" || !("declined" in state)
      || typeof state.declined !== "boolean") throw new Error("Invalid state");
    return state.declined;
  } catch {
    throw new Error("Cannot read saved setup decision: " + path + ". The file was preserved.");
  }
}

export async function rememberSetupDecision(repositoryRoot: string, declined: boolean, options: UserPathOptions = {}): Promise<void> {
  const path = setupStatePath(repositoryRoot, options);
  const source = await readSetupFile(path);
  if (source === null && !declined) return;
  await mkdir(dirname(path), { recursive: true });
  await writeSetupFile(path, JSON.stringify({ declined }) + "\n", source);
}
