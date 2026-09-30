import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { posix, win32 } from "node:path";

export interface DiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isExecutable?: (path: string) => Promise<boolean>;
}

const editors = [
  { id: "code", folder: "Microsoft VS Code", exe: "Code.exe", app: "Visual Studio Code.app" },
  { id: "cursor", folder: "cursor", exe: "Cursor.exe", app: "Cursor.app" },
  { id: "antigravity", folder: "Antigravity", exe: "Antigravity.exe", app: "Antigravity.app" },
] as const;

/** Environment names are case-insensitive on Windows. */
function value(env: NodeJS.ProcessEnv, key: string, windows: boolean): string | undefined {
  return windows ? Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] : env[key];
}

export async function discoverEditors(options: DiscoveryOptions = {}): Promise<string[][]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  const get = (key: string) => value(env, key, windows);
  const executable = options.isExecutable ?? (async (path: string) => {
    try {
      if (!(await stat(path)).isFile()) return false;
      await access(path, windows ? constants.F_OK : constants.X_OK);
      return true;
    } catch { return false; }
  });
  const pathDirs = (get("PATH") ?? "").split(windows ? ";" : ":")
    .map((path) => path.replace(/^"(.*)"$/, "$1"))
    .filter((path) => paths.isAbsolute(path));
  // Forks also report TERM_PROGRAM=vscode. Only identify a product from its
  // installation path, never from that generic terminal name alone.
  const askpass = get("VSCODE_GIT_ASKPASS_MAIN") ?? "";
  const install = paths.isAbsolute(askpass)
    && /[\\/]resources[\\/]app[\\/]extensions[\\/]git[\\/]dist[\\/]askpass-main\.js$/i.test(askpass)
    ? paths.resolve(paths.dirname(askpass), "../../../../..") : undefined;
  const installName = install?.replaceAll("\\", "/").toLowerCase() ?? "";
  const current = editors.find((editor) => installName.endsWith("/" + editor.folder.toLowerCase())
    || (platform !== "win32" && installName.endsWith("/" + editor.id))
    || installName.endsWith("/" + editor.app.toLowerCase() + "/contents"));
  const ordered = current ? [current, ...editors.filter((editor) => editor !== current)] : [...editors];
  const commands: string[][] = [];
  const seen = new Set<string>();
  for (const editor of ordered) {
    const candidates: string[] = [];
    if (current === editor && install) {
      candidates.push(windows ? paths.join(install, editor.exe)
        : platform === "darwin" ? paths.join(install, "Resources", "app", "bin", editor.id)
          : paths.join(install, editor.id));
    }
    if (windows) {
      // Windows launchers are .cmd wrappers; find their adjacent real executable.
      for (const directory of pathDirs) {
        candidates.push(paths.join(directory, editor.exe));
        if (paths.basename(directory).toLowerCase() === "bin") {
          candidates.push(paths.join(directory, "..", editor.exe));
        }
      }
      const local = get("LOCALAPPDATA");
      if (local && paths.isAbsolute(local)) candidates.push(paths.join(local, "Programs", editor.folder, editor.exe));
      for (const key of ["ProgramFiles", "ProgramFiles(x86)"]) {
        const directory = get(key);
        if (directory && paths.isAbsolute(directory)) candidates.push(paths.join(directory, editor.folder, editor.exe));
      }
    } else {
      for (const directory of pathDirs) candidates.push(paths.join(directory, editor.id));
      if (platform === "darwin") {
        const home = get("HOME");
        const roots = ["/Applications", ...(home && paths.isAbsolute(home) ? [paths.join(home, "Applications")] : [])];
        for (const root of roots) candidates.push(paths.join(root, editor.app, "Contents", "Resources", "app", "bin", editor.id));
      } else {
        candidates.push("/usr/bin/" + editor.id, "/usr/local/bin/" + editor.id, "/snap/bin/" + editor.id);
      }
    }
    for (const candidate of candidates) {
      const key = windows ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      if (await executable(candidate)) commands.push([candidate]);
    }
  }
  return commands;
}
