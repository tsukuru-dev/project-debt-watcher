import { extractMarkupComments } from "./markup.js";
import type { CommentExtraction } from "./types.js";

/** Extract HTML and Django comments from a Django HTML template. */
export function extractDjangoTemplateComments(source: string): CommentExtraction {
  return extractMarkupComments(source, true);
}
