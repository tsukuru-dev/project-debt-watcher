import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

const lineBreak = (value: string | undefined) => value === "\n" || value === "\r";
const quote = (value: string | undefined) => value === '"' || value === "'";
// Python's lexical NAME boundary is broader than its validated identifier grammar.
const nameStart = (value: string | undefined) => value !== undefined && /[a-zA-Z_\u0080-\u{10ffff}]/u.test(value);
const namePart = (value: string | undefined) => nameStart(value) || (value !== undefined && /[0-9]/u.test(value));
const plainPrefixes = new Set(["r", "u", "b", "br", "rb"]);
const interpolationPrefixes = new Set(["f", "fr", "rf", "t", "tr", "rt"]);

class PythonFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) { super(message); }
}

/** Python 3 comment extraction; interpolation is explicitly deferred, never skipped as plain text. */
export function extractPythonComments(source: string): CommentExtraction {
  const { position, comment } = commentSource(source, lineBreak);
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (status: PythonFailure["status"], message: string, offset = index): never => {
    throw new PythonFailure(status, offset, message);
  };
  const newline = () => {
    if (source[index] === "\r" && source[index + 1] === "\n") index++;
    index++;
  };
  const quoted = () => {
    const start = index;
    const delimiter = source.startsWith(source[index]!.repeat(3), index) ? source[index]!.repeat(3) : source[index]!;
    index += delimiter.length;
    while (index < source.length) {
      if (source.startsWith(delimiter, index)) { index += delimiter.length; return; }
      if (source[index] === "\\") {
        // Even raw strings use backslashes when deciding whether a quote ends the literal.
        index++;
        if (index >= source.length) break;
        if (lineBreak(source[index])) newline(); else index++;
      } else {
        if (delimiter.length === 1 && lineBreak(source[index])) fail("invalid", "Unterminated Python string.", start);
        index++;
      }
    }
    fail("invalid", "Unterminated Python string.", start);
  };
  try {
    const nul = source.indexOf("\0");
    if (nul >= 0) fail("invalid", "NUL is not allowed in Python source.", nul);
    // The Git layer decodes UTF-8 only. Honour active encoding cookies rather than
    // interpreting differently encoded source as if it had identical token boundaries.
    let lineStart = index;
    for (let line = 0; line < 2; line++) {
      let end = lineStart;
      while (end < source.length && !lineBreak(source[end])) end++;
      const text = source.slice(lineStart, end);
      const cookie = /^[ \t\f]*#[^\r\n]*?coding[:=][ \t]*([-\w.]+)/u.exec(text);
      if (cookie) {
        if (!/^utf-?8$/iu.test(cookie[1]!.replaceAll("_", "-"))) {
          fail("unsupported", "Python encoding declarations other than UTF-8 are not supported.", lineStart);
        }
        break;
      }
      if (!/^[ \t\f]*(?:#[^\r\n]*)?$/u.test(text) || end === source.length) break;
      lineStart = end + (source[end] === "\r" && source[end + 1] === "\n" ? 2 : 1);
    }
    while (index < source.length) {
      if (source[index] === "#") {
        const start = index++;
        while (index < source.length && !lineBreak(source[index])) index++;
        comments.push(comment("line", start, index, start + 1, index));
        continue;
      }
      if (quote(source[index])) { quoted(); continue; }
      if (nameStart(source[index])) {
        const start = index++;
        while (namePart(source[index])) index++;
        const prefix = source.slice(start, index).toLowerCase();
        if (quote(source[index])) {
          if (interpolationPrefixes.has(prefix)) {
            fail("unsupported", "Python f-strings and template strings need expression-aware extraction in a later chunk.", start);
          }
          if (plainPrefixes.has(prefix)) quoted();
        }
        continue;
      }
      if (source[index] === "\\") {
        const start = index++;
        if (!lineBreak(source[index])) fail("invalid", "A Python line-joining backslash must be followed by a newline.", start);
        newline();
        continue;
      }
      if (source[index] === "`") fail("unsupported", "Python 2 backtick expressions are not supported.");
      index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof PythonFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
