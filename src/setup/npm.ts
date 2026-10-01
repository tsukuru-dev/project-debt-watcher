import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, realpath } from "node:fs/promises";
import { dirname, join, isAbsolute, delimiter, basename } from "node:path";
import type { GitContext } from "../git/client.js";

const execute = promisify(execFile);
export interface NpmResult { code: number; stdout: string; stderr: string }
export type NpmRunner = (args: readonly string[], context: GitContext) => Promise<NpmResult>;

/** Find npm's JS entry point so Windows does not need a cmd.exe command string. */
async function npmCommand(env: NodeJS.ProcessEnv): Promise<string[]> {
  const candidates: string[] = [];
  if (env.npm_execpath && isAbsolute(env.npm_execpath) && basename(env.npm_execpath) === "npm-cli.js") candidates.push(env.npm_execpath);
  candidates.push(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  const searchPath = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(directory)) continue;
    candidates.push(join(directory, "node_modules", "npm", "bin", "npm-cli.js"));
    if (process.platform !== "win32") {
      try { candidates.push(await realpath(join(directory, "npm"))); } catch { /* Try next PATH entry. */ }
    }
  }
  for (const candidate of new Set(candidates)) {
    try {
      if ((await stat(candidate)).isFile()) return [process.execPath, candidate];
    } catch { /* Try the next installation. */ }
  }
  throw new Error("Cannot locate npm. Install Node.js/npm and make npm available on PATH.");
}

export const runNpm: NpmRunner = async (args, context) => {
  const env = { ...(context.env ?? process.env), npm_config_update_notifier: "false", npm_config_logs_max: "0" };
  const [command, ...prefix] = await npmCommand(env);
  if (!command) throw new Error("Cannot locate npm.");
  try {
    const result = await execute(command, [...prefix, ...args,
      "--prefix", context.cwd, "--global=false", "--workspaces=false",
      "--include=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: context.cwd, env, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof failure.code !== "number" || failure.killed) {
      throw new Error("npm could not complete (" + (failure.killed ? "timed out" : failure.code ?? "launch error") + ").");
    }
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};
