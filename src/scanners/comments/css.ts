import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

const lineBreak = (value: string | undefined) => value !== undefined && /[\r\n\f]/u.test(value);
const whitespace = (value: string | undefined) => value !== undefined && /[\t\n\f\r ]/u.test(value);
const hex = (value: string | undefined) => value !== undefined && /[0-9a-fA-F]/u.test(value);
// CSS Syntax's ident-start set (not JavaScript's Unicode identifier categories).
const nameStart = (value: string | undefined) => value !== undefined
  && /[a-zA-Z_\u00b7\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{10ffff}]/u.test(value);
const namePart = (value: string | undefined) => nameStart(value) || (value !== undefined && /[0-9-]/u.test(value));
const numeric = /[+-]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?/y;

class CssFailure extends Error {
  constructor(readonly offset: number, message: string) { super(message); }
}

/** Extract plain CSS comments without interpreting declarations or loading URLs. */
export function extractCssComments(source: string): CommentExtraction {
  const { position, comment } = commentSource(source, lineBreak);
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string, offset = index): never => { throw new CssFailure(offset, message); };
  // CSS preprocessing replaces NUL and lone surrogates, but never changes source offsets here.
  const point = (at = index): string | undefined => {
    const value = source.codePointAt(at);
    if (value === undefined) return undefined;
    return value === 0 || (value >= 0xd800 && value <= 0xdfff) ? "\ufffd" : String.fromCodePoint(value);
  };
  const validEscape = (at: number) => source[at] === "\\" && !lineBreak(source[at + 1]);
  const startsName = (at: number): boolean => nameStart(point(at)) || validEscape(at)
    || (source[at] === "-" && (nameStart(point(at + 1)) || source[at + 1] === "-" || validEscape(at + 1)));
  const skipWhitespace = () => { while (whitespace(source[index])) index++; };
  const escape = (): string => {
    const start = index++;
    if (index >= source.length || lineBreak(source[index])) fail("Invalid CSS escape.", start);
    if (hex(source[index])) {
      const digits = index;
      while (index - digits < 6 && hex(source[index])) index++;
      const value = Number.parseInt(source.slice(digits, index), 16);
      if (whitespace(source[index])) {
        if (source[index] === "\r" && source[index + 1] === "\n") index++;
        index++;
      }
      return value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)
        ? "\ufffd" : String.fromCodePoint(value);
    }
    const value = point()!;
    index += value.length;
    return value;
  };
  const name = (): string => {
    let value = "";
    while (index < source.length) {
      if (namePart(point())) { const c = point()!; value += c; index += c.length; }
      else if (validEscape(index)) value += escape();
      else break;
    }
    return value;
  };
  const quoted = () => {
    const start = index, quote = source[index++];
    while (index < source.length) {
      if (source[index] === quote) { index++; return; }
      if (lineBreak(source[index])) fail("Unterminated CSS string.", start);
      if (source[index] === "\\") {
        if (lineBreak(source[index + 1])) {
          index++;
          if (source[index] === "\r" && source[index + 1] === "\n") index++;
          index++;
        } else escape();
      } else index++;
    }
    fail("Unterminated CSS string.", start);
  };
  const url = (start: number) => {
    skipWhitespace();
    // Quoted url() is a normal function containing a string; comments after it are real.
    if (source[index] === '"' || source[index] === "'") return;
    while (index < source.length) {
      const c = source[index]!;
      if (c === ")") { index++; return; }
      if (whitespace(c)) {
        skipWhitespace();
        if (source[index] === ")") { index++; return; }
        fail("Whitespace inside an unquoted CSS URL.", start);
      }
      if (c === '"' || c === "'" || c === "(" || /[\u0001-\u0008\u000b\u000e-\u001f\u007f]/u.test(c)) {
        fail("Invalid unquoted CSS URL.", start);
      }
      if (c === "\\") escape(); else index++;
    }
    fail("Unterminated CSS URL.", start);
  };
  try {
    while (index < source.length) {
      if (source.startsWith("/*", index)) {
        const start = index, close = source.indexOf("*/", index + 2);
        if (close < 0) fail("Unterminated CSS block comment.", start);
        index = close + 2;
        comments.push(comment("block", start, index, start + 2, close));
        continue;
      }
      if (source[index] === '"' || source[index] === "'") { quoted(); continue; }
      // Legacy stylesheet wrappers are tokens, not comments enclosing their contents.
      if (source.startsWith("<!--", index)) { index += 4; continue; }
      if (source.startsWith("-->", index)) { index += 3; continue; }
      // Consume names in hash/at-keyword/dimension tokens so their 'url' suffixes
      // cannot accidentally open an unquoted URL token and hide real comments.
      if (source[index] === "#" && (namePart(point(index + 1)) || validEscape(index + 1))) {
        index++; name(); continue;
      }
      if (source[index] === "@" && startsName(index + 1)) { index++; name(); continue; }
      numeric.lastIndex = index;
      const number = numeric.exec(source);
      if (number) {
        index += number[0].length;
        if (startsName(index)) name();
        else if (source[index] === "%") index++;
        continue;
      }
      if (startsName(index)) {
        const start = index, value = name();
        if (source[index] === "(") {
          index++;
          if (/^[uU][rR][lL]$/u.test(value)) url(start);
        }
        continue;
      }
      if (source[index] === "\\") fail("Invalid CSS escape.");
      index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof CssFailure)) throw error;
    return { status: "invalid", comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
