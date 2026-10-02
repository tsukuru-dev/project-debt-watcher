import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

const nameStart = (c: string | undefined) => c !== undefined && /[_\p{ID_Start}]/u.test(c);
const namePart = (c: string | undefined) => c !== undefined && /[_\p{ID_Continue}]/u.test(c);
const hex = (c: string | undefined) => c !== undefined && /[0-9a-fA-F]/u.test(c);

class RustFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) { super(message); }
}

/** Extract Rust comments from source text without invoking a compiler or expanding macros. */
export function extractRustComments(source: string): CommentExtraction {
  const { position, comment } = commentSource(source, (c) => c === "\n");
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string, offset = index, status: RustFailure["status"] = "invalid"): never => {
    throw new RustFailure(status, offset, message);
  };
  const raw = (prefix: "r" | "br" | "cr") => {
    const start = index;
    index += prefix.length;
    const hashes = index;
    while (source[index] === "#") index++;
    const count = index - hashes;
    if (source[index] !== '"') {
      if (prefix === "r" && count === 1 && nameStart(source[index])) {
        index++;
        while (namePart(source[index])) index++;
        return; // r#identifier is a raw identifier, not a string.
      }
      if (count) fail("Malformed Rust raw string or raw identifier prefix.", start);
      return; // Ordinary identifier such as `raw`.
    }
    if (count > 255) fail("Rust raw string delimiter exceeds 255 hashes.", start);
    const close = '"' + "#".repeat(count);
    index++;
    while (index < source.length) {
      if (source.startsWith(close, index)) {
        index += close.length;
        if (source[index] === "#") fail("Extra hash after Rust raw string delimiter.", index);
        return;
      }
      if (source[index] === "\r" && source[index + 1] !== "\n") fail("Bare CR in a Rust raw string.");
      if (prefix === "cr" && source[index] === "\0") fail("NUL in a Rust C string.");
      if (prefix === "br" && source.codePointAt(index)! > 0x7f) fail("Non-ASCII character in a Rust raw byte string.");
      index++;
    }
    fail("Unterminated Rust raw string.", start);
  };
  const escape = (kind: "string" | "byte" | "c" | "char" | "byte-char") => {
    const start = index++;
    const c = source[index];
    if (c === undefined) fail("Unterminated Rust escape.", start);
    if (c === "\n" || (c === "\r" && source[index + 1] === "\n")) {
      if (kind.endsWith("char")) fail("Line continuation in a Rust character literal.", start);
      if (c === "\r") index++;
      index++;
      while (/[ \t\n\r]/u.test(source[index] ?? "") && index < source.length) index++;
      return;
    }
    if (c === "0" || c === "n" || c === "r" || c === "t" || c === "\\"
      || c === '"' || c === "'") {
      if (kind === "c" && c === "0") fail("NUL escape in a Rust C string.", start);
      index++;
      return;
    }
    if (c === "x") {
      if (!hex(source[index + 1]) || !hex(source[index + 2])) fail("Invalid Rust hexadecimal escape.", start);
      const value = Number.parseInt(source.slice(index + 1, index + 3), 16);
      if (kind === "c" && value === 0) fail("NUL escape in a Rust C string.", start);
      if ((kind === "string" || kind === "char") && value > 0x7f) fail("Rust character escape exceeds ASCII range.", start);
      index += 3;
      return;
    }
    if (c === "u" && kind !== "byte" && kind !== "byte-char") {
      if (source[index + 1] !== "{") fail("Invalid Rust Unicode escape.", start);
      index += 2;
      let digits = "", seen = 0;
      while (index < source.length && source[index] !== "}") {
        if (source[index] !== "_" && !hex(source[index])) fail("Invalid Rust Unicode escape.", start);
        if (source[index] !== "_") { digits += source[index]; seen++; }
        index++;
      }
      const value = Number.parseInt(digits, 16);
      if (source[index] !== "}" || seen < 1 || seen > 6 || value > 0x10ffff
        || (value >= 0xd800 && value <= 0xdfff) || (kind === "c" && value === 0)) {
        fail("Invalid Rust Unicode escape value.", start);
      }
      index++;
      return;
    }
    fail("Invalid Rust escape.", start);
  };
  const quoted = (kind: "string" | "byte" | "c" | "char" | "byte-char", prefixLength = 0) => {
    const start = index, delimiter = kind.endsWith("char") ? "'" : '"';
    index += prefixLength + 1;
    let characters = 0;
    while (index < source.length) {
      if (source[index] === delimiter) {
        index++;
        if (kind.endsWith("char") && characters !== 1) fail("Rust character literal must contain one character or escape.", start);
        return;
      }
      if (source[index] === "\r" && source[index + 1] === "\n") { index += 2; continue; }
      if (source[index] === "\r" || (kind.endsWith("char") && /[\n\t]/u.test(source[index]!))) {
        fail("Invalid newline or tab in a Rust literal.", start);
      }
      if (source[index] === "\\") escape(kind);
      else {
        const point = source.codePointAt(index)!;
        if ((kind === "byte" || kind === "byte-char") && point > 0x7f) fail("Non-ASCII character in a Rust byte literal.");
        if (kind === "c" && point === 0) fail("NUL in a Rust C string.");
        index += point > 0xffff ? 2 : 1;
      }
      characters++;
    }
    fail("Unterminated Rust literal.", start);
  };
  const characterOrLifetime = () => {
    const start = index;
    if (source.startsWith("'r#", index) && nameStart(source[index + 3])) {
      index += 4;
      while (namePart(source[index])) index++;
      return;
    }
    const next = source.codePointAt(index + 1);
    const endOfPoint = index + 1 + (next !== undefined && next > 0xffff ? 2 : 1);
    if (nameStart(source[index + 1]) && source[endOfPoint] !== "'") {
      index++;
      while (namePart(source[index])) index++;
      if (source[index] === "'") fail("Multi-character Rust character literal.", start);
      return;
    }
    quoted("char");
  };
  try {
    while (index < source.length) {
      if (source.startsWith("//", index)) {
        const start = index, lf = source.indexOf("\n", index + 2);
        index = lf < 0 ? source.length : lf;
        const end = lf >= 0 && source[index - 1] === "\r" ? index - 1 : index;
        if ((source.startsWith("///", start) && !source.startsWith("////", start)) || source.startsWith("//!", start)) {
          if (source.slice(start, end).includes("\r")) fail("Bare CR in a Rust doc comment.", start);
        }
        comments.push(comment("line", start, end, start + 2, end));
        continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index;
        let depth = 0;
        do {
          if (source.startsWith("/*", index)) {
            if (++depth > 128) fail("Rust block comment nesting exceeds 128 levels.", index, "unsupported");
            index += 2;
          } else if (source.startsWith("*/", index)) { depth--; index += 2; }
          else index++;
        } while (depth > 0 && index < source.length);
        if (depth !== 0) fail("Unterminated Rust block comment.", start);
        const rawText = source.slice(start, index);
        if ((rawText.startsWith("/*!") || (rawText.startsWith("/**") && !rawText.startsWith("/***")))
          && /\r(?!\n)/u.test(rawText)) fail("Bare CR in a Rust doc comment.", start);
        comments.push(comment("block", start, index, start + 2, index - 2));
        continue;
      }
      if (source[index] === '"') { quoted("string"); continue; }
      if (source[index] === "'") { characterOrLifetime(); continue; }
      if (nameStart(source[index])) {
        const start = index++;
        while (namePart(source[index])) index++;
        const name = source.slice(start, index);
        if ((name === "r" || name === "br" || name === "cr") && (source[index] === '"' || source[index] === "#")) {
          index = start;
          raw(name);
        } else if (source[index] === '"' && (name === "b" || name === "c")) {
          index = start;
          quoted(name === "b" ? "byte" : "c", 1);
        } else if (source[index] === "'" && name === "b") {
          index = start;
          quoted("byte-char", 1);
        }
        continue;
      }
      index++;
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof RustFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
