import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { npmCommand } from "./npm.js";
import type { GitContext } from "../git/client.js";

const execute = promisify(execFile);

/** Compare the running package with npm's configured global root, including custom prefixes.
 * Do not infer global installation from --global, the target repository, or npx's PATH.
 */
export async function isGlobalInstallation(packageRoot: string, context: GitContext,
  findGlobalRoot?: () => Promise<string>): Promise<boolean> {
  if (basename(dirname(packageRoot)) !== "node_modules") return false;
  try {
    const root = findGlobalRoot ? await findGlobalRoot() : await (async () => {
      const env = { ...(context.env ?? process.env), npm_config_update_notifier: "false", npm_config_logs_max: "0" };
      const [command, ...prefix] = await npmCommand(env);
      if (!command) return "";
      const result = await execute(command, [...prefix, "root", "--global", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: context.cwd, env, windowsHide: true, encoding: "utf8", timeout: 10_000,
      });
      return result.stdout.trim();
    })();
    if (!root) return false;
    return await realpath(packageRoot) === await realpath(join(root, "debt-watcher"));
  } catch {
    // Installation detection must not prevent use of an already configured repository.
    return false;
  }
}
