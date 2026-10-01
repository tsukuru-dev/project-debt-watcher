export interface SourcePosition {
  /** Zero-based UTF-16 offset into the original source string. */
  offset: number;
  /** One-based line and UTF-16 column, suitable for editor links. */
  line: number;
  column: number;
}

export interface SourceComment {
  kind: "line" | "block";
  raw: string;
  /** Original body, excluding delimiters; whitespace and JSDoc stars are preserved. */
  text: string;
  start: SourcePosition;
  /** All end positions are exclusive. */
  end: SourcePosition;
  contentStart: SourcePosition;
  contentEnd: SourcePosition;
}

export type CommentExtraction = { status: "ok"; comments: SourceComment[] }
  | { status: "unsupported" | "invalid"; comments: []; diagnostic: { message: string; position: SourcePosition } };
