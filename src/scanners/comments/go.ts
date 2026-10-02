import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

class GoFailure extends Error {
  constructor(readonly offset: number, message: string) { super(message); }
}

/** Common UTF-8 source restrictions before either Go backend runs. */
export function goSourceDiagnostic(source: string): CommentExtraction | undefined {
  const { position } = commentSource(source, (c) => c === "\n");
  for (let at = 0; at < source.length;) {
    const point = source.codePointAt(at)!;
    const message = point === 0 ? "NUL is not allowed in Go source."
      : point === 0xfeff && at !== 0 ? "A Go byte order mark is only permitted at the start of the source."
        : point >= 0xd800 && point <= 0xdfff ? "Go source contains an unpaired Unicode surrogate." : undefined;
    if (message) return { status: "invalid", comments: [], diagnostic: { message, position: position(at) } };
    at += point > 0xffff ? 2 : 1;
  }
  return undefined;
}

/** Go comment lexer. Never invokes Go, applies directives, or executes scanned source. */
export function extractGoComments(source: string): CommentExtraction {
  // Go counts LF as a newline; bare CR is whitespace, not a line boundary.
  const { position, comment } = commentSource(source, (c) => c === "\n");
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string, offset = index): never => { throw new GoFailure(offset, message); };
  const escape = (delimiter: string) => {
    const start = index++;
    const c = source[index];
    if (c !== undefined && ("abfnrtv\\".includes(c) || c === delimiter)) { index++; return; }
    let count: number, base: number;
    if (c !== undefined && /[0-7]/u.test(c)) { count = 3; base = 8; }
    else if (c === "x" || c === "u" || c === "U") {
      count = c === "x" ? 2 : c === "u" ? 4 : 8;
      base = 16;
      index++;
    } else return fail("Invalid Go escape sequence.", start);
    const digits = source.slice(index, index + count);
    const valid = base === 8 ? /^[0-7]+$/u : /^[0-9a-fA-F]+$/u;
    if (digits.length !== count || !valid.test(digits)) fail("Incomplete or invalid Go numeric escape.", start);
    const value = Number.parseInt(digits, base);
    if ((base === 8 && value > 255) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
      fail("Go escape value is outside its allowed range.", start);
    }
    index += count;
  };
  const quoted = () => {
    const start = index, delimiter = source[index++]!;
    let characters = 0;
    while (index < source.length) {
      if (source[index] === delimiter) {
        index++;
        if (delimiter === "'" && characters !== 1) fail("A Go rune literal must contain exactly one character or escape.", start);
        return;
      }
      if (source[index] === "\n") fail("Unterminated Go string or rune literal.", start);
      if (source[index] === "\\") escape(delimiter);
      else index += source.codePointAt(index)! > 0xffff ? 2 : 1;
      characters++;
    }
    fail("Unterminated Go string or rune literal.", start);
  };
  try {
    const sourceIssue = goSourceDiagnostic(source);
    if (sourceIssue) return sourceIssue;
    while (index < source.length) {
      if (source.startsWith("//", index)) {
        const start = index;
        const lf = source.indexOf("\n", index + 2);
        index = lf < 0 ? source.length : lf;
        // Exclude CRLF as a line terminator, retaining all other source CRs.
        const end = lf >= 0 && source[index - 1] === "\r" ? index - 1 : index;
        comments.push(comment("line", start, end, start + 2, end));
        continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index, close = source.indexOf("*/", index + 2);
        if (close < 0) fail("Unterminated Go block comment.", start);
        index = close + 2;
        comments.push(comment("block", start, index, start + 2, close));
        continue;
      }
      if (source[index] === "`") {
        const start = index, close = source.indexOf("`", index + 1);
        if (close < 0) fail("Unterminated Go raw string.", start);
        index = close + 1;
        continue;
      }
      if (source[index] === '"' || source[index] === "'") { quoted(); continue; }
      index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof GoFailure)) throw error;
    return { status: "invalid", comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
