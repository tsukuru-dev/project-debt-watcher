import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runGit, type GitContext } from "../git/client.js";
import type { CodeFinding } from "./types.js";

function editorUrl(path: string, line: number, env: NodeJS.ProcessEnv): string {
  const file = pathToFileURL(path);
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") {
    return `vscode://file${file.pathname}:${line}:1`;
  }
  // Other terminals use the OS file handler; line navigation is editor-specific.
  return file.href;
}

/** Link only a working-tree file whose bytes match the committed source being reported. */
export async function resolveLocalSourceLinks(findings: readonly CodeFinding[], context: GitContext): Promise<Map<CodeFinding, string>> {
  const links = new Map<CodeFinding, string>();
  const hashes = new Map<string, string | undefined>();
  const env = context.env ?? process.env;
  const root = await realpath(context.cwd);
  for (const finding of findings) {
    const path = resolve(root, finding.file.path);
    const fromRoot = relative(root, path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot === "") continue;
    if (!hashes.has(path)) {
      try {
        if (!(await lstat(path)).isFile()) { hashes.set(path, undefined); continue; }
        const actual = await realpath(path);
        const actualFromRoot = relative(root, actual);
        if (actualFromRoot === ".." || actualFromRoot.startsWith(`..${sep}`) || actualFromRoot === "") {
          hashes.set(path, undefined);
          continue;
        }
        hashes.set(path, (await runGit(["hash-object", "--", path], context)).trim());
      } catch { hashes.set(path, undefined); }
    }
    if (hashes.get(path)?.toLowerCase() !== finding.file.blobId.toLowerCase()) continue;
    links.set(finding, editorUrl(path, finding.primary.line, env));
  }
  return links;
}
