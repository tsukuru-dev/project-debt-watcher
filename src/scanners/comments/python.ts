import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

const lineBreak = (value: string | undefined) => value === "\n" || value === "\r";
const quote = (value: string | undefined) => value === '"' || value === "'";
// Python's lexical NAME boundary is broader than its validated identifier grammar.
const nameStart = (value: string | undefined) => value !== undefined && /[a-zA-Z_\u0080-\u{10ffff}]/u.test(value);
const namePart = (value: string | undefined) => nameStart(value) || (value !== undefined && /[0-9]/u.test(value));
const plainPrefixes = new Set(["r", "u", "b", "br", "rb"]);
const interpolationPrefixes = new Set(["f", "fr", "rf", "t", "tr", "rt"]);
const maxNesting = 128;

interface PythonString {
  start: number;
  delimiter: string;
  raw: boolean;
  interpolated: boolean;
}

class PythonFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) { super(message); }
}

/** Python 3 lexical comment extraction, including Python 3.12+ f-strings and 3.14 t-strings. */
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
  const checkDepth = (depth: number) => {
    if (depth >= maxNesting) fail("unsupported", "Python interpolation nesting exceeds the built-in scanner's limit of 128.");
  };
  const lineComment = () => {
    const start = index++;
    while (index < source.length && !lineBreak(source[index])) index++;
    comments.push(comment("line", start, index, start + 1, index));
  };
  const continuation = () => {
    const start = index++;
    if (!lineBreak(source[index])) fail("invalid", "A Python line-joining backslash must be followed by a newline.", start);
    newline();
  };
  const escape = (literal: PythonString) => {
    const start = index++;
    // A backslash never escapes an interpolation brace, including in raw strings.
    if (literal.interpolated && (source[index] === "{" || source[index] === "}")) return;
    if (literal.interpolated && !literal.raw && source.startsWith("N{", index)) {
      index += 2;
      const name = index;
      while (index < source.length && source[index] !== "}") {
        if (quote(source[index]) || source[index] === "{" || source[index] === "\\" || lineBreak(source[index])) {
          fail("invalid", "Malformed Python named Unicode escape.", start);
        }
        index++;
      }
      if (index === source.length || index === name) fail("invalid", "Malformed Python named Unicode escape.", start);
      index++;
      return;
    }
    // Even raw strings use backslashes when deciding whether a quote ends a literal.
    if (lineBreak(source[index])) newline(); else if (index < source.length) index++;
  };
  function quoted(prefix = "", depth = 0): void {
    checkDepth(depth);
    const delimiter = source.startsWith(source[index]!.repeat(3), index) ? source[index]!.repeat(3) : source[index]!;
    const literal: PythonString = { start: index, delimiter, raw: prefix.includes("r"), interpolated: interpolationPrefixes.has(prefix) };
    index += delimiter.length;
    literalText(literal, false, depth);
  }
  function literalText(literal: PythonString, format: boolean, depth: number): void {
    while (index < source.length) {
      if (source.startsWith(literal.delimiter, index)) {
        if (format) fail("invalid", "Unclosed Python replacement field.");
        index += literal.delimiter.length;
        return;
      }
      if (literal.delimiter.length === 1 && lineBreak(source[index])) {
        fail("invalid", "Unterminated Python string or single-quoted format specifier.", literal.start);
      }
      if (source[index] === "\\") { escape(literal); continue; }
      if (literal.interpolated && source[index] === "{") {
        // In a format specifier, even '{{' starts an expression (e.g. a dict).
        if (!format && source[index + 1] === "{") { index += 2; continue; }
        replacement(literal, depth + 1);
        continue;
      }
      if (literal.interpolated && source[index] === "}") {
        if (format) { index++; return; }
        if (source[index + 1] === "}") { index += 2; continue; }
        fail("invalid", "A literal closing brace in a Python interpolated string must be doubled.");
      }
      index++;
    }
    fail("invalid", format ? "Unclosed Python replacement field." : "Unterminated Python string.", literal.start);
  }
  // Shared token handling applies inside expressions as well as top-level code.
  function codeToken(depth: number): boolean {
    if (source[index] === "#") { lineComment(); return true; }
    if (quote(source[index])) { quoted("", depth); return true; }
    if (nameStart(source[index])) {
      const start = index++;
      while (namePart(source[index])) index++;
      const prefix = source.slice(start, index).toLowerCase();
      if (quote(source[index]) && (plainPrefixes.has(prefix) || interpolationPrefixes.has(prefix))) quoted(prefix, depth);
      return true;
    }
    if (source[index] === "\\") { continuation(); return true; }
    if (source[index] === "`") fail("unsupported", "Python 2 backtick expressions are not supported.");
    return false;
  }
  function replacement(literal: PythonString, depth: number): void {
    checkDepth(depth);
    const start = index++;
    const brackets: string[] = [];
    let hasExpression = false;
    let phase: "expression" | "debug" | "converted" = "expression";
    while (index < source.length) {
      const c = source[index]!;
      // Comments swallow braces and quotes up to the physical newline.
      if (c === "#") { lineComment(); continue; }
      if (/[ \t\f\r\n]/u.test(c)) { index++; continue; }
      if (c === "\\") { continuation(); continue; }
      if (brackets.length === 0) {
        if (c === "}" || c === ":" || (c === "!" && source[index + 1] !== "=")) {
          if (!hasExpression) fail("invalid", "A Python replacement field requires an expression.", start);
          if (c === "}") { index++; return; }
          if (c === ":") { index++; literalText(literal, true, depth); return; }
          if (phase === "converted" || !/[sra]/u.test(source[index + 1] ?? "")) {
            fail("invalid", "A Python replacement conversion must be !s, !r or !a.");
          }
          index += 2;
          phase = "converted";
          continue;
        }
        if (phase !== "expression") fail("invalid", "Unexpected text after a Python replacement debug/conversion specifier.");
        if (c === "=" && source[index + 1] !== "=") {
          if (!hasExpression) fail("invalid", "A Python debug field requires an expression.", start);
          index++;
          phase = "debug";
          continue;
        }
      }
      hasExpression = true;
      if (codeToken(depth + 1)) continue;
      if (c === "(" || c === "[" || c === "{") {
        if (brackets.length >= maxNesting) fail("unsupported", "Python expression bracket nesting exceeds 128.");
        brackets.push(c === "(" ? ")" : c === "[" ? "]" : "}");
      } else if (c === ")" || c === "]" || c === "}") {
        if (brackets.pop() !== c) fail("invalid", "Mismatched bracket in a Python replacement expression.");
      } else if (/[!<>=]/u.test(c) && source[index + 1] === "=") {
        // Consume equality/comparison operators together; their '=' is not debugging syntax.
        index += 2;
        continue;
      }
      index++;
    }
    fail("invalid", "Unclosed Python replacement field.", start);
  }
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
      if (!codeToken(0)) index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof PythonFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
