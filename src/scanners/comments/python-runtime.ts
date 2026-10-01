import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, delimiter } from "node:path";

export interface PythonRuntime {
  discover(env: NodeJS.ProcessEnv): Promise<string[]>;
  run(executable: string, script: string, input: string, env: NodeJS.ProcessEnv): Promise<string>;
}

/** Search existing executables only: no shell, launcher, Store alias or installation. */
export async function discoverPythonExecutables(env: NodeJS.ProcessEnv): Promise<string[]> {
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const names = process.platform === "win32" ? ["python3.exe", "python.exe"] : ["python3", "python"];
  const found = new Set<string>();
  for (const entry of path.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/u, "$1");
    if (!isAbsolute(directory) || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(directory)) continue;
    for (const name of names) {
      const executable = join(directory, name);
      try {
        if (!(await stat(executable)).isFile()) continue;
        await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        found.add(executable);
      } catch { /* An absent or inaccessible PATH entry is not an interpreter. */ }
    }
  }
  return [...found];
}

export function runPython(executable: string, script: string, input: string, environment: NodeJS.ProcessEnv): Promise<string> {
  if (!isAbsolute(executable) || (process.platform === "win32" && !/\.exe$/iu.test(executable))
    || /^(?:py|pymanager)(?:\.exe)?$/iu.test(basename(executable))
    || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(executable)) {
    return Promise.reject(new Error("Python must be an absolute executable path, not a launcher script or Store alias."));
  }
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^(?:PYTHON|PYLAUNCHER)/iu.test(key)) delete env[key];
  }
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    const child = execFile(executable, ["-I", "-S", "-B", "-c", script], {
      cwd: dirname(executable), env, windowsHide: true, shell: false,
      encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      if (error || inputError) reject(error ?? inputError);
      else resolve(stdout);
    });
    child.stdin?.on("error", (error: Error) => { inputError = error; });
    child.stdin?.end(input);
  });
}

export const systemPythonRuntime: PythonRuntime = { discover: discoverPythonExecutables, run: runPython };
