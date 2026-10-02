import { validateMarkers } from "../../config/validate.js";
import type { CommentExtraction, SourceComment, SourcePosition } from "./types.js";

export interface MarkerOccurrence {
  marker: string;
  /** Zero-based UTF-16 offsets into the original source; end is exclusive. */
  startOffset: number;
  endOffset: number;
}

/** One debt finding per comment, even when that comment contains several markers. */
export interface MarkedComment {
  comment: SourceComment;
  matches: MarkerOccurrence[];
}

export type MarkerExtraction = { status: "ok"; findings: MarkedComment[] }
  | { status: "invalid" | "unsupported"; findings: []; diagnostic: { message: string; position: SourcePosition } };

const wordCharacter = (value: string | undefined): boolean => value !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(value);

function wholeMarker(text: string, start: number, marker: string): boolean {
  const beforeOffset = start >= 2 && /[\uD800-\uDBFF]/u.test(text[start - 2]!)
    && /[\uDC00-\uDFFF]/u.test(text[start - 1]!) ? start - 2 : start - 1;
  const before = beforeOffset >= 0 ? String.fromCodePoint(text.codePointAt(beforeOffset)!) : undefined;
  const afterOffset = start + marker.length;
  const after = afterOffset < text.length ? String.fromCodePoint(text.codePointAt(afterOffset)!) : undefined;
  const first = String.fromCodePoint(marker.codePointAt(0)!);
  const last = Array.from(marker).at(-1);
  return (!wordCharacter(first) || !wordCharacter(before))
    && (!wordCharacter(last) || !wordCharacter(after));
}

/** Match configured marker text only within comments supplied by a language extractor. */
export function matchCommentMarkers(extraction: CommentExtraction, markers: readonly string[]): MarkerExtraction {
  validateMarkers(markers);
  if (extraction.status !== "ok") {
    return { status: extraction.status, findings: [], diagnostic: extraction.diagnostic };
  }

  const findings: MarkedComment[] = [];
  for (const comment of extraction.comments) {
    const matches: Array<MarkerOccurrence & { order: number }> = [];
    for (const [order, marker] of markers.entries()) {
      let at = 0;
      while ((at = comment.text.indexOf(marker, at)) >= 0) {
        if (wholeMarker(comment.text, at, marker)) {
          const startOffset = comment.contentStart.offset + at;
          matches.push({ marker, startOffset, endOffset: startOffset + marker.length, order });
        }
        at++;
      }
    }
    if (matches.length) {
      matches.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset || a.order - b.order);
      const distinct: MarkerOccurrence[] = [];
      let previousEnd = -1;
      for (const match of matches) {
        if (match.startOffset < previousEnd) continue;
        distinct.push(match);
        previousEnd = match.endOffset;
      }
      findings.push({ comment, matches: distinct.map(({ marker, startOffset, endOffset }) => ({ marker, startOffset, endOffset })) });
    }
  }
  return { status: "ok", findings };
}
