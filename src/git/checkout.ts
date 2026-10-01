import { runGit, type GitContext } from "./client.js";

/** Identify a branch/commit without changing it; unborn and detached checkouts are valid. */
export async function readCheckout(context: GitContext): Promise<string> {
  const read = async (args: string[]) => {
    try { return await runGit(args, context); }
    catch (error) { if ((error as { code?: number }).code === 1) return ""; throw error; }
  };
  return await read(["symbolic-ref", "--quiet", "HEAD"])
    + await read(["rev-parse", "--verify", "--quiet", "HEAD"]);
}
