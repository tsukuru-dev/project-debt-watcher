import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

const nameCharacter = (value: string | undefined) => value !== undefined && /[a-zA-Z0-9:-]/u.test(value);
const htmlSpace = (value: string | undefined) => value !== undefined && /[\t\n\f\r ]/u.test(value);
const rawText = new Set(["xmp", "iframe", "noembed", "noframes", "textarea", "title"]);

class MarkupFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) {
    super(message);
  }
}

/** Extract comments from HTML, optionally including Django template comments. */
export function extractMarkupComments(source: string, django: boolean): CommentExtraction {
  const { position, comment } = commentSource(source, (value) => value === "\r" || value === "\n");
  const comments: SourceComment[] = [];
  const lower = source.toLowerCase();
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (status: MarkupFailure["status"], message: string, offset = index): never => {
    throw new MarkupFailure(status, offset, message);
  };

  const templateToken = (at: number): number | undefined => {
    if (!django || source[at] !== "{" || !["#", "%", "{"].includes(source[at + 1] ?? "")) return undefined;
    const marker = source[at + 1];
    const ending = marker === "#" ? "#}" : marker === "%" ? "%}" : "}}";
    const close = source.indexOf(ending, at + 2);
    if (close < 0 || (marker === "#" && /[\r\n]/u.test(source.slice(at + 2, close)))) {
      fail("invalid", "Unterminated Django template token.", at);
    }
    const end = close + 2;
    if (marker === "#") {
      comments.push(comment("block", at, end, at + 2, close));
      return end;
    }
    if (marker === "{") return end;

    const content = source.slice(at + 2, close).trim();
    if (content === "endcomment") fail("invalid", "Django endcomment has no opening comment tag.", at);
    if (!/^comment(?:\s|$)/u.test(content)) return end;
    if (content !== "comment") {
      fail("unsupported", "Django comment-tag notes need separate extraction support.", at);
    }

    let next = end;
    while ((next = source.indexOf("{%", next)) >= 0) {
      const tagClose = source.indexOf("%}", next + 2);
      if (tagClose < 0) fail("invalid", "Unterminated tag inside Django comment block.", next);
      const tag = source.slice(next + 2, tagClose).trim();
      if (tag === "endcomment") {
        const blockEnd = tagClose + 2;
        comments.push(comment("block", at, blockEnd, end, next));
        return blockEnd;
      }
      if (/^comment(?:\s|$)/u.test(tag)) fail("invalid", "Nested Django comment blocks are not supported.", next);
      next = tagClose + 2;
    }
    return fail("invalid", "Unterminated Django comment block.", at);
  };

  const tagEnd = (start: number): number => {
    let quote: string | undefined;
    for (let at = start; at < source.length; at++) {
      const templateEnd = templateToken(at);
      if (templateEnd !== undefined) { at = templateEnd - 1; continue; }
      const value = source[at];
      if (quote) { if (value === quote) quote = undefined; }
      else if (value === "'" || value === '"') quote = value;
      else if (value === ">") return at + 1;
    }
    return fail("invalid", "Unterminated HTML tag or declaration.", start);
  };

  const skipTextElement = (name: string): void => {
    let at = lower.indexOf(`</${name}`, index);
    while (at >= 0) {
      if (django && (source.slice(index, at).includes("{#") || source.slice(index, at).includes("{%"))) {
        fail("unsupported", `Django template syntax inside <${name}> needs context-aware extraction.`, index);
      }
      const afterName = at + name.length + 2;
      if (htmlSpace(source[afterName]) || source[afterName] === ">" || source[afterName] === "/") {
        index = tagEnd(afterName);
        return;
      }
      at = lower.indexOf(`</${name}`, afterName);
    }
    if (django && (source.slice(index).includes("{#") || source.slice(index).includes("{%"))) {
      fail("unsupported", `Django template syntax inside <${name}> needs context-aware extraction.`, index);
    }
    index = source.length;
  };

  try {
    while (index < source.length) {
      if (source.startsWith("<!--", index)) {
        const start = index;
        const close = source.indexOf("-->", start + 4);
        if (close < 0) fail("invalid", "Unterminated HTML comment.", start);
        index = close + 3;
        comments.push(comment("block", start, index, start + 4, close));
        continue;
      }
      // The plain-HTML entry point cannot claim to have scanned Django tokens.
      const templateEnd = templateToken(index);
      if (templateEnd !== undefined) { index = templateEnd; continue; }
      if (!django && (source.startsWith("{#", index) || source.startsWith("{%", index))) {
        fail("unsupported", "Django template syntax in a plain HTML file.");
      }
      if (source[index] !== "<") { index++; continue; }
      if (lower.startsWith("<!doctype", index) && (htmlSpace(source[index + 9]) || source[index + 9] === ">")) {
        index = tagEnd(index + 9);
        continue;
      }
      if (source.startsWith("<!", index) || source.startsWith("<?", index)) {
        fail("unsupported", "Unsupported HTML declaration or embedded language.");
      }

      const closing = source[index + 1] === "/";
      const nameStart = index + (closing ? 2 : 1);
      if (!/[a-zA-Z]/u.test(source[nameStart] ?? "")) { index++; continue; }
      let nameEnd = nameStart + 1;
      while (nameCharacter(source[nameEnd])) nameEnd++;
      const name = lower.slice(nameStart, nameEnd);
      const end = tagEnd(nameEnd);
      if (!django && (source.slice(index, end).includes("{#") || source.slice(index, end).includes("{%"))) {
        fail("unsupported", "Django template syntax in an HTML tag.");
      }
      index = end;

      if (!closing) {
        if (name === "script" || name === "style" || name === "noscript") {
          fail("unsupported", `Embedded <${name}> content needs a language-aware scanner.`, nameStart - 1);
        }
        if (name === "plaintext") {
          if (django && (source.slice(index).includes("{#") || source.slice(index).includes("{%"))) {
            fail("unsupported", "Django template syntax inside <plaintext> needs context-aware extraction.");
          }
          index = source.length;
          continue;
        }
        if (rawText.has(name)) skipTextElement(name);
      }
    }
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof MarkupFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
