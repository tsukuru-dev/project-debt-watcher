import { extractHtmlComments } from "./html.js";
import { commentSource } from "./source.js";
import type { CommentExtraction, SourceComment } from "./types.js";

class PhpFailure extends Error {
  constructor(readonly status: "invalid" | "unsupported", readonly offset: number, message: string) {
    super(message);
  }
}

/** Extract a supported subset of PHP comments and HTML comments outside PHP tags. */
export function extractPhpComments(source: string): CommentExtraction {
  const { position, comment } = commentSource(source, (value) => value === "\r" || value === "\n");
  const comments: SourceComment[] = [];
  const phpSpans: Array<{ start: number; end: number }> = [];
  const masked = source.split(""); // UTF-16 code units keep original offsets intact.
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let phpStart = -1;

  const fail = (status: PhpFailure["status"], message: string, offset = index): never => {
    throw new PhpFailure(status, offset, message);
  };
  const maskPhp = (start: number, end: number): void => {
    phpSpans.push({ start, end });
    for (let at = start; at < end; at++) {
      if (source[at] !== "\r" && source[at] !== "\n") masked[at] = " ";
    }
  };
  const quoted = (quote: string): void => {
    const start = index++;
    while (index < source.length) {
      if (source[index] === "\\") { index += 2; continue; }
      if (source[index] === quote) { index++; return; }
      if (quote === '"' && (source.startsWith("{$", index) || source.startsWith("${", index))) {
        fail("unsupported", "Complex PHP string interpolation needs the official tokenizer.", index);
      }
      index++;
    }
    fail("invalid", "Unterminated PHP string.", start);
  };

  try {
    while (index < source.length) {
      if (phpStart < 0) {
        const open = source.indexOf("<?", index);
        if (open < 0) break;
        index = open;
        if (source.startsWith("<?=", index)) index += 3;
        else if (source.slice(index, index + 5).toLowerCase() === "<?php"
          && /[\t\n\r ]/u.test(source[index + 5] ?? "")) index += 5;
        else fail("unsupported", "Short or unknown PHP opening tag; use <?php or <?=.");
        phpStart = open;
        continue;
      }

      if (source.startsWith("?>", index)) {
        index += 2;
        maskPhp(phpStart, index);
        phpStart = -1;
        continue;
      }
      if (source.startsWith("<<<", index)) {
        fail("unsupported", "PHP heredoc and nowdoc need the official tokenizer.");
      }
      if (source[index] === "`") {
        fail("unsupported", "PHP backtick strings need the official tokenizer.");
      }
      if (source[index] === "'" || source[index] === '"') {
        quoted(source[index]!);
        continue;
      }
      if (source.startsWith("//", index) || (source[index] === "#" && source[index + 1] !== "[")) {
        const start = index;
        const width = source[index] === "#" ? 1 : 2;
        index += width;
        while (index < source.length && source[index] !== "\r" && source[index] !== "\n"
          && !source.startsWith("?>", index)) index++;
        comments.push(comment("line", start, index, start + width, index));
        continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index;
        const close = source.indexOf("*/", index + 2);
        if (close < 0) fail("invalid", "Unterminated PHP block comment.", start);
        index = close + 2;
        comments.push(comment("block", start, index, start + 2, close));
        continue;
      }
      index++;
    }
    if (phpStart >= 0) maskPhp(phpStart, source.length);

    const html = extractHtmlComments(masked.join(""));
    if (html.status !== "ok") return html;
    for (const entry of html.comments) {
      if (phpSpans.some(({ start, end }) => start < entry.end.offset && entry.start.offset < end)) {
        fail("unsupported", "HTML comment overlaps PHP code and needs mixed-language handling.", entry.start.offset);
      }
      comments.push(comment("block", entry.start.offset, entry.end.offset,
        entry.contentStart.offset, entry.contentEnd.offset));
    }
    comments.sort((a, b) => a.start.offset - b.start.offset);
    return { status: "ok", comments };
  } catch (error) {
    if (!(error instanceof PhpFailure)) throw error;
    return { status: error.status, comments: [], diagnostic: { message: error.message, position: position(error.offset) } };
  }
}
