import { spawn } from "node:child_process";
import { discoverEditors } from "./editor-discovery.js";

export interface EditorOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  discoverEditors?: typeof discoverEditors;
}

/** Split executable/arguments without shell expansion; preserve Windows backslashes. */
export function parseEditorCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  if (command.includes("\0")) throw new Error("The editor command contains a null character.");
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      else word += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += character;
      started = true;
    }
  }
  if (quote) throw new Error("The editor command has an unclosed quote.");
  if (started) words.push(word);
  if (!words[0]) throw new Error("The editor command must name an executable.");
  return words;
}

export function editorCommand(options: EditorOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const selected = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (selected) return parseEditorCommand(selected);
  if (platform === "win32") return ["notepad.exe"];
  if (platform === "darwin") return ["/usr/bin/open", "-t"];
  return ["vi"];
}

// Keep the path in the environment, never in PowerShell source or shell arguments.
const openAssociatedFile = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "$info = New-Object System.Diagnostics.ProcessStartInfo",
  "$info.FileName = $env:DEBT_FINDER_EDITOR_FILE",
  "$info.UseShellExecute = $true",
  "$info.ErrorDialog = $false",
  "$info.Verb = 'open'",
  "[void][System.Diagnostics.Process]::Start($info)",
  "exit 0",
  "} catch { exit 1 }",
].join("\n");

async function launch(command: string, args: string[], options: EditorOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = (options.spawnProcess ?? spawn)(command, args, {
      cwd: options.cwd, env: options.env ?? process.env,
      stdio: "inherit", shell: false, windowsHide: true,
    });
    child.once("error", (error) => {
      reject(new Error("Could not launch editor '" + command + "': " + error.message));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error("Editor exited with " + (signal ? "signal " + signal : "code " + code) + "."));
    });
  });
}

/** Explicit preference, current/installed editors, association, then basic editor. */
export async function openEditor(path: string, options: EditorOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const explicit = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (!explicit) {
    for (const [command, ...args] of await (options.discoverEditors ?? discoverEditors)(options)) {
      if (!command) continue;
      try {
        await launch(command, [...args, path], options);
        return;
      } catch {
        // An unavailable automatically selected editor should not block opening.
      }
    }
  }
  if (platform === "win32" && !explicit) {
    try {
      await launch("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", openAssociatedFile], {
        ...options, env: { ...env, DEBT_FINDER_EDITOR_FILE: path },
      });
      return;
    } catch {
      // No association, a broken association, or unavailable PowerShell: use Notepad.
    }
  }
  if (platform !== "win32" && !explicit) {
    try {
      await launch(platform === "darwin" ? "/usr/bin/open" : "xdg-open", [path], options);
      return;
    } catch {
      // Fall through to the platform's basic text editor.
    }
  }
  const [command, ...args] = editorCommand(options);
  if (!command) throw new Error("No editor executable was selected.");
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    throw new Error("Set VISUAL or EDITOR to an editor executable (.exe), not a .cmd or .bat wrapper.");
  }
  await launch(command, [...args, path], options);
}
