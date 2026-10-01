import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, delimiter } from "node:path";

export interface RubyRuntime {
  discover(env: NodeJS.ProcessEnv): Promise<string[]>;
  run(executable: string, program: string, input: string, env: NodeJS.ProcessEnv): Promise<string>;
}

export async function discoverRubyExecutables(env: NodeJS.ProcessEnv): Promise<string[]> {
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const found = new Set<string>();
  for (const entry of path.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/u, "$1");
    if (!isAbsolute(directory) || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(directory)) continue;
    const executable = join(directory, process.platform === "win32" ? "ruby.exe" : "ruby");
    try {
      if (!(await stat(executable)).isFile()) continue;
      await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      found.add(executable);
    } catch { /* Ignore missing PATH entries. */ }
  }
  return [...found];
}

export function runRuby(executable: string, program: string, input: string, environment: NodeJS.ProcessEnv): Promise<string> {
  if (!isAbsolute(executable) || (process.platform === "win32" && !/\.exe$/iu.test(executable))
    || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(executable)) {
    return Promise.reject(new Error("Ruby must be an absolute executable path, not a script or Store alias."));
  }
  const env = { ...environment };
  for (const key of Object.keys(env)) if (/^(?:RUBY|GEM_|BUNDLE_)/iu.test(key)) delete env[key];
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    const child = execFile(executable, ["--disable-gems", "--disable-did_you_mean", "-EUTF-8:UTF-8", "-e", program], {
      cwd: dirname(executable), env, windowsHide: true, shell: false,
      encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      if (error || inputError) reject(error ?? inputError); else resolve(stdout);
    });
    child.stdin?.on("error", (error: Error) => { inputError = error; });
    child.stdin?.end(input);
  });
}

export const systemRubyRuntime: RubyRuntime = { discover: discoverRubyExecutables, run: runRuby };
