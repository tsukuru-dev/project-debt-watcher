import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

type CFamily = "c" | "cpp";
const identifier = (value: string | undefined) => value !== undefined && /[a-zA-Z0-9_]/u.test(value);
const newline = (value: string | undefined) => value === "\r" || value === "\n";

class CFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) {
    super(message);
  }
}

/** A bounded C/C++ comment lexer; it does not preprocess or compile source. */
export function extractCComments(source: string, language: CFamily): CommentExtraction {
  const { position, comment } = commentSource(source, newline);
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let lineStart = index;
  const fail = (status: CFailure["status"], message: string, offset = index): never => {
    throw new CFailure(status, offset, message);
  };
  const updateLineStart = (through: number): void => {
    const last = Math.max(source.lastIndexOf("\n", through - 1), source.lastIndexOf("\r", through - 1));
    if (last >= lineStart) lineStart = last + 1;
  };

  const quoted = (quote: string): void => {
    const start = index++;
    while (index < source.length) {
      if (source[index] === "\\") { index += 2; continue; }
      if (source[index] === quote) { index++; return; }
      if (newline(source[index])) fail("invalid", "Unterminated C/C++ quoted literal.", start);
      index++;
    }
    fail("invalid", "Unterminated C/C++ quoted literal.", start);
  };

  const rawString = (): boolean => {
    if (language !== "cpp" || (index > 0 && identifier(source[index - 1]))) return false;
    const opening = /^(?:u8|u|U|L)?R"/u.exec(source.slice(index));
    if (!opening) return false;
    const start = index;
    const delimiterStart = index + opening[0].length;
    const parenthesis = source.indexOf("(", delimiterStart);
    if (parenthesis < 0 || /[\r\n]/u.test(source.slice(delimiterStart, parenthesis))) {
      fail("invalid", "Unterminated C++ raw-string delimiter.", start);
    }
    const delimiter = source.slice(delimiterStart, parenthesis);
    if (delimiter.length > 16 || /[ ()\\\t\v\f\r\n]/u.test(delimiter)) {
      fail("invalid", "Invalid C++ raw-string delimiter.", start);
    }
    const close = source.indexOf(`)${delimiter}"`, parenthesis + 1);
    if (close < 0) fail("invalid", "Unterminated C++ raw string.", start);
    index = close + delimiter.length + 2;
    updateLineStart(index);
    return true;
  };

  try {
    // Translation-phase line splicing can change whether delimiters form or where
    // a // comment ends. Reject it until source-offset-preserving support exists.
    const splice = /\\[ \t]*(?:\r\n|\r|\n)|\?\?\//u.exec(source);
    if (splice) fail("unsupported", "C/C++ line splicing or trigraphs need preprocessing-aware extraction.", splice.index);

    while (index < source.length) {
      if (newline(source[index])) {
        if (source[index] === "\r" && source[index + 1] === "\n") index++;
        index++;
        lineStart = index;
        continue;
      }
      if (source[index] === "#" && /^[ \t]*$/u.test(source.slice(lineStart, index))) {
        const rest = source.slice(index, source.indexOf("\n", index) < 0 ? source.length : source.indexOf("\n", index));
        if (/^#\s*include\b/u.test(rest)) {
          const header = /^#\s*include[ \t]+(?:<([^>\r\n]*)>|"([^"\r\n]*)")/u.exec(rest);
          if (!header) return fail("unsupported", "Complex #include syntax needs a preprocessing-aware scanner.");
          const name = header[1] ?? header[2] ?? "";
          if (name.includes("//") || name.includes("/*")) {
            fail("unsupported", "Comment-like text inside a header name has implementation-defined meaning.");
          }
          index += header[0].length;
          continue;
        }
      }
      if (source.startsWith("__has_include", index) && !identifier(source[index + 13])) {
        fail("unsupported", "__has_include header names need preprocessing-aware extraction.");
      }
      if (language === "cpp" && source.startsWith("import", index)
        && !identifier(source[index - 1]) && /^[ \t]+[<"]/u.test(source.slice(index + 6))) {
        fail("unsupported", "C++ header imports need preprocessing-aware extraction.");
      }
      if (rawString()) continue;
      if (source[index] === '"' || source[index] === "'") { quoted(source[index]!); continue; }
      if (source.startsWith("//", index)) {
        const start = index;
        index += 2;
        while (index < source.length && !newline(source[index])) index++;
        comments.push(comment("line", start, index, start + 2, index));
        continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index;
        const close = source.indexOf("*/", index + 2);
        if (close < 0) fail("invalid", "Unterminated C/C++ block comment.", start);
        index = close + 2;
        updateLineStart(index);
        comments.push(comment("block", start, index, start + 2, close));
        continue;
      }
      index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof CFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
