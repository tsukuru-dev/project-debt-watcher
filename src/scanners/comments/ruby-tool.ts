import { isAbsolute } from "node:path";
import { extractRubyComments, rubySourceDiagnostic } from "./ruby.js";
import { rubyHelper } from "./ruby-helper.js";
import { systemRubyRuntime, type RubyRuntime } from "./ruby-runtime.js";
import { commentSource } from "./source.js";
import type { CommentExtraction } from "./types.js";

export interface RubyExtractorOptions {
  mode?: "auto" | "official" | "builtin";
  executable?: string;
  env?: NodeJS.ProcessEnv;
}
export interface RubyCommentExtractor {
  backend: { kind: "official"; name: "ruby-ripper"; version: string; executable: string }
    | { kind: "builtin"; name: "debt-finder-ruby"; version: "1"; reason: string };
  extract(source: string): Promise<CommentExtraction>;
}
function response(output: string): Record<string, unknown> {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value) || !("protocol" in value) || value.protocol !== 1) {
    throw new Error("Invalid Ruby helper response.");
  }
  return value as Record<string, unknown>;
}
function version(value: unknown): string {
  if (typeof value !== "string" || !/^3\.[1-4]\.\d+$/u.test(value)) throw new Error("Supported Ruby versions are 3.1-3.4.");
  return value;
}
function checkSize(source: string): void {
  if (Buffer.byteLength(source, "utf8") > 8 * 1024 * 1024) throw new Error("Ruby extraction source exceeds 8 MiB.");
}

function convert(source: string, data: Record<string, unknown>): CommentExtraction {
  const { position, comment } = commentSource(source, (c) => c === "\n");
  if (data.status === "invalid") {
    if (typeof data.message !== "string" || !data.message) throw new Error("Missing Ruby diagnostic.");
    return { status: "invalid", comments: [], diagnostic: { message: data.message, position: position(0) } };
  }
  if (data.status !== "ok" || !Array.isArray(data.spans)) throw new Error("Invalid Ruby comment response.");
  // Only map requested byte boundaries, avoiding a per-character map for large sources.
  const wanted = new Set<number>();
  for (const span of data.spans) {
    if (!Array.isArray(span) || span.length !== 5 || !["line", "block"].includes(span[0])
      || !span.slice(1).every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0)) {
      throw new Error("Invalid Ruby comment span.");
    }
    for (const n of span.slice(1)) wanted.add(n);
  }
  const offsets = new Map<number, number>();
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0, bytes = 0;
  if (wanted.has(0)) offsets.set(0, index);
  for (const c of source.slice(index)) {
    bytes += Buffer.byteLength(c, "utf8"); index += c.length;
    if (wanted.has(bytes)) offsets.set(bytes, index);
  }
  let previousEnd = -1;
  const comments = data.spans.map((entry: unknown) => {
    // Shape and integer checks were completed above before converting any positions.
    const span = entry as ["line" | "block", number, number, number, number];
    const [start, end, bodyStart, bodyEnd] = [span[1], span[2], span[3], span[4]].map((n) => offsets.get(n));
    if (start === undefined || end === undefined || bodyStart === undefined || bodyEnd === undefined
      || start < previousEnd || end <= start || bodyStart < start || bodyEnd < bodyStart || end < bodyEnd) {
      throw new Error("Ruby span is outside the source or not on a UTF-8 boundary.");
    }
    const raw = source.slice(start, end);
    if (span[0] === "line") {
      if (!raw.startsWith("#") || /[\r\n]/u.test(raw) || bodyStart !== start + 1 || bodyEnd !== end
        || (end < source.length && source[end] !== "\r" && source[end] !== "\n")) throw new Error("Invalid Ruby line comment boundaries.");
    } else {
      if ((start > 0 && source[start - 1] !== "\n" && !(start === 1 && source[0] === "\ufeff"))
        || !/^=begin(?:[ \t\r\n\f\v]|$)/u.test(raw)
        || bodyStart !== source.indexOf("\n", start) + 1 || source[bodyEnd - 1] !== "\n"
        || !/^=end(?:[ \t\f\v][^\r\n]*)?$/u.test(source.slice(bodyEnd, end))) throw new Error("Invalid Ruby block comment boundaries.");
    }
    previousEnd = end;
    return comment(span[0], start, end, bodyStart, bodyEnd);
  });
  return { status: "ok", comments };
}

/** Select once; a runtime/source failure after selection never silently changes extractors. */
export async function createRubyCommentExtractor(options: RubyExtractorOptions = {},
  runtime: RubyRuntime = systemRubyRuntime): Promise<RubyCommentExtractor> {
  const mode = options.mode ?? "auto", env = { ...(options.env ?? process.env) };
  if (!["auto", "official", "builtin"].includes(mode)) throw new Error("Unknown Ruby extraction mode.");
  if (options.executable !== undefined && (!isAbsolute(options.executable) || mode === "builtin")) {
    throw new Error("An explicit Ruby executable must be absolute and requires auto or official mode.");
  }
  const failures: string[] = [];
  if (mode !== "builtin") {
    const candidates = options.executable ? [options.executable] : await runtime.discover(env);
    for (const executable of candidates) {
      let selectedVersion: string;
      try {
        const probe = response(await runtime.run(executable, rubyHelper, JSON.stringify({ probe: true }), env));
        selectedVersion = version(probe.version);
        if (probe.compatible !== true || probe.status !== "ok") throw new Error("Ripper capability check failed.");
      } catch {
        failures.push(`${executable}: unavailable, incompatible or failed capability probe`);
        continue;
      }
      return {
        backend: { kind: "official", name: "ruby-ripper", version: selectedVersion, executable },
        async extract(source) {
          checkSize(source);
          const issue = rubySourceDiagnostic(source); if (issue) return issue;
          try {
            const data = response(await runtime.run(executable, rubyHelper,
              JSON.stringify({ source: source.replace(/^\ufeff/u, "") }), env));
            if (version(data.version) !== selectedVersion) throw new Error("Ruby version changed during this scan.");
            return convert(source, data);
          } catch (cause) { throw new Error("Official Ruby extraction failed; no fallback was attempted.", { cause }); }
        },
      };
    }
  }
  const reason = mode === "builtin" ? "Built-in extraction was explicitly selected."
    : failures.length ? failures.join("; ") : "No Ruby executable was found on PATH.";
  if (mode === "official") throw new Error(`Official Ruby extraction is unavailable. ${reason}`);
  return { backend: { kind: "builtin", name: "debt-finder-ruby", version: "1", reason },
    async extract(source) { checkSize(source); return extractRubyComments(source); } };
}
