import { createInterface } from "node:readline/promises";

export function isInteractive(
  env: NodeJS.ProcessEnv = process.env,
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
): boolean {
  const ci = env.CI?.trim().toLowerCase();
  return terminal && (!ci || ci === "false" || ci === "0");
}

/** An empty response, Ctrl+C, or a closed input cancels rather than approving. */
export async function confirm(question: string): Promise<boolean> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  const abort = new AbortController();
  const cancel = () => { abort.abort(); };
  reader.once("SIGINT", cancel);
  reader.once("close", cancel);
  try {
    const answer = await reader.question(question + " [y/N] ", { signal: abort.signal });
    return /^(?:y|yes)$/i.test(answer.trim());
  } catch (error) {
    if (abort.signal.aborted) return false;
    throw error;
  } finally {
    reader.removeListener("close", cancel);
    reader.removeListener("SIGINT", cancel);
    reader.close();
  }
}

/** A single starting-file choice, not a questionnaire about individual settings. */
export async function chooseDefaults(personalPath: string): Promise<"personal" | "template" | undefined> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  const abort = new AbortController();
  const cancel = () => { abort.abort(); };
  reader.once("SIGINT", cancel);
  reader.once("close", cancel);
  try {
    while (!abort.signal.aborted) {
      const answer = (await reader.question("Starting settings: [1] Copy personal defaults (" + personalPath
        + "), [2] Supplied template, [3] Cancel: ", { signal: abort.signal })).trim();
      if (answer === "1") return "personal";
      if (answer === "2") return "template";
      if (answer === "3" || answer === "") return undefined;
      process.stdout.write("Enter 1, 2, or 3.\n");
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    reader.removeListener("close", cancel);
    reader.removeListener("SIGINT", cancel);
    reader.close();
  }
  return undefined;
}
