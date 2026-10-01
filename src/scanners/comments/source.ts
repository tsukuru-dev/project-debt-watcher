import type { SourceComment, SourcePosition } from "./types.js";

/** Preserve original offsets; each language supplies its own newline rules. */
export function commentSource(source: string, isLineBreak: (value: string | undefined) => boolean) {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\r" && source[index + 1] === "\n") index++;
    if (isLineBreak(source[index])) starts.push(index + 1);
  }
  const position = (offset: number): SourcePosition => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (starts[mid]! <= offset) low = mid; else high = mid;
    }
    return { offset, line: low + 1, column: offset - starts[low]! + 1 };
  };
  const comment = (kind: SourceComment["kind"], start: number, end: number,
    contentStart: number, contentEnd: number): SourceComment => ({
    kind, raw: source.slice(start, end), text: source.slice(contentStart, contentEnd),
    start: position(start), end: position(end),
    contentStart: position(contentStart), contentEnd: position(contentEnd),
  });
  return { position, comment };
}
