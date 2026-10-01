import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

/** Shared source restrictions keep official and built-in extraction on UTF-8 text. */
export function rubySourceDiagnostic(source: string): CommentExtraction | undefined {
  const { position } = commentSource(source, (c) => c === "\n");
  const invalid = source.search(/[\u0000\u0004\u001a]|\r(?!\n)/u);
  if (invalid >= 0) return { status: "unsupported", comments: [], diagnostic: {
    message: "Ruby source with bare CR or source-terminating control characters is not supported.", position: position(invalid),
  } };
  const lines = source.replace(/^\ufeff/u, "").split(/\r?\n/u, 2);
  const header = lines[0]?.startsWith("#!") ? lines[1] : lines[0];
  const encoding = /^[ \t]*#[^\n]*?(?:coding|encoding)[ \t]*[:=][ \t]*([-\w]+)/iu.exec(header ?? "")?.[1];
  if (encoding && !/^utf-?8$/iu.test(encoding)) return { status: "unsupported", comments: [], diagnostic: {
    message: "Ruby encoding declarations other than UTF-8 are not supported.", position: position(0),
  } };
  return undefined;
}

/** Deliberately limited fallback; never guess Ruby's context-dependent literal syntax. */
export function extractRubyComments(source: string): CommentExtraction {
  const issue = rubySourceDiagnostic(source);
  if (issue) return issue;
  const { position, comment } = commentSource(source, (c) => c === "\n");
  const comments: SourceComment[] = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const lineStart = () => index === 0 || (index === 1 && source.charCodeAt(0) === 0xfeff) || source[index - 1] === "\n";
  const lineEnd = (at: number) => { const lf = source.indexOf("\n", at); return lf < 0 ? source.length : lf; };
  const marker = (word: string) => source.startsWith(word, index) && (index + word.length === source.length
    || /[ \t\r\n\f\v]/u.test(source[index + word.length]!));
  const failure = (status: "invalid" | "unsupported", message: string, at = index): CommentExtraction => ({
    status, comments: [], diagnostic: { message, position: position(at) },
  });
  while (index < source.length) {
    if (lineStart()) {
      const end = lineEnd(index), line = source.slice(index, end).replace(/\r$/u, "");
      if (line === "__END__") break;
      if (marker("=begin")) {
        const start = index, bodyStart = Math.min(end + 1, source.length);
        index = bodyStart;
        while (index < source.length && !marker("=end")) index = Math.min(lineEnd(index) + 1, source.length);
        if (index >= source.length) return failure("invalid", "Unterminated Ruby block comment.", start);
        const bodyEnd = index, close = lineEnd(index);
        index = close;
        const rawEnd = close > bodyEnd && source[close - 1] === "\r" ? close - 1 : close;
        comments.push(comment("block", start, rawEnd, bodyStart, bodyEnd));
        continue;
      }
    }
    if (source[index] === "#") {
      const start = index, end = lineEnd(index);
      index = end;
      const rawEnd = source[end - 1] === "\r" ? end - 1 : end;
      comments.push(comment("line", start, rawEnd, start + 1, rawEnd));
      continue;
    }
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const start = index++;
      let closed = false;
      while (index < source.length) {
        if (source[index] === quote) { index++; closed = true; break; }
        if (quote === '"' && source[index] === "#" && /[{@$]/u.test(source[index + 1] ?? "")) {
          return failure("unsupported", "Ruby string interpolation needs the official extractor.");
        }
        if (source[index] === "\\") {
          if (quote === '"' && /[MCc]/u.test(source[index + 1] ?? "")) {
            return failure("unsupported", "Ruby control/meta escapes need the official extractor.");
          }
          index += Math.min(2, source.length - index);
        } else index++;
      }
      if (!closed) return failure("invalid", "Unterminated Ruby string.", start);
      continue;
    }
    if (source.startsWith("<<", index) || /[/%?`$]/u.test(source[index]!)) {
      return failure("unsupported", "Ruby regex, percent, heredoc, character and special-variable syntax needs the official extractor.");
    }
    if (source[index] === "\\") {
      if (source.startsWith("\\\r\n", index)) index += 3;
      else if (source.startsWith("\\\n", index)) index += 2;
      else return failure("invalid", "Unexpected Ruby backslash outside a string.");
      continue;
    }
    index++;
  }
  return { status: "ok", comments };
}
