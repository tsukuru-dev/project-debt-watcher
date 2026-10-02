import { isAbsolute } from "node:path";
import { extractGoComments, goSourceDiagnostic } from "./go.js";
import { goHelper } from "./go-helper.js";
import { systemGoRuntime, type GoRuntime, type PreparedGoHelper } from "./go-runtime.js";
import { commentSource } from "./source.js";
import type { CommentExtraction } from "./types.js";

export interface GoExtractorOptions {
  mode?: "auto" | "official" | "builtin";
  executable?: string;
  env?: NodeJS.ProcessEnv;
}
export interface GoCommentExtractor {
  backend: { kind: "official"; name: "go-scanner"; version: string; executable: string }
    | { kind: "builtin"; name: "debt-watcher-go"; version: "1"; reason: string };
  extract(source: string): Promise<CommentExtraction>;
  /** Release the temporary official helper and its isolated compile cache. */
  close(): Promise<void>;
}

function checkSize(source: string): void {
  if (Buffer.byteLength(source, "utf8") > 8 * 1024 * 1024) throw new Error("Go extraction source exceeds 8 MiB.");
}
function response(output: string): Record<string, unknown> {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value) || !("protocol" in value) || value.protocol !== 1) {
    throw new Error("Invalid Go helper protocol.");
  }
  return value as Record<string, unknown>;
}
function version(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Go version.");
  const match = /^go1\.(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match || Number(match[1]) < 20 || Number(match[1]) > 27) {
    throw new Error("Supported Go versions are 1.20-1.27.");
  }
  return value;
}

function convert(source: string, data: Record<string, unknown>): CommentExtraction {
  const { position, comment } = commentSource(source, (c) => c === "\n");
  const bytes = Buffer.byteLength(source, "utf8");
  const wanted = new Set<number>();
  if (data.status === "invalid") {
    if (typeof data.message !== "string" || !data.message || !Number.isSafeInteger(data.offset)
      || (data.offset as number) < 0 || (data.offset as number) > bytes) throw new Error("Invalid Go diagnostic.");
    wanted.add(data.offset as number);
  } else if (data.status === "ok" && Array.isArray(data.spans)) {
    for (const span of data.spans) {
      if (!Array.isArray(span) || span.length !== 3 || !["line", "block"].includes(span[0])
        || !span.slice(1).every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0)) {
        throw new Error("Invalid Go comment span.");
      }
      wanted.add(span[1] as number); wanted.add(span[2] as number);
    }
  } else throw new Error("Invalid Go comment response.");
  // Go token offsets count original UTF-8 bytes, including a leading BOM.
  const offsets = new Map<number, number>();
  if (wanted.has(0)) offsets.set(0, 0);
  let byte = 0, index = 0;
  for (const c of source) {
    byte += Buffer.byteLength(c, "utf8"); index += c.length;
    if (wanted.has(byte)) offsets.set(byte, index);
  }
  if (data.status === "invalid") {
    const offset = offsets.get(data.offset as number);
    if (offset === undefined) throw new Error("Go diagnostic is not on a UTF-8 boundary.");
    return { status: "invalid", comments: [], diagnostic: { message: data.message as string, position: position(offset) } };
  }
  let previousEnd = -1;
  const comments = (data.spans as unknown[]).map((entry) => {
    const span = entry as ["line" | "block", number, number];
    const start = offsets.get(span[1]), end = offsets.get(span[2]);
    if (start === undefined || end === undefined || start < previousEnd || end <= start) {
      throw new Error("Go comment span is outside the source or not on a UTF-8 boundary.");
    }
    const raw = source.slice(start, end);
    if (span[0] === "line") {
      if (!raw.startsWith("//") || /[\r\n]/u.test(raw)
        || (end < source.length && source[end] !== "\n" && !(source[end] === "\r" && source[end + 1] === "\n"))) {
        throw new Error("Invalid Go line comment boundaries.");
      }
    } else if (!raw.startsWith("/*") || !raw.endsWith("*/") || source.indexOf("*/", start + 2) !== end - 2) {
      throw new Error("Invalid Go block comment boundaries.");
    }
    previousEnd = end;
    return comment(span[0], start, end, start + 2, end - (span[0] === "block" ? 2 : 0));
  });
  return { status: "ok", comments };
}

const probeSource = '\ufeffvar x = "😀/* hidden */" // line\r\n/* block\r\nbody */\n//line imaginary.go:500\n// tail';
const probeComments = extractGoComments(probeSource);

/** Compile and probe once; dispose the selected helper with close() after the scan. */
export async function createGoCommentExtractor(options: GoExtractorOptions = {},
  runtime: GoRuntime = systemGoRuntime): Promise<GoCommentExtractor> {
  const mode = options.mode ?? "auto", env = { ...(options.env ?? process.env) };
  if (!["auto", "official", "builtin"].includes(mode)) throw new Error("Unknown Go extractor mode.");
  if (options.executable !== undefined && (!isAbsolute(options.executable) || mode === "builtin")) {
    throw new Error("An explicit Go executable must be absolute and requires auto or official mode.");
  }
  const failures: string[] = [];
  if (mode !== "builtin") {
    const candidates = options.executable ? [options.executable] : await runtime.discover(env);
    for (const executable of candidates) {
      let prepared: PreparedGoHelper | undefined;
      try {
        prepared = await runtime.prepare(executable, goHelper, env);
        const probe = response(await prepared.run(JSON.stringify({ source: probeSource })));
        const selectedVersion = version(probe.version);
        const result = convert(probeSource, probe);
        if (probeComments.status !== "ok" || JSON.stringify(result) !== JSON.stringify(probeComments)) {
          throw new Error("Go scanner capability check failed.");
        }
        const helper = prepared;
        return {
          backend: { kind: "official", name: "go-scanner", version: selectedVersion, executable },
          async extract(source) {
            checkSize(source);
            const issue = goSourceDiagnostic(source); if (issue) return issue;
            try {
              const data = response(await helper.run(JSON.stringify({ source })));
              if (version(data.version) !== selectedVersion) throw new Error("Go version changed during the scan.");
              return convert(source, data);
            } catch (cause) {
              throw new Error("Official Go extraction failed; no fallback was attempted.", { cause });
            }
          },
          close: () => helper.close(),
        };
      } catch {
        try { await prepared?.close(); } catch { /* Preserve the probe failure as a fallback reason. */ }
        failures.push(`${executable}: unavailable, incompatible or failed capability probe`);
      }
    }
  }
  const reason = mode === "builtin" ? "Built-in extraction was explicitly selected."
    : failures.length ? failures.join("; ") : "No Go executable was found on PATH.";
  if (mode === "official") throw new Error(`Official Go extraction is unavailable. ${reason}`);
  return { backend: { kind: "builtin", name: "debt-watcher-go", version: "1", reason },
    async extract(source) { checkSize(source); return extractGoComments(source); }, async close() {} };
}
