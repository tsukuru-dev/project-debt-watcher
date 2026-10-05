import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

export interface PreparedGoHelper {
  run(input: string): Promise<string>;
  close(): Promise<void>;
}
export interface GoRuntime {
  discover(env: NodeJS.ProcessEnv): Promise<string[]>;
  prepare(executable: string, program: string, env: NodeJS.ProcessEnv): Promise<PreparedGoHelper>;
}

export async function discoverGoExecutables(env: NodeJS.ProcessEnv): Promise<string[]> {
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const found = new Set<string>();
  for (const entry of path.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/u, "$1");
    if (!isAbsolute(directory) || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(directory)) continue;
    const executable = join(directory, process.platform === "win32" ? "go.exe" : "go");
    try {
      if (!(await stat(executable)).isFile()) continue;
      await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      found.add(executable);
    } catch { /* Missing PATH entry. */ }
  }
  return [...found];
}

function execute(executable: string, args: string[], input: string, cwd: string,
  env: NodeJS.ProcessEnv, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    const child = execFile(executable, args, { cwd, env, shell: false, windowsHide: true,
      encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error || inputError) reject(error ?? inputError); else resolve(stdout);
    });
    child.stdin?.on("error", (error: Error) => { inputError = error; });
    child.stdin?.end(input);
  });
}

function cleanTemporaryHelper(directory: string): Promise<void> {
  const base = resolve(tmpdir()), target = resolve(directory);
  if (!target.startsWith(base + sep) || !target.slice(base.length + 1).startsWith("debt-finder-go-")) {
    return Promise.reject(new Error("Refusing to remove a Go helper outside its temporary directory."));
  }
  return rm(target, { recursive: true, force: true });
}

/** Build a fixed standard-library-only helper once per scan in disposable storage. */
export async function prepareGo(executable: string, program: string,
  environment: NodeJS.ProcessEnv): Promise<PreparedGoHelper> {
  if (!isAbsolute(executable) || (process.platform === "win32" && !/\.exe$/iu.test(executable))
    || /(?:^|[\\/])WindowsApps(?:[\\/]|$)/iu.test(executable)) {
    throw new Error("Go must be an absolute executable path, not a script or Store alias.");
  }
  const directory = await mkdtemp(join(tmpdir(), "debt-finder-go-"));
  let closed = false;
  try {
    const env = { ...environment };
    for (const key of Object.keys(env)) {
      if (/^(?:GO[A-Z0-9_]*|CGO_[A-Z0-9_]*|GCCGO|CC|CXX|PKG_CONFIG|TMPDIR|TMP|TEMP)$/iu.test(key)) delete env[key];
    }
    Object.assign(env, { GO111MODULE: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOPROXY: "off",
      GOSUMDB: "off", GOENV: "off", GOFLAGS: "", CGO_ENABLED: "0", GOCACHE: join(directory, "cache"),
      GOPATH: join(directory, "path"), TMPDIR: directory, TMP: directory, TEMP: directory });
    const source = join(directory, "helper.go");
    const binary = join(directory, process.platform === "win32" ? "helper.exe" : "helper");
    await writeFile(source, program, { encoding: "utf8", flag: "wx" });
    await execute(executable, ["build", "-o", binary, source], "", directory, env, 120_000);
    return {
      async run(input) {
        if (closed) throw new Error("Go helper has been closed.");
        return execute(binary, [], input, directory, env, 10_000);
      },
      async close() {
        if (closed) return;
        closed = true;
        await cleanTemporaryHelper(directory);
      },
    };
  } catch (error) {
    await cleanTemporaryHelper(directory);
    throw error;
  }
}

export const systemGoRuntime: GoRuntime = { discover: discoverGoExecutables, prepare: prepareGo };
