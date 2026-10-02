import { extractMarkupComments } from "./markup.js";
import type { CommentExtraction } from "./types.js";

/** Extract HTML comments while reporting Django syntax as unsupported. */
export function extractHtmlComments(source: string): CommentExtraction {
  return extractMarkupComments(source, false);
}
