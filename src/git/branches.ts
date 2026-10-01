import { runGitBytes, type GitContext } from "./client.js";

export interface BranchSnapshot {
  ref: string;
  name: string;
  commitId: string;
  scope: "local" | "remote";
}

export function assertObjectId(value: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error("Expected a full Git object ID.");
}

/** Snapshot named branches; remote scope uses refs already fetched by the user. */
export async function selectBranches(context: GitContext, scope: BranchSnapshot["scope"] = "local"): Promise<BranchSnapshot[]> {
  if (scope !== "local" && scope !== "remote") throw new Error("Branch scope must be local or remote.");
  const prefix = scope === "local" ? "refs/heads/" : "refs/remotes/";
  const bytes = await runGitBytes(["--no-lazy-fetch", "--no-replace-objects", "for-each-ref", "--sort=refname",
    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)", prefix], context, 8 * 1024 * 1024);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const branches: BranchSnapshot[] = [];
  for (const record of source.split(/\r?\n/)) {
    if (!record) continue;
    const fields = record.split("\0");
    const [ref, commitId, type, symbolic] = fields;
    if (fields.length !== 4 || !ref?.startsWith(prefix) || !commitId) throw new Error("Unexpected Git branch listing.");
    // origin/HEAD and other aliases are not additional branches.
    if (symbolic) continue;
    if (type !== "commit") throw new Error("Branch does not reference a commit: " + ref);
    assertObjectId(commitId);
    branches.push({ ref, name: ref.slice(prefix.length), commitId, scope });
  }
  return branches;
}
