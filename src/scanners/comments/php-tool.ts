import { isAbsolute } from "node:path";
import { extractHtmlComments } from "./html.js";
import { phpHelper } from "./php-helper.js";
import { extractPhpComments } from "./php.js";
import { systemPhpRuntime, type PhpRuntime } from "./php-runtime.js";
import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

export interface PhpExtractorOptions {
  mode?: "auto" | "official" | "builtin";
  executable?: string;
  env?: NodeJS.ProcessEnv;
}
export interface PhpCommentExtractor {
  backend: { kind: "official"; name: "php-token-get-all"; version: string; executable: string }
    | { kind: "builtin"; name: "debt-finder-php"; version: "1"; reason: string };
  extract(source: string): Promise<CommentExtraction>;
}

const probeSource = "<!-- html --><?php $s = <<<'TXT'\n// hidden\nTXT;\n// line\n/** block */ ?> <!-- tail -->";

function checkSize(source: string): void {
  if (Buffer.byteLength(source, "utf8") > 8 * 1024 * 1024) throw new Error("PHP extraction source exceeds 8 MiB.");
}
function response(output: string): Record<string, unknown> {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value) || !("protocol" in value) || value.protocol !== 1) {
    throw new Error("Invalid PHP helper response.");
  }
  return value as Record<string, unknown>;
}
function version(value: unknown): string {
  if (typeof value !== "string" || !/^8\.\d+\.\d+$/u.test(value)) {
    throw new Error("Supported official PHP versions are stable PHP 8.x releases.");
  }
  return value;
}

function convert(source: string, data: Record<string, unknown>): CommentExtraction {
  const { position, comment } = commentSource(source, (value) => value === "\r" || value === "\n");
  if (data.status === "invalid") {
    if (typeof data.message !== "string" || !data.message) throw new Error("Missing PHP syntax diagnostic.");
    return { status: "invalid", comments: [], diagnostic: { message: data.message, position: position(0) } };
  }
  if (data.status !== "ok" || !Array.isArray(data.spans) || !Array.isArray(data.inline)) {
    throw new Error("Invalid PHP comment response.");
  }

  const wanted = new Set<number>([0]);
  for (const entry of data.spans) {
    if (!Array.isArray(entry) || entry.length !== 5 || !["line", "block"].includes(entry[0])
      || !entry.slice(1).every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0)) {
      throw new Error("Invalid PHP comment span.");
    }
    for (const n of entry.slice(1)) wanted.add(n);
  }
  for (const entry of data.inline) {
    if (!Array.isArray(entry) || entry.length !== 2
      || !entry.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0)) {
      throw new Error("Invalid PHP inline-HTML span.");
    }
    for (const n of entry) wanted.add(n);
  }
  const offsets = new Map<number, number>([[0, 0]]);
  let character = 0, bytes = 0;
  for (const value of source) {
    character += value.length;
    bytes += Buffer.byteLength(value, "utf8");
    if (wanted.has(bytes)) offsets.set(bytes, character);
  }
  const mapped = (byte: number): number => {
    const offset = offsets.get(byte);
    if (offset === undefined) throw new Error("PHP span is outside the source or inside a UTF-8 character.");
    return offset;
  };

  let previousEnd = -1;
  const phpComments: SourceComment[] = data.spans.map((entry: unknown) => {
    const span = entry as ["line" | "block", number, number, number, number];
    const [start, end, bodyStart, bodyEnd] = [mapped(span[1]), mapped(span[2]), mapped(span[3]), mapped(span[4])];
    if (start === undefined || end === undefined || bodyStart === undefined || bodyEnd === undefined
      || start < previousEnd || end <= start || bodyStart < start || bodyEnd < bodyStart || bodyEnd > end) {
      throw new Error("Invalid PHP comment boundaries.");
    }
    const raw = source.slice(start, end);
    if (span[0] === "line") {
      const width = raw.startsWith("//") ? 2 : raw.startsWith("#") ? 1 : 0;
      if (!width || bodyStart !== start + width || bodyEnd !== end || /[\r\n]/u.test(raw)
        || (end < source.length && !/[\r\n]/u.test(source[end]!) && !source.startsWith("?>", end))) {
        throw new Error("Invalid PHP line comment boundaries.");
      }
    } else if (!raw.startsWith("/*") || !raw.endsWith("*/") || bodyStart !== start + 2 || bodyEnd !== end - 2) {
      throw new Error("Invalid PHP block comment boundaries.");
    }
    previousEnd = end;
    return comment(span[0], start, end, bodyStart, bodyEnd);
  });

  let previousInlineEnd = -1;
  const inline = data.inline.map((entry: unknown) => {
    const span = entry as [number, number];
    const start = mapped(span[0]), end = mapped(span[1]);
    if (start < previousInlineEnd || end <= start) throw new Error("Invalid PHP inline-HTML boundaries.");
    previousInlineEnd = end;
    return { start, end };
  });
  if (phpComments.some((item) => inline.some((span) => span.start < item.end.offset && item.start.offset < span.end))) {
    throw new Error("PHP comment overlaps inline HTML.");
  }

  const masked = source.split("");
  let next = 0;
  for (const span of inline) {
    for (let at = next; at < span.start; at++) {
      if (source[at] !== "\r" && source[at] !== "\n") masked[at] = " ";
    }
    next = span.end;
  }
  for (let at = next; at < source.length; at++) {
    if (source[at] !== "\r" && source[at] !== "\n") masked[at] = " ";
  }
  const html = extractHtmlComments(masked.join(""));
  if (html.status !== "ok") return html;
  const htmlComments: SourceComment[] = [];
  for (const entry of html.comments) {
    if (!inline.some((span) => span.start <= entry.start.offset && entry.end.offset <= span.end)) {
      return { status: "unsupported", comments: [], diagnostic: {
        message: "HTML comment overlaps PHP code and needs mixed-language handling.",
        position: position(entry.start.offset),
      } };
    }
    htmlComments.push(comment("block", entry.start.offset, entry.end.offset,
      entry.contentStart.offset, entry.contentEnd.offset));
  }
  const comments = [...phpComments, ...htmlComments];
  comments.sort((a, b) => a.start.offset - b.start.offset);
  return { status: "ok", comments };
}

/** Select an existing PHP tokenizer once; failures after selection never switch backends. */
export async function createPhpCommentExtractor(options: PhpExtractorOptions = {},
  runtime: PhpRuntime = systemPhpRuntime): Promise<PhpCommentExtractor> {
  const mode = options.mode ?? "auto", env = { ...(options.env ?? process.env) };
  if (!["auto", "official", "builtin"].includes(mode)) throw new Error("Unknown PHP extraction mode.");
  if (options.executable !== undefined && (!isAbsolute(options.executable) || mode === "builtin")) {
    throw new Error("An explicit PHP executable must be absolute and requires auto or official mode.");
  }
  const failures: string[] = [];
  if (mode !== "builtin") {
    const candidates = options.executable ? [options.executable] : await runtime.discover(env);
    for (const executable of candidates) {
      let selectedVersion: string;
      try {
        const probe = response(await runtime.run(executable, phpHelper, JSON.stringify({ source: probeSource }), env));
        selectedVersion = version(probe.version);
        const result = convert(probeSource, probe);
        if (result.status !== "ok" || result.comments.map((item) => item.text).join("|")
          !== " html | line|* block | tail ") throw new Error("PHP tokenizer capability check failed.");
      } catch {
        failures.push(`${executable}: unavailable, incompatible or failed capability probe`);
        continue;
      }
      return {
        backend: { kind: "official", name: "php-token-get-all", version: selectedVersion, executable },
        async extract(source) {
          checkSize(source);
          try {
            const data = response(await runtime.run(executable, phpHelper, JSON.stringify({ source }), env));
            if (version(data.version) !== selectedVersion) throw new Error("PHP version changed during this scan.");
            return convert(source, data);
          } catch (cause) { throw new Error("Official PHP extraction failed; no fallback was attempted.", { cause }); }
        },
      };
    }
  }
  const reason = mode === "builtin" ? "Built-in extraction was explicitly selected."
    : failures.length ? failures.join("; ") : "No PHP executable was found on PATH.";
  if (mode === "official") throw new Error(`Official PHP extraction is unavailable. ${reason}`);
  return { backend: { kind: "builtin", name: "debt-finder-php", version: "1", reason },
    async extract(source) { checkSize(source); return extractPhpComments(source); } };
}
