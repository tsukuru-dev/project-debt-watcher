import { isAbsolute } from "node:path";
import { extractPythonComments } from "./python.js";
import { pythonProbe, pythonTokenize } from "./python-helper.js";
import { systemPythonRuntime, type PythonRuntime } from "./python-runtime.js";
import { commentSource } from "./source.js";
import type { CommentExtraction } from "./types.js";

export interface PythonExtractorOptions {
  mode?: "auto" | "official" | "builtin";
  /** Explicit existing interpreter, useful for reproducible CI. Never installed by this API. */
  executable?: string;
  env?: NodeJS.ProcessEnv;
}
export type PythonBackend = { kind: "official"; name: "python-tokenize"; version: string; executable: string }
  | { kind: "builtin"; name: "debt-finder-python"; version: "2"; reason: string };
export interface PythonCommentExtractor {
  backend: PythonBackend;
  extract(source: string): Promise<CommentExtraction>;
}

function checkSize(source: string): void {
  if (Buffer.byteLength(source, "utf8") > 8 * 1024 * 1024) throw new Error("Python extraction source exceeds 8 MiB.");
}

function response(output: string): Record<string, unknown> {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value) || !("protocol" in value) || value.protocol !== 1) {
    throw new Error("Invalid Python helper protocol.");
  }
  return value as Record<string, unknown>;
}
function version(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => Number.isSafeInteger(n) && n >= 0)
    || value[0] !== 3 || value[1] < 12 || value[1] > 14) throw new Error("Unsupported Python version; supported versions are 3.12–3.14.");
  return value.join(".");
}

function convert(source: string, data: Record<string, unknown>): CommentExtraction {
  const { position, comment } = commentSource(source, (c) => c === "\r" || c === "\n");
  const lines: { start: number; end: number }[] = [];
  let start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] !== "\r" && source[i] !== "\n") continue;
    lines.push({ start, end: i });
    if (source[i] === "\r" && source[i + 1] === "\n") i++;
    start = i + 1;
  }
  lines.push({ start, end: source.length });
  const offset = (row: unknown, column: unknown, clamp = false): number => {
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || (row as number) < 1 || (column as number) < 0) {
      throw new Error("Invalid Python source position.");
    }
    const line = lines[(row as number) - 1];
    if (!line) {
      if (clamp) return source.length;
      throw new Error("Python position is beyond the source.");
    }
    let index = line.start;
    for (let count = 0; count < (column as number); count++) {
      if (index >= line.end) {
        if (clamp) return line.end;
        throw new Error("Python column is beyond the source line.");
      }
      index += source.codePointAt(index)! > 0xffff ? 2 : 1;
    }
    return index;
  };
  if (data.status === "invalid" || data.status === "unsupported") {
    if (typeof data.message !== "string" || !data.message) throw new Error("Missing Python diagnostic.");
    return { status: data.status, comments: [], diagnostic: {
      message: data.message, position: position(offset(data.line, data.column, true)),
    } };
  }
  if (data.status !== "ok" || !Array.isArray(data.spans)) throw new Error("Invalid Python extraction response.");
  let previousEnd = -1;
  const comments = data.spans.map((span: unknown) => {
    if (!Array.isArray(span) || span.length !== 3) throw new Error("Invalid Python comment span.");
    const begin = offset(span[0], span[1]), end = offset(span[0], span[2]);
    if (begin < previousEnd || end <= begin || source[begin] !== "#" || end !== lines[span[0] - 1]!.end) {
      throw new Error("Python comment span does not match the source.");
    }
    previousEnd = end;
    return comment("line", begin, end, begin + 1, end);
  });
  return { status: "ok", comments };
}

/** Create once per scan. Selection is fixed; extraction errors never switch backends. */
export async function createPythonCommentExtractor(options: PythonExtractorOptions = {},
  runtime: PythonRuntime = systemPythonRuntime): Promise<PythonCommentExtractor> {
  const mode = options.mode ?? "auto", env = { ...(options.env ?? process.env) };
  if (!["auto", "official", "builtin"].includes(mode)) throw new Error("Unknown Python extractor mode.");
  if (options.executable !== undefined && (!isAbsolute(options.executable) || mode === "builtin")) {
    throw new Error("An explicit Python executable must be absolute and requires auto or official mode.");
  }
  const failures: string[] = [];
  if (mode !== "builtin") {
    const candidates = options.executable ? [options.executable] : await runtime.discover(env);
    for (const executable of candidates) {
      let selectedVersion: string;
      try {
        const probe = response(await runtime.run(executable, pythonProbe, "", env));
        selectedVersion = version(probe.version);
        if (probe.compatible !== true) throw new Error("Python tokenize capability check failed.");
      } catch {
        failures.push(`${executable}: unavailable, incompatible or failed capability probe`);
        continue;
      }
      return {
        backend: { kind: "official", name: "python-tokenize", version: selectedVersion, executable },
        async extract(source) {
          checkSize(source);
          try {
            const data = response(await runtime.run(executable, pythonTokenize, JSON.stringify(source), env));
            if (version(data.version) !== selectedVersion) throw new Error("Python version changed during this scan.");
            return convert(source, data);
          } catch (cause) {
            throw new Error("Official Python comment extraction failed; no fallback was attempted.", { cause });
          }
        },
      };
    }
  }
  const reason = mode === "builtin" ? "Built-in extraction was explicitly selected."
    : failures.length ? failures.join("; ") : "No Python executable was found on PATH.";
  if (mode === "official") throw new Error(`Official Python extraction is unavailable. ${reason}`);
  return {
    backend: { kind: "builtin", name: "debt-finder-python", version: "2", reason },
    async extract(source) { checkSize(source); return extractPythonComments(source); },
  };
}
