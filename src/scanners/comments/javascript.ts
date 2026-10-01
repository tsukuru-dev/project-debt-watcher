import type { SourceLanguage } from "./languages.js";
import type { CommentExtraction, SourceComment } from "./types.js";
import { commentSource } from "./source.js";

type Goal = "expression" | "operator" | "uncertain";
type Delimiter = { character: string; control: boolean };
const lineBreak = (value: string | undefined) => value !== undefined && /[\n\r\u2028\u2029]/u.test(value);
const identifierStart = (value: string | undefined) => value !== undefined && /[$_\p{ID_Start}]/u.test(value);
const identifierPart = (value: string | undefined) => value !== undefined && /[$_\u200c\u200d\p{ID_Continue}]/u.test(value);
const controls = new Set(["if", "while", "for", "with", "switch", "catch"]);
const prefixes = new Set(["return", "throw", "case", "delete", "void", "typeof", "new", "in", "instanceof", "else", "do", "extends"]);
const numeric = /(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?n?)/y;

class ScanFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) { super(message); }
}

/** A conservative lexer: it never evaluates code, resolves imports, or reads project configs. */
export function extractJavaScriptComments(source: string, language: SourceLanguage): CommentExtraction {
  const { position, comment } = commentSource(source, lineBreak);
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (status: ScanFailure["status"], message: string, offset = index): never => {
    throw new ScanFailure(status, offset, message);
  };
  const point = () => index < source.length ? String.fromCodePoint(source.codePointAt(index)!) : undefined;
  const addComment = (start: number, end: number, kind: SourceComment["kind"]) => {
    const bodyEnd = kind === "block" ? end - 2 : end;
    comments.push(comment(kind, start, end, start + 2, bodyEnd));
  };
  const quoted = (quote: string) => {
    const start = index++;
    while (index < source.length) {
      const c = source[index++]!;
      if (c === quote) return;
      if (c === "\\") {
        if (index >= source.length) break;
        if (source[index] === "\r" && source[index + 1] === "\n") index++;
        index++;
      } else if (c === "\r" || c === "\n") fail("invalid", "Unterminated quoted string.", start);
    }
    fail("invalid", "Unterminated quoted string.", start);
  };
  const regexp = () => {
    const start = index++;
    let inClass = false;
    while (index < source.length) {
      const c = source[index++]!;
      if (lineBreak(c)) fail("invalid", "Unterminated regular-expression literal.", start);
      if (c === "\\") {
        if (index >= source.length || lineBreak(source[index])) fail("invalid", "Unterminated regular-expression escape.", start);
        index++;
      } else if (c === "[") {
        if (inClass) fail("unsupported", "Nested or literal opening brackets in regex classes need a later lexer rule.", start);
        inClass = true;
      } else if (c === "]" && inClass) inClass = false;
      else if (c === "/" && !inClass) {
        const flagStart = index;
        while (identifierPart(point())) index += point()!.length;
        if (source.slice(flagStart, index).includes("v")) fail("unsupported", "Unicode-set regular expressions are not supported in this chunk.", start);
        return;
      }
    }
    fail("invalid", "Unterminated regular-expression literal.", start);
  };
  const template = (depth: number) => {
    const start = index++;
    if (depth > 128) fail("unsupported", "Template nesting exceeds the lexer limit.", start);
    while (index < source.length) {
      if (source[index] === "`") { index++; return; }
      if (source[index] === "\\") { index += Math.min(2, source.length - index); continue; }
      if (source.startsWith("${", index)) { index += 2; code(true, depth + 1); }
      else index++;
    }
    fail("invalid", "Unterminated template literal.", start);
  };
  const code = (interpolation: boolean, depth: number) => {
    const stack: Delimiter[] = [];
    let goal: Goal = "expression", previous = "", restricted = false, lineGap = false;
    while (index < source.length) {
      const c = source[index]!;
      if (/\s/u.test(c)) {
        if (lineBreak(c)) lineGap = true;
        if (lineBreak(c) && restricted) { goal = "expression"; previous = ";"; restricted = false; }
        index++; continue;
      }
      if (source.startsWith("//", index)) {
        const start = index; index += 2;
        while (index < source.length && !lineBreak(source[index])) index++;
        addComment(start, index, "line"); continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index;
        const end = source.indexOf("*/", index + 2);
        if (end < 0) fail("invalid", "Unterminated block comment.", start);
        index = end + 2; addComment(start, index, "block");
        if (/[\r\n\u2028\u2029]/u.test(source.slice(start, index))) lineGap = true;
        if (restricted && /[\r\n\u2028\u2029]/u.test(source.slice(start, index))) {
          goal = "expression"; previous = ";"; restricted = false;
        }
        continue;
      }
      const precededByLineBreak = lineGap;
      lineGap = false;
      if (source.startsWith("<!--", index) || source.startsWith("-->", index)) {
        fail("unsupported", "Legacy HTML-style JavaScript comments are not supported in this chunk.");
      }
      if (c === '"' || c === "'") { quoted(c); goal = "operator"; previous = "literal"; continue; }
      if (c === "`") { template(depth); goal = "operator"; previous = "literal"; continue; }
      if (c === "/") {
        if (language === "typescript" && goal === "operator" && precededByLineBreak) {
          fail("unsupported", "A slash after a TypeScript line boundary may follow a type declaration; this needs a later lexer rule.");
        }
        if (goal === "uncertain") fail("unsupported", "Cannot safely distinguish a regex from division in this syntax yet.");
        if (goal === "expression") { regexp(); goal = "operator"; previous = "literal"; }
        else { index += source[index + 1] === "=" ? 2 : 1; goal = "expression"; previous = "/"; }
        continue;
      }
      if (c === "\\") fail("unsupported", "Escaped identifiers need a later lexer rule.");
      if (identifierStart(point()) || (c === "#" && identifierStart(source[index + 1]))) {
        const start = index;
        index += c === "#" ? 1 : point()!.length;
        while (identifierPart(point())) index += point()!.length;
        const word = source.slice(start, index);
        const property = previous === "." || previous === "?.";
        if (!property && (word === "break" || word === "continue" || word === "debugger")) restricted = true;
        goal = property ? "operator" : prefixes.has(word) ? "expression"
          : word === "await" || word === "yield" ? "uncertain"
            : word === "of" && goal === "operator" && stack.some((d) => d.control && d.character === "for") ? "expression" : "operator";
        previous = property ? "identifier" : word === "await" && previous === "for" ? "for" : word;
        continue;
      }
      if (/\d/u.test(c) || (c === "." && /\d/u.test(source[index + 1] ?? ""))) {
        numeric.lastIndex = index;
        const number = numeric.exec(source);
        if (!number) fail("invalid", "Invalid numeric token.");
        index += number![0].length;
        goal = "operator"; previous = "number"; continue;
      }
      if (c === "<" && goal !== "operator") {
        fail("unsupported", "JSX and angle-bracket assertions/generic arrows need a later lexer rule.");
      }
      if (c === "@") fail("unsupported", "Decorators need a later lexer rule.");
      if (c === "(" || c === "[" || c === "{") {
        const control = c === "(" && controls.has(previous);
        stack.push({ character: control && previous === "for" ? "for" : c, control });
        index++; goal = "expression"; previous = c; restricted = false; continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        if (c === "}" && interpolation && stack.length === 0) { index++; return; }
        const opening = stack.pop();
        const expected = c === ")" ? "(" : c === "]" ? "[" : "{";
        if (!opening || (opening.character !== expected && !(c === ")" && opening.character === "for"))) {
          fail("invalid", "Unmatched closing delimiter.");
        }
        index++; goal = c === "}" ? "uncertain" : opening!.control ? "expression" : "operator";
        previous = c; restricted = false; continue;
      }
      if (source.startsWith("++", index) || source.startsWith("--", index)) {
        index += 2; previous = "increment"; continue;
      }
      if (source.startsWith("=>", index)) { index += 2; goal = "expression"; previous = "=>"; continue; }
      if (source.startsWith("...", index)) { index += 3; goal = "expression"; previous = "..."; continue; }
      if (source.startsWith("?.", index)) { index += 2; previous = "?."; goal = "operator"; continue; }
      if (c === ".") { index++; previous = "."; goal = "operator"; continue; }
      if (";,:?=+-*%&|^~!<>".includes(c)) {
        const ambiguous = c === ">" || (c === "!" && goal === "operator" && source[index + 1] !== "=");
        index++; goal = ambiguous ? "uncertain" : "expression"; previous = c;
        if (c === ";") restricted = false;
        continue;
      }
      fail("unsupported", "Unrecognised token in JavaScript/TypeScript source.");
    }
    if (interpolation || stack.length) fail("invalid", "Unterminated expression or delimiter.");
  };
  try {
    if (language !== "javascript" && language !== "typescript") fail("unsupported", "Comment extraction for " + language + " is not implemented yet.", 0);
    // A hashbang is an interpreter directive, not a debt comment.
    if (source.startsWith("#!", index)) while (index < source.length && !lineBreak(source[index])) index++;
    code(false, 0);
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof ScanFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
