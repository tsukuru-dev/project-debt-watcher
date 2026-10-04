import { runGit, type GitContext } from "./client.js";
import type { BranchSnapshot } from "./branches.js";

export interface HostedRemote {
  provider: "github" | "gitlab";
  webBase: string;
}

export interface RemoteLinks {
  forBranch(branch: BranchSnapshot): HostedRemote | undefined;
}

export interface HostHints {
  githubHost?: string | undefined;
  gitlabHost?: string | undefined;
}

function encoded(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function segments(path: string): string[] | undefined {
  try {
    const parts = path.replace(/^\/+|\/+$/gu, "").split("/")
      .map((part) => decodeURIComponent(part));
    if (parts.length < 2 || parts.some((part) => !part || part === "." || part === ".."
      || /[\\/\u0000-\u001f\u007f]/u.test(part))) return undefined;
    parts[parts.length - 1] = parts[parts.length - 1]!.replace(/\.git$/iu, "");
    if (!parts[parts.length - 1]) return undefined;
    return parts;
  } catch { return undefined; }
}

/** Parse common HTTPS and SSH remotes without retaining embedded credentials. */
export function parseHostedRemote(remoteUrl: string, hints: HostHints = {}): HostedRemote | undefined {
  let host: string, port = "", path: string, protocol = "https:";
  if (/^(?:https?|ssh):\/\//iu.test(remoteUrl)) {
    let url: URL;
    try { url = new URL(remoteUrl); } catch { return undefined; }
    if (!["https:", "http:", "ssh:"].includes(url.protocol) || url.search || url.hash) return undefined;
    host = url.hostname.toLowerCase();
    path = url.pathname;
    if (url.protocol !== "ssh:") { protocol = url.protocol; port = url.port; }
  } else {
    const scp = /^(?:[^@/:\s]+@)?([^@/:\s]+):([^\s]+)$/u.exec(remoteUrl);
    if (!scp) return undefined;
    host = scp[1]!.toLowerCase();
    path = scp[2]!;
  }
  const github = host === hints.githubHost?.toLowerCase() || host.split(".").includes("github");
  const gitlab = host === hints.gitlabHost?.toLowerCase() || host.split(".").includes("gitlab");
  // Conflicting hints are ambiguous, so never guess a provider.
  const provider = github === gitlab ? undefined : github ? "github" : "gitlab";
  const project = segments(path);
  if (!provider || !project || (provider === "github" && project.length !== 2)) return undefined;
  // URL validates host syntax and strips credentials from HTTP remotes.
  try {
    const base = new URL(`${protocol}//${host}${port ? `:${port}` : ""}/`);
    base.pathname = project.map(encoded).join("/") + "/";
    return { provider, webBase: base.href };
  } catch { return undefined; }
}

/** Prefer origin for local refs and the matching remote for remote-tracking refs. */
export async function resolveRemoteLinks(context: GitContext): Promise<RemoteLinks> {
  const names = (await runGit(["remote"], context)).split(/\r?\n/u).filter(Boolean);
  const remotes = new Map<string, HostedRemote>();
  const env = context.env ?? process.env;
  const hints = { githubHost: env.GH_HOST, gitlabHost: env.GITLAB_HOST };
  for (const name of names) {
    try {
      const remote = parseHostedRemote((await runGit(["remote", "get-url", name], context)).trim(), hints);
      if (remote) remotes.set(name, remote);
    } catch { /* A missing or invalid remote leaves its entries unlinked. */ }
  }
  const local = names.includes("origin") ? remotes.get("origin")
    : remotes.size === 1 ? [...remotes.values()][0] : undefined;
  return { forBranch(branch) {
    if (branch.scope === "local") return local;
    const name = [...remotes.keys()].filter((key) => branch.name.startsWith(`${key}/`))
      .sort((a, b) => b.length - a.length)[0];
    return name ? remotes.get(name) : undefined;
  } };
}

/** Link the exact committed file version and marker line. */
export function sourcePermalink(remote: HostedRemote | undefined, commitId: string,
  filePath: string, line: number): string | undefined {
  if (!remote || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(commitId)
    || !Number.isSafeInteger(line) || line < 1) return undefined;
  const file = filePath.split("/");
  if (file.some((part) => !part || part === "." || part === ".." || /[\\\u0000-\u001f\u007f]/u.test(part))) return undefined;
  return `${remote.webBase}${remote.provider === "gitlab" ? "-/" : ""}blob/${commitId}/${file.map(encoded).join("/")}#L${line}`;
}

/** Link the exact tip commit, including when the branch later moves. */
export function commitPermalink(remote: HostedRemote | undefined, commitId: string): string | undefined {
  if (!remote || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(commitId)) return undefined;
  return `${remote.webBase}${remote.provider === "gitlab" ? "-/" : ""}commit/${commitId}`;
}
